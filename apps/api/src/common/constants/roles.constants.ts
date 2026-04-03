// =============================================================================
// Role Constants
// =============================================================================

export const ROLES = {
  ADMIN: 'admin',
  CONTRIBUTOR: 'contributor',
  VIEWER: 'viewer',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// =============================================================================
// Permission Constants
// =============================================================================

export const PERMISSIONS = {
  // System settings
  SYSTEM_SETTINGS_READ: 'system_settings:read',
  SYSTEM_SETTINGS_WRITE: 'system_settings:write',

  // User settings
  USER_SETTINGS_READ: 'user_settings:read',
  USER_SETTINGS_WRITE: 'user_settings:write',

  // Users
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',

  // RBAC
  RBAC_MANAGE: 'rbac:manage',

  // Allowlist
  ALLOWLIST_READ: 'allowlist:read',
  ALLOWLIST_WRITE: 'allowlist:write',

  // Storage
  STORAGE_READ: 'storage:read',
  STORAGE_WRITE: 'storage:write',
  STORAGE_DELETE_ANY: 'storage:delete_any',

  // Secret Types
  SECRET_TYPES_READ: 'secret_types:read',
  SECRET_TYPES_WRITE: 'secret_types:write',
  SECRET_TYPES_DELETE: 'secret_types:delete',

  // Secrets
  SECRETS_READ: 'secrets:read',
  SECRETS_WRITE: 'secrets:write',
  SECRETS_DELETE: 'secrets:delete',
  SECRETS_READ_ANY: 'secrets:read_any',
  SECRETS_WRITE_ANY: 'secrets:write_any',
  SECRETS_DELETE_ANY: 'secrets:delete_any',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// =============================================================================
// Default Role
// =============================================================================

export const DEFAULT_ROLE = ROLES.VIEWER;
