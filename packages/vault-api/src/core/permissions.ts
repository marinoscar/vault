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
  SECRETS_FILL: {
    id: 'secrets:fill',
    description: 'Read one sensitive field of an agent-accessible secret through the agent API',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  // Agent release of cards and identity (ADR-0003): what the vault:cards_* and vault:identity_*
  // scopes bundle. Separate from secrets:read/secrets:fill so a login token reaches no card.
  AGENT_CARDS_READ: {
    id: 'agent_cards:read',
    description: 'List the cards opened to agents that have a merchant grant, through the agent API',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  AGENT_CARDS_FILL: {
    id: 'agent_cards:fill',
    description: 'Read one field of a granted card, and ask its owner for a grant, through the agent API',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  AGENT_IDENTITY_READ: {
    id: 'agent_identity:read',
    description: 'List the identity items opened to agents and the labels of their fields, through the agent API',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  AGENT_IDENTITY_FILL: {
    id: 'agent_identity:fill',
    description: 'Read one field of an identity item opened to agents through the agent API',
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

/**
 * The four roles {@link VAULT_PERMISSIONS} grants by default: the platform's `admin` (system) and
 * `org_admin`, `contributor`, `viewer` (org).
 */
export type VaultDefaultGrantRole = 'admin' | 'org_admin' | 'contributor' | 'viewer';

/**
 * How a host maps Vault's default grants onto ITS roles (issue #194): for each of the four roles
 * Vault grants by default, the host roles that receive those grants instead. A key left out keeps
 * the platform role of the same name; an empty list grants nothing for that key (an operator then
 * grants the permission by hand). A target role must exist in the host's registry with the same
 * scope (`admin` maps to system roles, the other three to org roles); the platform's registry
 * refuses anything else at registration time.
 *
 * @extensionPoint option
 * @stability experimental
 */
export type VaultRoleMapping = Partial<Record<VaultDefaultGrantRole, readonly string[]>>;

/** The keys of {@link VAULT_PERMISSIONS}. */
export type VaultPermissionKey = keyof typeof VAULT_PERMISSIONS;

/**
 * Vault's permission declarations with the default grants mapped onto a host's roles. The ids,
 * descriptions and scopes never change (they are persisted and enforced by the controllers); only
 * who holds them by default does. Without a mapping it returns {@link VAULT_PERMISSIONS} itself,
 * which is what Vault registers.
 *
 * @param roles - see {@link VaultRoleMapping}.
 * @returns a declaration map for `registerPlatformPermissions({ app: { permissions: [...] } })`.
 *
 * @example
 * ```ts
 * registerPlatformPermissions({
 *   app: {
 *     roles: [HOST_ROLES],
 *     permissions: [vaultPermissionDeclarations({ contributor: ['beta_editor'], viewer: ['beta_reader'] })],
 *   },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function vaultPermissionDeclarations(roles?: VaultRoleMapping): Record<VaultPermissionKey, PermissionDeclaration> {
  if (!roles) return VAULT_PERMISSIONS;
  const map = (grants: readonly string[]): string[] => {
    const out: string[] = [];
    for (const role of grants) {
      for (const target of roles[role as VaultDefaultGrantRole] ?? [role]) {
        if (!out.includes(target)) out.push(target);
      }
    }
    return out;
  };
  return Object.fromEntries(
    Object.entries(VAULT_PERMISSIONS).map(([key, declaration]) => [key, { ...declaration, defaultGrants: map(declaration.defaultGrants) }]),
  ) as unknown as Record<VaultPermissionKey, PermissionDeclaration>;
}
