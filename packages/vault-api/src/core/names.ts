// =============================================================================
// Every name the Vault packages own in a host (issue #194, epic #191)
// =============================================================================
//
// A host that mounts the packages shares ONE route table, ONE permission registry, ONE settings
// document, ONE job queue, ONE notification registry, ONE metric registry and ONE audit trail with
// them. This file is the inventory of what the packages put into each, so a host can see the names
// it must not use, and `findVaultNameCollisions` (used by `runVaultHostConformance`) can refuse a
// host that does.
//
// TWO KINDS OF NAME:
//   * NAMESPACED (`vault.` / `vault-` / `vault:` / `vault` camel prefix): job types, notification
//     events, email templates, OAuth scopes, the package's own settings namespaces. A host cannot
//     collide with them unless it uses the `vault` namespace itself.
//   * RESERVED (persisted before the packages existed, so renaming would break Vault's databases,
//     tokens and clients): the route prefixes, the permission resources, the `agentAccess` settings
//     namespace and the audit action prefixes. They are listed here exactly; a host must not reuse
//     them, and the conformance kit fails a host that does.
//
// `test/names.spec.ts` derives every name from the code (controller metadata, the declarations, the
// registered job handlers, the source of every audit write) and fails when one is missing here or is
// neither namespaced nor reserved, so this list cannot go stale.
// =============================================================================

/** The namespace every new name of the packages lives in. */
export const VAULT_NAMESPACE = 'vault';

/**
 * The inventory. Route prefixes are relative to the host's global prefix (`/api` in an
 * EnterpriseAppBase host).
 *
 * @stability experimental
 */
export const VAULT_RESERVED_NAMES = {
  /** Every route the packages serve starts with one of these (then `/` or the end). */
  routePrefixes: ['/secrets', '/secret-types', '/media', '/backups/me', '/admin/backups', '/agent/v1', '/agent-activity', '/mcp'],
  /** The `<resource>` part of every permission id the packages declare (`secrets:read`, ...). */
  permissionResources: ['secrets', 'secret_types', 'media', 'agent_cards', 'agent_identity', 'agent_service_keys'],
  /** The system-settings namespaces the packages read and a host registers for them (`ai` is the platform's). */
  settingsNamespaces: ['vaultCards', 'vaultBackups', 'agentAccess'],
  /** Every job type starts with this. */
  jobTypePrefix: 'vault.',
  /** Every notification event key starts with this. */
  notificationEventPrefix: 'vault.',
  /** Every email template name starts with this. */
  emailTemplatePrefix: 'vault-',
  /** Every OAuth scope id starts with this (the platform's `offline_access` aside). */
  oauthScopePrefix: 'vault:',
  /** The OAuth protected resources the packages register. */
  oauthResources: ['agent', 'mcp'],
  /** Every audit action the packages write starts with one of these. */
  auditActionPrefixes: ['secret.', 'secret_type.', 'secrets.', 'backups.', 'agent.credential.', 'agent.card.', 'agent.identity.', 'agent.service_key.', 'mcp.', 'vault.'],
  /** The OpenAPI tags the controllers carry. */
  openApiTags: ['Secrets', 'Secret Types', 'Media', 'Backups', 'Agent', 'MCP'],
  /**
   * Metric names: none. The packages emit through `VAULT_METRICS` (`VaultMetricsPort`) and the HOST
   * names the instruments; Vault names them `app.vault.*`, and a host should keep a `vault` segment.
   */
  metricNames: [] as readonly string[],
} as const;

/**
 * The names a host registered itself, as {@link findVaultNameCollisions} compares them. Every list
 * is optional; pass what the host can enumerate.
 *
 * @stability experimental
 */
export interface VaultHostNames {
  /** Route paths of the host's own controllers, relative to the global prefix (`/beta/notes`). */
  routes?: readonly string[];
  /** Permission ids the host declares (`notes:read`). */
  permissions?: readonly string[];
  /** System-settings namespaces the host registers. */
  settingsNamespaces?: readonly string[];
  /** Job types the host registers. */
  jobTypes?: readonly string[];
  /** Notification event keys the host registers. */
  notificationEvents?: readonly string[];
  /** Email template names the host registers. */
  emailTemplates?: readonly string[];
  /** Audit actions the host writes. */
  auditActions?: readonly string[];
  /** OpenAPI tags of the host's controllers. */
  openApiTags?: readonly string[];
  /** Metric names the host declares (a `vault` segment is reserved). */
  metricNames?: readonly string[];
}

const underPrefix = (path: string, prefix: string): boolean => {
  const normalized = `/${path.replace(/^\/+/, '')}`;
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
};

/**
 * Every place a host's own name falls in the packages' namespace or on a reserved name, as one
 * message per finding (empty when there is none).
 *
 * @param host - the host's names, see {@link VaultHostNames}.
 * @returns the findings, e.g. `route /secrets/archive is under the reserved prefix /secrets`.
 *
 * @stability experimental
 */
export function findVaultNameCollisions(host: VaultHostNames): string[] {
  const names = VAULT_RESERVED_NAMES;
  const findings: string[] = [];
  for (const route of host.routes ?? []) {
    const prefix = names.routePrefixes.find((p) => underPrefix(route, p));
    if (prefix) findings.push(`route ${route} is under the reserved prefix ${prefix}`);
  }
  for (const permission of host.permissions ?? []) {
    const resource = permission.split(':')[0] ?? '';
    if ((names.permissionResources as readonly string[]).includes(resource) || resource.startsWith(VAULT_NAMESPACE)) {
      findings.push(`permission ${permission} uses the reserved resource ${resource}`);
    }
  }
  for (const namespace of host.settingsNamespaces ?? []) {
    if ((names.settingsNamespaces as readonly string[]).includes(namespace) || namespace.startsWith(VAULT_NAMESPACE)) {
      findings.push(`settings namespace ${namespace} is reserved`);
    }
  }
  const prefixed = (kind: string, list: readonly string[] | undefined, prefix: string) => {
    for (const name of list ?? []) if (name.startsWith(prefix)) findings.push(`${kind} ${name} is in the ${prefix} namespace`);
  };
  prefixed('job type', host.jobTypes, names.jobTypePrefix);
  prefixed('notification event', host.notificationEvents, names.notificationEventPrefix);
  prefixed('email template', host.emailTemplates, names.emailTemplatePrefix);
  for (const action of host.auditActions ?? []) {
    const prefix = names.auditActionPrefixes.find((p) => action.startsWith(p));
    if (prefix) findings.push(`audit action ${action} is under the reserved prefix ${prefix}`);
  }
  for (const tag of host.openApiTags ?? []) {
    if ((names.openApiTags as readonly string[]).includes(tag)) findings.push(`OpenAPI tag ${tag} is the packages'`);
  }
  for (const metric of host.metricNames ?? []) {
    if (metric.split('.').includes(VAULT_NAMESPACE)) findings.push(`metric ${metric} uses the reserved ${VAULT_NAMESPACE} segment`);
  }
  return findings;
}
