import type { PrismaClient } from '@prisma/client';

import {
  runInOrg,
  type RlsRunnableClient,
  type RlsTransactionClient,
  type RlsTransactionOptions,
} from '@marinoscar/platform-api/core';
import { resolveOrgId } from '@marinoscar/platform-api/identity';

/**
 * The default organization's id, for work that has no request principal
 * (the backup runner, the storage cleanup sweep, object post-processing) and
 * for the storage call sites that are still Vault's own (E6).
 *
 * Resolved with identity's `resolveOrgId`, so it honours the tenancy mode: in
 * `single` mode (Vault's only mode) it is the row with `is_default = true`; in
 * `multi` mode it throws `MissingOrgScopeError` instead of quietly choosing an
 * organization. Cached per client; a failed lookup is not cached.
 *
 * A request's principal carries the same organization (`principal.activeOrgId`)
 * in single mode, which is why the request paths do not thread it yet:
 * PLATFORM-ADOPTION-SHIM(E6) threads the principal's org through the storage
 * slice and removes this. Listed in docs/platform-adoption/local-exceptions.md.
 */
const cache = new WeakMap<object, Promise<string>>();

export function getDefaultOrgId(prisma: Pick<PrismaClient, 'organization'>): Promise<string> {
  const hit = cache.get(prisma);
  if (hit) return hit;
  const pending = resolveOrgId(prisma, undefined, 'Vault default-organization scope');
  cache.set(prisma, pending);
  // A failed lookup must not be cached forever.
  pending.catch(() => cache.delete(prisma));
  return pending;
}

/**
 * Runs `fn` in ONE transaction scoped to the default organization
 * (`runInOrg`: `set_config('app.org_id', ..., true)` first), so row-level
 * security on `storage_objects` / `storage_object_chunks` shows exactly the
 * default organization's rows. The API connects as an ordinary role
 * (`vault_app`, NOSUPERUSER NOBYPASSRLS), so an unscoped read of those tables
 * returns nothing and an unscoped insert fails the policy.
 *
 * No S3 or other slow I/O inside `fn` (Prisma's interactive transactions time
 * out after 5 s). PLATFORM-ADOPTION-SHIM(E6): storage becomes the platform
 * slice, which scopes by the principal's organization.
 */
export async function runInDefaultOrg<C extends PrismaClient, R>(
  prisma: C,
  fn: (tx: RlsTransactionClient<C>) => Promise<R>,
  options?: RlsTransactionOptions,
): Promise<R> {
  const orgId = await getDefaultOrgId(prisma);
  return runInOrg(prisma as never as RlsRunnableClient, { orgId }, fn as never, options) as Promise<R>;
}

type ModelClient = RlsTransactionClient<PrismaClient>;
const scopedClients = new WeakMap<object, ModelClient>();

/**
 * A view of the client whose every model operation (`db.storageObject.findMany(...)`,
 * `db.secretAttachment.findMany({ include: { storageObject: true } })`, ...)
 * runs through {@link runInDefaultOrg}, one operation per transaction. Good for
 * single statements; a unit of work of several statements uses
 * {@link runInDefaultOrg} directly. It is NOT usable in a batch
 * `$transaction([...])` (the operations are awaited, not lazy), and it has no
 * `$queryRaw`.
 *
 * PLATFORM-ADOPTION-SHIM(E6), like {@link runInDefaultOrg}.
 */
export function defaultOrgClient(prisma: PrismaClient): ModelClient {
  const hit = scopedClients.get(prisma);
  if (hit) return hit;
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, operation) => {
          if (typeof operation !== 'string') return undefined;
          return (args?: unknown) =>
            runInDefaultOrg(prisma, (tx) =>
              (tx as unknown as Record<string, Record<string, (a?: unknown) => Promise<unknown>>>)[model][operation](args),
            );
        },
      },
    );
  const client = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== 'string' || key.startsWith('$') || key === 'then') return undefined;
        return modelProxy(key);
      },
    },
  ) as unknown as ModelClient;
  scopedClients.set(prisma, client);
  return client;
}
