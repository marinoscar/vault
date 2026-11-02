import type { PrismaClient } from '@prisma/client';

import {
  runInOrg,
  type RlsTransactionClient,
  type RlsTransactionOptions,
} from './org-scope';

/**
 * PLATFORM-ADOPTION-SHIM(E3.2)
 *
 * The platform schema makes `storage_objects.org_id` NOT NULL, but Vault is
 * single-tenant until the identity slice is adopted (E3.2): every storage
 * object belongs to the one default organization created by platform migration
 * 0023. This resolves that organization's id (the row with `is_default = true`)
 * and caches it per client.
 *
 * Removed with the legacy storage code (E6) / replaced by identity's
 * `resolveOrgId` (E3.2). Listed in docs/platform-adoption/local-exceptions.md.
 */
const cache = new WeakMap<object, Promise<string>>();

export function getDefaultOrgId(prisma: Pick<PrismaClient, 'organization'>): Promise<string> {
  const hit = cache.get(prisma);
  if (hit) return hit;
  const pending = prisma.organization
    .findFirst({ where: { isDefault: true }, select: { id: true } })
    .then((org) => {
      if (!org) {
        throw new Error(
          'No default organization found (organizations.is_default = true). Apply the platform migrations (npm run prisma:migrate).',
        );
      }
      return org.id;
    });
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
  return runInOrg(prisma as never as { $executeRaw(q: TemplateStringsArray, ...v: never[]): unknown }, { orgId }, fn as never, options) as Promise<R>;
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
