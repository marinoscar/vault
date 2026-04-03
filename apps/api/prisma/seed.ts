import { PrismaClient } from '@prisma/client';

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
  ],
  viewer: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'secret_types:read',
    'secrets:read',
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

  const systemTypes = [
    {
      name: 'Credential',
      description: 'Username and password credentials',
      icon: 'Key',
      fields: [
        { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
        { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true },
        { name: 'url', label: 'URL', type: 'string', required: false, sensitive: false },
        { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
      ],
      allowAttachments: false,
    },
    {
      name: 'API Key',
      description: 'API keys and access tokens',
      icon: 'VpnKey',
      fields: [
        { name: 'key', label: 'API Key', type: 'string', required: true, sensitive: true },
        { name: 'provider', label: 'Provider', type: 'string', required: false, sensitive: false },
        { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
      ],
      allowAttachments: false,
    },
    {
      name: 'Card',
      description: 'Credit or debit card information',
      icon: 'CreditCard',
      fields: [
        { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
        { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
        { name: 'exp_month', label: 'Expiration Month', type: 'string', required: true, sensitive: false },
        { name: 'exp_year', label: 'Expiration Year', type: 'string', required: true, sensitive: false },
        { name: 'cvv', label: 'CVV', type: 'string', required: true, sensitive: true },
        { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
      ],
      allowAttachments: false,
    },
    {
      name: 'Token',
      description: 'Authentication tokens',
      icon: 'Token',
      fields: [
        { name: 'token', label: 'Token', type: 'string', required: true, sensitive: true },
        { name: 'provider', label: 'Provider', type: 'string', required: false, sensitive: false },
        { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
      ],
      allowAttachments: false,
    },
    {
      name: 'Note',
      description: 'Secure notes',
      icon: 'Description',
      fields: [
        { name: 'content', label: 'Content', type: 'string', required: true, sensitive: false },
      ],
      allowAttachments: false,
    },
    {
      name: 'Document',
      description: 'Documents with file attachments',
      icon: 'AttachFile',
      fields: [
        { name: 'title', label: 'Title', type: 'string', required: true, sensitive: false },
        { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
      ],
      allowAttachments: true,
    },
  ];

  let count = 0;
  for (const typeData of systemTypes) {
    const existing = await prisma.secretType.findFirst({
      where: { name: typeData.name, isSystem: true },
    });
    if (!existing) {
      await prisma.secretType.create({
        data: {
          ...typeData,
          isSystem: true,
        },
      });
      count++;
    }
  }

  console.log(`✓ Seeded ${count} system secret types (${systemTypes.length - count} already existed)`);
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
