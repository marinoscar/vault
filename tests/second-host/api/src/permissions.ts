// =============================================================================
// Host Beta's roles and permissions, with the Vault permissions mapped onto them
// =============================================================================
//
// Host Beta has its own org roles (`beta_editor`, `beta_reader`) and its own permission resource
// (`beta_notes`). It gives Vault's default grants to ITS roles through `vaultPermissionDeclarations`
// instead of the platform's `contributor` and `viewer` (EMBEDDING.md, "Permissions and roles"). The
// platform's `admin` keeps the `*_any` reach and `org_admin` keeps the owner's reach.
// =============================================================================

import type { PlatformPermissionOptions } from '@marinoscar/platform-api/manifest';
import type { PermissionDeclaration, RoleDeclaration } from '@marinoscar/platform-api/core';
import { vaultPermissionDeclarations, type VaultRoleMapping } from '@marinoscar/vault-api/core';

/** The host's own org roles. */
export const HOST_ROLES = {
  BETA_EDITOR: { id: 'beta_editor', description: 'Host Beta: edits notes and keeps secrets', scope: 'org' },
  BETA_READER: { id: 'beta_reader', description: 'Host Beta: reads notes and secrets', scope: 'org' },
} as const satisfies Record<string, RoleDeclaration>;

/** The host's own permissions (its one page). */
export const HOST_PERMISSIONS = {
  BETA_NOTES_READ: {
    id: 'beta_notes:read',
    description: 'Read Host Beta notes',
    scope: 'org',
    defaultGrants: ['org_admin', 'beta_editor', 'beta_reader'],
  },
  BETA_NOTES_WRITE: {
    id: 'beta_notes:write',
    description: 'Write Host Beta notes',
    scope: 'org',
    defaultGrants: ['org_admin', 'beta_editor'],
  },
} as const satisfies Record<string, PermissionDeclaration>;

/** Vault's default grants, on Host Beta's roles. */
export const VAULT_ROLE_MAPPING: VaultRoleMapping = {
  contributor: ['beta_editor'],
  viewer: ['beta_reader'],
};

/** What the registry and the seed are built from (the same options, so they cannot disagree). */
export const PERMISSION_OPTIONS = {
  slices: ['identity', 'settings', 'jobs', 'nodes'],
  app: {
    roles: [HOST_ROLES],
    permissions: [HOST_PERMISSIONS, vaultPermissionDeclarations(VAULT_ROLE_MAPPING)],
  },
} satisfies PlatformPermissionOptions;
