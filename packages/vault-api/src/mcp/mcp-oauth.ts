// =============================================================================
// Vault's MCP OAuth scopes and protected resource (issue #180, E14.8, epic #172)
// =============================================================================
//
// What a chat assistant (a third-party client holding an `oat_` token) may be granted at `/api/mcp`.
// A scope is a named bundle of permission ids the consent page shows; it only ever NARROWS the
// permissions the user already holds. The resource confines an `oat_` token for it to `/api/mcp`:
// the same token is refused on `/api/agent/v1`, `/api/secrets/*` and everything else, and an agent
// token is refused here (two resources, non-overlapping prefixes).
//
// `registerVaultMcpOAuth()` is called once at import time by the host's `app-registrations/` (the
// registries freeze when the application bootstraps).
// =============================================================================

import {
  registerOAuthProtectedResource,
  registerOAuthScope,
  type OAuthProtectedResourceDefinition,
  type OAuthScopeDefinition,
} from '@marinoscar/platform-api/identity';

import { VAULT_PERMISSIONS } from '../core/permissions';

/** The scope ids (permanent: clients persist them). Colon form: the platform refuses dotted ids. */
export const VAULT_MCP_SCOPES = {
  READ: 'vault:mcp_read',
  WRITE: 'vault:mcp_write',
  /** #244, ADR-0005: reads ONE field value of a secret the owner switched "Reveal to assistants" on. */
  REVEAL: 'vault:mcp_reveal',
} as const;

/** The MCP resource's id and path. */
export const VAULT_MCP_RESOURCE_ID = 'mcp';
export const VAULT_MCP_RESOURCE_PATH = '/api/mcp';

export const VAULT_MCP_SCOPE_DEFINITIONS: readonly OAuthScopeDefinition[] = [
  {
    id: VAULT_MCP_SCOPES.READ,
    title: 'Search your logins and read their non-secret details',
    description: 'Find the logins you opened to agents and read their names, usernames and websites. Passwords and codes are never shared.',
    permissions: [VAULT_PERMISSIONS.SECRETS_READ.id],
    risk: 'low',
    default: true,
  },
  {
    id: VAULT_MCP_SCOPES.WRITE,
    title: 'Save new secrets and change them',
    description: 'Create secrets (with a password Vault generates and keeps hidden) and change fields of the logins you opened to agents.',
    permissions: [VAULT_PERMISSIONS.SECRETS_READ.id, VAULT_PERMISSIONS.SECRETS_WRITE.id],
    risk: 'elevated',
  },
  {
    id: VAULT_MCP_SCOPES.REVEAL,
    title: 'Read the values of secrets you chose to reveal',
    description:
      'Read the value of one field at a time (for example a password) of the secrets you switched "Reveal to assistants" on for. ' +
      'Nothing else is readable, cards are never included, and every read is recorded in your agent activity.',
    permissions: [VAULT_PERMISSIONS.SECRETS_READ.id],
    risk: 'high',
  },
];

export const VAULT_MCP_RESOURCES: readonly OAuthProtectedResourceDefinition[] = [
  {
    id: VAULT_MCP_RESOURCE_ID,
    path: VAULT_MCP_RESOURCE_PATH,
    routePrefixes: [VAULT_MCP_RESOURCE_PATH],
    scopes: [...VAULT_MCP_SCOPE_DEFINITIONS.map((scope) => scope.id), 'offline_access'],
    name: 'Vault MCP server',
  },
];

let registered = false;

/** Registers Vault's MCP scopes and protected resource. Idempotent within a process. */
export function registerVaultMcpOAuth(): void {
  if (registered) return;
  registered = true;
  VAULT_MCP_SCOPE_DEFINITIONS.forEach(registerOAuthScope);
  VAULT_MCP_RESOURCES.forEach(registerOAuthProtectedResource);
}
