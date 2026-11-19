// =============================================================================
// Vault's OAuth scopes and protected resource (issue #174, E14.2, epic #172)
// =============================================================================
//
// What an agent (a third-party client holding an `oat_` token) may be granted,
// and where. A scope is a named bundle of permission ids the consent page shows;
// it only ever NARROWS the permissions the user already holds. The resource
// confines an `oat_` token for it to `/api/agent/v1`: the same token is refused
// on `/api/secrets/*`, `/api/admin/*`, `/api/backups/*` and everything else.
//
// `registerVaultAgentOAuth()` is called once at import time by the host's
// `app-registrations/` (the registries freeze when the application bootstraps).
// The MCP resource (`/api/mcp`) is E14.8 and is not registered here.
// =============================================================================

import {
  registerOAuthProtectedResource,
  registerOAuthScope,
  type OAuthProtectedResourceDefinition,
  type OAuthScopeDefinition,
} from '@marinoscar/platform-api/identity';

import { VAULT_PERMISSIONS } from '../core/permissions';

/**
 * The scope ids (permanent: clients persist them). The platform's id pattern
 * (`name` or `name:action`, no dots) rules out `vault.items.read`, so the ids are `vault:items_*`.
 */
export const VAULT_OAUTH_SCOPES = {
  ITEMS_READ: 'vault:items_read',
  ITEMS_FILL: 'vault:items_fill',
  ITEMS_WRITE: 'vault:items_write',
  CARDS_READ: 'vault:cards_read',
  CARDS_FILL: 'vault:cards_fill',
  IDENTITY_READ: 'vault:identity_read',
  IDENTITY_FILL: 'vault:identity_fill',
} as const;

/** The agent API's resource id and path. */
export const VAULT_AGENT_RESOURCE_ID = 'agent';
export const VAULT_AGENT_RESOURCE_PATH = '/api/agent/v1';

export const VAULT_OAUTH_SCOPE_DEFINITIONS: readonly OAuthScopeDefinition[] = [
  {
    id: VAULT_OAUTH_SCOPES.ITEMS_READ,
    title: 'See the logins you opened to agents',
    description: 'See the names, usernames and websites of the logins you opened to agents.',
    permissions: [VAULT_PERMISSIONS.SECRETS_READ.id],
    risk: 'low',
    default: true,
  },
  {
    id: VAULT_OAUTH_SCOPES.ITEMS_FILL,
    title: 'Use the passwords and one-time codes of logins you opened to agents',
    description: 'Fill the passwords and one-time codes of the logins you opened to agents, one field at a time.',
    permissions: [VAULT_PERMISSIONS.SECRETS_READ.id, VAULT_PERMISSIONS.SECRETS_FILL.id],
    risk: 'elevated',
  },
  {
    id: VAULT_OAUTH_SCOPES.ITEMS_WRITE,
    title: 'Save new logins and change passwords',
    description: 'Create logins and change their passwords.',
    permissions: [VAULT_PERMISSIONS.SECRETS_READ.id, VAULT_PERMISSIONS.SECRETS_WRITE.id],
    risk: 'elevated',
  },
  // ADR-0003. Never `default`: a client asks for card and identity scopes explicitly.
  {
    id: VAULT_OAUTH_SCOPES.CARDS_READ,
    title: 'See the cards you allowed for a shop',
    description: 'See the name, brand, last four digits and expiry of the cards you opened to agents and granted for the shop on screen. Never the number or the security code.',
    permissions: [VAULT_PERMISSIONS.AGENT_CARDS_READ.id],
    risk: 'elevated',
  },
  {
    id: VAULT_OAUTH_SCOPES.CARDS_FILL,
    title: 'Use your cards at the shops you allowed, within your limits',
    description: 'Fill the number, expiry and (when you allowed it) the security code of a granted card, one field at a time, up to the amount you set; and ask you for a new shop.',
    permissions: [VAULT_PERMISSIONS.AGENT_CARDS_READ.id, VAULT_PERMISSIONS.AGENT_CARDS_FILL.id],
    risk: 'elevated',
  },
  {
    id: VAULT_OAUTH_SCOPES.IDENTITY_READ,
    title: 'See which identity details you opened to agents',
    description: 'See the names of the identity items you opened to agents and the labels of their fields. Never a value.',
    permissions: [VAULT_PERMISSIONS.AGENT_IDENTITY_READ.id],
    risk: 'low',
  },
  {
    id: VAULT_OAUTH_SCOPES.IDENTITY_FILL,
    title: 'Fill your identity details into forms',
    description: 'Fill your name, address and phone into forms, one field at a time; your id number and date of birth only on the websites you allowed.',
    permissions: [VAULT_PERMISSIONS.AGENT_IDENTITY_READ.id, VAULT_PERMISSIONS.AGENT_IDENTITY_FILL.id],
    risk: 'elevated',
  },
];

export const VAULT_OAUTH_RESOURCES: readonly OAuthProtectedResourceDefinition[] = [
  {
    id: VAULT_AGENT_RESOURCE_ID,
    path: VAULT_AGENT_RESOURCE_PATH,
    routePrefixes: [VAULT_AGENT_RESOURCE_PATH],
    scopes: [...VAULT_OAUTH_SCOPE_DEFINITIONS.map((scope) => scope.id), 'offline_access'],
    name: 'Vault agent API',
  },
];

let registered = false;

/** Registers Vault's scopes and protected resource. Idempotent within a process. */
export function registerVaultAgentOAuth(): void {
  if (registered) return;
  registered = true;
  VAULT_OAUTH_SCOPE_DEFINITIONS.forEach(registerOAuthScope);
  VAULT_OAUTH_RESOURCES.forEach(registerOAuthProtectedResource);
}
