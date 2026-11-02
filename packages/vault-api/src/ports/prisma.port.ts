import type { PrismaClient } from '@prisma/client';

/**
 * VAULT_PRISMA: the host's Prisma client.
 *
 * The package types against the client the host generates from the platform fragments plus the
 * `@marinoscar/vault-db` fragments (a peer of `@prisma/client`). The host's client connects as the
 * ordinary application role (NOSUPERUSER NOBYPASSRLS), so the slices read the org tables
 * (`storage_objects`) through `runInDefaultOrg` / `defaultOrgClient` of `@marinoscar/vault-api/core`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_PRISMA = Symbol.for('@marinoscar/vault/VAULT_PRISMA');

/** The client type a slice injects. */
export type VaultPrismaClient = PrismaClient;
