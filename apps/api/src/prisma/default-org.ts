import type { PrismaClient } from '@prisma/client';

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
