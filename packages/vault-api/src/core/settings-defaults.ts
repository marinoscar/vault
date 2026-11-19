// =============================================================================
// The settings namespaces the slices read, and their defaults (issue #194)
// =============================================================================
//
// The slices read three system-settings namespaces through `VAULT_SETTINGS.getNamespace(name)` and
// tolerate a missing field. Vault registers them with the platform settings registry (schemas,
// admin pages) in `apps/api/src/app-registrations/settings.ts`; another host may do the same, or
// bind `VAULT_SETTINGS` to its own store. Either way these are the shapes and the defaults.
// `agentAccess` is `AgentAccessSettings` of `@marinoscar/vault-contract/agent`
// (`AGENT_ACCESS_SETTINGS_DEFAULTS`: off).
// =============================================================================

/** `vaultCards`: the card image size cap and the expiry warning window. */
export interface VaultCardsSettings {
  /** Largest card face image, in bytes. */
  imageMaxBytes: number;
  /** How many days before expiry a card shows as expiring. */
  expiryWarningDays: number;
}

/** `vaultBackups`: the defaults of the administrator's backup schedule. */
export interface VaultBackupsSettings {
  keepCount: number;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeSecrets: boolean;
  includeMedia: boolean;
  includeSystem: boolean;
}

/** 5 MB. */
export const VAULT_CARDS_SETTINGS_DEFAULTS: Readonly<VaultCardsSettings> = Object.freeze({
  imageMaxBytes: 5 * 1024 * 1024,
  expiryWarningDays: 30,
});

export const VAULT_BACKUPS_SETTINGS_DEFAULTS: Readonly<VaultBackupsSettings> = Object.freeze({
  keepCount: 7,
  includeAttachments: true,
  includeVersions: false,
  includeSecrets: true,
  includeMedia: false,
  includeSystem: false,
});
