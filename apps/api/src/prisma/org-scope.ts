// =============================================================================
// PLATFORM-ADOPTION-SHIM(E3.1): transaction-local organization scoping
// =============================================================================
//
// A minimal local copy of the platform's `runInOrg` / `orgScopeExtension`
// (`@marinoscar/platform-api/core`, packages/platform-api/src/core/data-access/rls.ts
// in EnterpriseAppBase), with the SAME signatures, so E3.1 swaps the import and
// deletes this file. Listed in docs/platform-adoption/local-exceptions.md.
//
// Row-level security on the org tables (`storage_objects`,
// `storage_object_chunks`, ...) is keyed on the TRANSACTION-LOCAL settings
// `app.org_id` and `app.user_id`. They are written only with
// `set_config(name, value, true)` as the FIRST statement of a transaction, so
// they disappear at COMMIT or ROLLBACK.
//
//   NEVER a session-level `SET`: it leaks to the next request on a pooled
//   connection.
//
//   NEVER use a client from `forOrg()` inside `$transaction(async tx => ...)`:
//   its operations open their own transaction and ESCAPE the outer one. Use
//   `runInOrg()` and the plain `tx` it hands out.
// =============================================================================

import { Prisma } from '@prisma/client/extension';

export class ScopedAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopedAccessError';
  }
}

/** The organization (and optionally the acting user) a unit of work runs for. */
export interface OrgScope {
  readonly orgId: string;
  readonly userId?: string;
}

/** Options forwarded to Prisma's interactive transaction. */
export interface RlsTransactionOptions {
  readonly maxWait?: number;
  readonly timeout?: number;
}

/** What `runInOrg` needs from a client, structurally. */
export interface RlsRunnableClient {
  $executeRaw(query: TemplateStringsArray, ...values: never[]): unknown;
}

/** The client an interactive transaction hands its callback. */
export type RlsTransactionClient<C> = Omit<
  C,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, what: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ScopedAccessError(`${what} must be a UUID, got ${JSON.stringify(value)}.`);
  }
  return value;
}

function validate(scope: OrgScope): { orgId: string; userId: string } {
  const orgId = assertUuid(scope?.orgId, 'scope.orgId');
  const userId =
    scope.userId === undefined || scope.userId === '' ? '' : assertUuid(scope.userId, 'scope.userId');
  return { orgId, userId };
}

/** One round trip, two settings, both transaction-local. */
function setScopeStatement(client: RlsRunnableClient, scope: { orgId: string; userId: string }): unknown {
  return client.$executeRaw`SELECT set_config('app.org_id', ${scope.orgId as never}, true), set_config('app.user_id', ${scope.userId as never}, true)`;
}

type TransactionFn = (arg: unknown, options?: unknown) => Promise<unknown>;

/** The scope an interactive transaction was opened with, so a nested `runInOrg` reuses it. */
const TRANSACTION_SCOPES = new WeakMap<object, string>();

function isTransactionClient(client: RlsRunnableClient): boolean {
  const c = client as { $connect?: unknown; $extends?: unknown };
  return TRANSACTION_SCOPES.has(client) || (typeof c.$connect !== 'function' && typeof c.$extends !== 'function');
}

/**
 * One interactive transaction in an organization's scope: `set_config` first,
 * then `fn(tx)` with the plain (unextended) transaction client. Rolls back when
 * `fn` throws. Nested use with the same scope reuses the outer transaction.
 *
 * Prisma gives an interactive transaction 5 s by default; do NOT call object
 * storage (S3) or other slow I/O inside `fn`.
 */
export async function runInOrg<C extends RlsRunnableClient, R>(
  client: C,
  scope: OrgScope,
  fn: (tx: RlsTransactionClient<C>) => Promise<R>,
  options: RlsTransactionOptions = {},
): Promise<R> {
  const pinned = validate(scope);
  const key = `${pinned.orgId}|${pinned.userId}`;

  if (isTransactionClient(client)) {
    const outer = TRANSACTION_SCOPES.get(client);
    if (outer !== undefined) {
      if (outer !== key) {
        throw new ScopedAccessError(
          'runInOrg() was nested inside a transaction scoped to another organization or user.',
        );
      }
      return fn(client as unknown as RlsTransactionClient<C>);
    }
    await setScopeStatement(client, pinned);
    TRANSACTION_SCOPES.set(client, key);
    return fn(client as unknown as RlsTransactionClient<C>);
  }

  return (client as unknown as { $transaction: TransactionFn }).$transaction(
    async (tx: RlsRunnableClient) => {
      await setScopeStatement(tx, pinned);
      TRANSACTION_SCOPES.set(tx, key);
      try {
        return await fn(tx as unknown as RlsTransactionClient<C>);
      } finally {
        // The scope belongs to this transaction only (a unit-test double hands
        // out one shared object as every transaction's client).
        TRANSACTION_SCOPES.delete(tx);
      }
    },
    options,
  ) as Promise<R>;
}

/**
 * The Prisma client extension behind `PrismaService.forOrg`: every operation
 * runs as `$transaction([ set_config(...), operation ])` on one connection.
 */
export function orgScopeExtension(
  base: { $transaction(arg: never, options?: never): Promise<unknown>; $executeRaw(query: TemplateStringsArray, ...values: never[]): unknown },
  scope: OrgScope,
) {
  const pinned = validate(scope);
  return Prisma.defineExtension({
    name: 'org-scope',
    query: {
      async $allOperations({ args, query, ...rest }) {
        const internal = (rest as { __internalParams?: { transaction?: unknown } }).__internalParams;
        if (internal?.transaction !== undefined && internal.transaction !== null) {
          throw new ScopedAccessError(
            'A scoped client was used inside $transaction(async tx => ...). Its operations would escape the transaction; ' +
              'use runInOrg() and the plain `tx` it hands out instead.',
          );
        }
        const [, result] = (await (base.$transaction as unknown as TransactionFn).call(base, [
          setScopeStatement(base, pinned),
          query(args),
        ])) as unknown[];
        return result;
      },
    },
  });
}
