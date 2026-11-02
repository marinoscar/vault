import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { buildDatabaseUrl } from '../src/common/database-url';
import { PERMISSION_OPTIONS } from '../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../src/settings/registry/default-system-settings';
import { SYSTEM_SECRET_TYPES } from './system-secret-types';

// =============================================================================
// Database seed (issue #77, E3.2)
// =============================================================================
//
// Two idempotent steps, in this order:
//
//   1. `seedPlatform`: the roles, permissions and default grants, the `global`
//      system settings row, the initial administrator's allowlist row
//      (INITIAL_ADMIN_EMAIL) and the default organization. The permission
//      catalog is composed from the platform's packaged registry plus Vault's
//      own (`platformPermissionCatalog(PERMISSION_OPTIONS)`, the same options
//      `app-registrations/registrations.ts` registers), so the seed and the
//      guards cannot disagree. It imports only `src/platform/permissions.ts`
//      and `src/app-registrations/permissions.ts` (pure data); the production
//      image carries `src/` for this reason.
//   2. `seedApp`: Vault's own rows (the system secret types) and one cleanup of
//      grants the permission split made stale.
//
// Neither step deletes a role, a permission or a value an administrator edited.
// This script stays Nest-free so it runs under ts-node.

// Prisma 7 requires a driver adapter.
const prisma = new PrismaClient({
  adapter: new PrismaPg(buildDatabaseUrl()),
});

/** Vault's org-scoped permissions: the ones a system role must not hold a grant of. */
const VAULT_ORG_PERMISSIONS = PERMISSION_OPTIONS.app.permissions.flatMap((batch) =>
  Object.values(batch)
    .filter((permission) => permission.scope === 'org')
    .map((permission) => permission.id as string),
);

async function seedPlatformRows() {
  const input = platformSeedInputFrom(
    {
      permissions: platformPermissionCatalog(PERMISSION_OPTIONS),
      // Every registered namespace's defaults, in registration order (E4.1).
      settings: DEFAULT_SYSTEM_SETTINGS,
    },
    process.env,
  );
  const summary = await seedPlatform(prisma as unknown as SeedPrisma, input, {
    info: (msg) => console.log(msg),
  });
  console.log(
    `✓ Platform seed: ${summary.roles} roles, ${summary.permissions} permissions, ` +
      `${summary.rolePermissions} grants` +
      (summary.skippedGrants.length > 0
        ? `, ${summary.skippedGrants.length} skipped (${summary.skippedGrants.join(', ')})`
        : ''),
  );
}

/**
 * `secrets:*`, `secret_types:*` and `media:*` (the non-`_any` ones) were
 * system-scoped permissions granted to `admin` before the platform identity
 * slice. They are org-scoped now and an administrator holds them through the
 * `org_admin` membership role, so the old `admin` grants are stale. They are
 * harmless (the principal factory counts any `user_roles` grant) but a role is
 * granted only permissions of its own scope, so they are removed. Idempotent.
 */
async function removeStaleSystemRoleGrants() {
  const result = await prisma.rolePermission.deleteMany({
    where: {
      role: { scope: 'system' },
      permission: { name: { in: VAULT_ORG_PERMISSIONS } },
    },
  });
  console.log(`✓ Removed ${result.count} stale system-role grants of org-scoped permissions`);
}

async function seedSecretTypes() {
  console.log('Seeding system secret types...');

  // Note: SecretType.name has NO unique index. findFirst + update would only
  // touch one arbitrary row if duplicates exist and leave others stale, and
  // secrets pointing at a stale type would then fail validation with "Unknown
  // field". updateMany converges all rows matching (name, isSystem) instead.
  let created = 0;
  let updated = 0;
  for (const typeData of SYSTEM_SECRET_TYPES) {
    const { name, ...rest } = typeData;
    const res = await prisma.secretType.updateMany({
      where: { name, isSystem: true },
      data: {
        description: rest.description,
        icon: rest.icon,
        fields: rest.fields as any,
        allowAttachments: rest.allowAttachments,
      },
    });
    if (res.count === 0) {
      await prisma.secretType.create({
        data: { ...typeData, fields: typeData.fields as any, isSystem: true },
      });
      created++;
    } else {
      updated++;
    }
  }

  console.log(`✓ Seeded system secret types (${created} created, ${updated} updated)`);
}

// =============================================================================
// Main Seed Function
// =============================================================================

async function main() {
  console.log('Starting database seed...\n');

  await seedPlatformRows();
  await removeStaleSystemRoleGrants();
  await seedSecretTypes();

  console.log('\n✓ Database seeding completed successfully');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
