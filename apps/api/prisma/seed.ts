import { PrismaClient } from '@prisma/client';
import { SYSTEM_SECRET_TYPES } from './system-secret-types';

const prisma = new PrismaClient();

// =============================================================================
// Seed Data Definitions
// =============================================================================

const ROLES = [
  {
    name: 'admin',
    description: 'Full system access - manage users, roles, and all settings',
  },
  {
    name: 'contributor',
    description: 'Standard user - can manage own settings and future features',
  },
  {
    name: 'viewer',
    description: 'Read-only access - can view content and manage own settings',
  },
] as const;

const PERMISSIONS = [
  // System settings
  { name: 'system_settings:read', description: 'Read system settings' },
  { name: 'system_settings:write', description: 'Modify system settings' },

  // User settings
  { name: 'user_settings:read', description: 'Read own user settings' },
  { name: 'user_settings:write', description: 'Modify own user settings' },

  // Users management
  { name: 'users:read', description: 'View user list and details' },
  { name: 'users:write', description: 'Modify user accounts' },

  // RBAC management
  { name: 'rbac:manage', description: 'Manage roles and permissions' },

  // Allowlist management
  { name: 'allowlist:read', description: 'View allowlisted emails' },
  { name: 'allowlist:write', description: 'Manage allowlisted emails' },

  // Storage management
  { name: 'storage:read', description: 'Read object metadata, get download URLs' },
  { name: 'storage:write', description: 'Upload, update metadata' },
  { name: 'storage:delete_any', description: 'Admin: delete any object' },

  // Secret types management
  { name: 'secret_types:read', description: 'View secret types' },
  { name: 'secret_types:write', description: 'Create and update secret types' },
  { name: 'secret_types:delete', description: 'Delete secret types' },

  // Secrets management
  { name: 'secrets:read', description: 'Read own secrets' },
  { name: 'secrets:write', description: 'Create and update own secrets' },
  { name: 'secrets:delete', description: 'Delete own secrets' },
  { name: 'secrets:read_any', description: 'Admin: read any secret' },
  { name: 'secrets:write_any', description: 'Admin: update any secret' },
  { name: 'secrets:delete_any', description: 'Admin: delete any secret' },

  // Media management
  { name: 'media:read', description: 'Read own media files and folders' },
  { name: 'media:write', description: 'Upload and update own media files and folders' },
  { name: 'media:delete', description: 'Delete own media files and folders' },
  { name: 'media:read_any', description: 'Admin: read any media files and folders' },
  { name: 'media:write_any', description: 'Admin: update any media files and folders' },
  { name: 'media:delete_any', description: 'Admin: delete any media files and folders' },
] as const;

// Role to permissions mapping
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'system_settings:read',
    'system_settings:write',
    'user_settings:read',
    'user_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
    'allowlist:read',
    'allowlist:write',
    'storage:read',
    'storage:write',
    'storage:delete_any',
    'secret_types:read',
    'secret_types:write',
    'secret_types:delete',
    'secrets:read',
    'secrets:write',
    'secrets:delete',
    'secrets:read_any',
    'secrets:write_any',
    'secrets:delete_any',
    'media:read',
    'media:write',
    'media:delete',
    'media:read_any',
    'media:write_any',
    'media:delete_any',
  ],
  contributor: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'storage:write',
    'secret_types:read',
    'secret_types:write',
    'secret_types:delete',
    'secrets:read',
    'secrets:write',
    'secrets:delete',
    'media:read',
    'media:write',
    'media:delete',
  ],
  viewer: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'secret_types:read',
    'secrets:read',
    'media:read',
  ],
};

// Default system settings
const DEFAULT_SYSTEM_SETTINGS = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
};

// =============================================================================
// Seed Functions
// =============================================================================

async function seedRoles() {
  console.log('Seeding roles...');

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  console.log(`✓ Seeded ${ROLES.length} roles`);
}

async function seedPermissions() {
  console.log('Seeding permissions...');

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { description: permission.description },
      create: permission,
    });
  }

  console.log(`✓ Seeded ${PERMISSIONS.length} permissions`);
}

async function seedRolePermissions() {
  console.log('Seeding role-permission mappings...');

  let count = 0;

  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;

    for (const permissionName of permissionNames) {
      const permission = await prisma.permission.findUnique({
        where: { name: permissionName },
      });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
      count++;
    }
  }

  console.log(`✓ Seeded ${count} role-permission mappings`);
}

async function seedSystemSettings() {
  console.log('Seeding system settings...');

  await prisma.systemSettings.upsert({
    where: { key: 'global' },
    update: {}, // Don't overwrite existing settings
    create: {
      key: 'global',
      value: DEFAULT_SYSTEM_SETTINGS,
      version: 1,
    },
  });

  console.log('✓ Seeded default system settings');
}

async function seedInitialAdminAllowlist() {
  console.log('Seeding initial admin allowlist...');

  const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL;
  if (initialAdminEmail) {
    await prisma.allowedEmail.upsert({
      where: { email: initialAdminEmail.toLowerCase() },
      update: {},
      create: {
        email: initialAdminEmail.toLowerCase(),
        notes: 'Initial admin (auto-seeded)',
      },
    });
    console.log(`✓ Added ${initialAdminEmail} to allowlist`);
  } else {
    console.log('⊘ INITIAL_ADMIN_EMAIL not set, skipping allowlist seed');
  }
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

  await seedRoles();
  await seedPermissions();
  await seedRolePermissions();
  await seedSystemSettings();
  await seedInitialAdminAllowlist();
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
