// =============================================================================
// Vault's own permissions (issue #77, E3.2, epic #54)
// =============================================================================
//
// The domain permissions the product adds on top of the platform's. The strings
// are the ones the controllers enforce and the ones already persisted in the
// `permissions` table and in role seeds: they never change.
//
// Every `secrets:*`, `secret_types:*` and `media:*` permission is ORG-SCOPED: a
// user holds it through the role on the membership of the current organization
// (`org_admin`, `contributor`, `viewer`), never through `user_roles`. The
// `*_any` permissions are SYSTEM-scoped and held by the `admin` role only:
// they are an operator's reach across every user's data, not an org role's.
//
// Grants equal the seed that existed before the platform identity slice:
//   contributor  read/write/delete of secrets, secret types and media
//   viewer       read of the three
//   org_admin    what contributor has (the former `admin` reach over its own
//                data; platform migration 0024 moved admin's org grants here)
//   admin        the `*_any` permissions (system scope)
//
// `storage:*` and `user_settings:*` are declared by the platform's storage and
// settings slices; they are not redeclared here.
//
// No side effects: this only declares. The registration is `registrations.ts`.
// =============================================================================

import type { PermissionDeclaration } from '@marinoscar/platform-api/core';

export const VAULT_PERMISSIONS = {
  SECRET_TYPES_READ: {
    id: 'secret_types:read',
    description: 'View secret types',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  SECRET_TYPES_WRITE: {
    id: 'secret_types:write',
    description: 'Create and update secret types',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  SECRET_TYPES_DELETE: {
    id: 'secret_types:delete',
    description: 'Delete secret types',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },

  SECRETS_READ: {
    id: 'secrets:read',
    description: 'Read own secrets',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  SECRETS_WRITE: {
    id: 'secrets:write',
    description: 'Create and update own secrets',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  SECRETS_DELETE: {
    id: 'secrets:delete',
    description: 'Delete own secrets',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  SECRETS_READ_ANY: {
    id: 'secrets:read_any',
    description: 'Admin: read any secret',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  SECRETS_WRITE_ANY: {
    id: 'secrets:write_any',
    description: 'Admin: update any secret',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  SECRETS_DELETE_ANY: {
    id: 'secrets:delete_any',
    description: 'Admin: delete any secret',
    scope: 'system',
    defaultGrants: ['admin'],
  },

  MEDIA_READ: {
    id: 'media:read',
    description: 'Read own media files and folders',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  MEDIA_WRITE: {
    id: 'media:write',
    description: 'Upload and update own media files and folders',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  MEDIA_DELETE: {
    id: 'media:delete',
    description: 'Delete own media files and folders',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  MEDIA_READ_ANY: {
    id: 'media:read_any',
    description: 'Admin: read any media files and folders',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  MEDIA_WRITE_ANY: {
    id: 'media:write_any',
    description: 'Admin: update any media files and folders',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  MEDIA_DELETE_ANY: {
    id: 'media:delete_any',
    description: 'Admin: delete any media files and folders',
    scope: 'system',
    defaultGrants: ['admin'],
  },
} as const satisfies Record<string, PermissionDeclaration>;
