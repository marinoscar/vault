/**
 * VAULT_SETTINGS: the system settings, read by namespace (`vaultCards`, `vaultBackups`, `ai`).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_SETTINGS = Symbol.for('@marinoscar/vault/VAULT_SETTINGS');

/**
 * The settings port. The namespace shapes are the host's registration (`app-registrations/settings`);
 * a slice narrows the value with the type argument and tolerates a missing field.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface VaultSettingsPort {
  /** One namespace of the system settings, defaults applied; does not create the row. */
  getNamespace<T = Record<string, unknown>>(name: string): Promise<T>;
  /** The whole system-settings document. */
  getSettings(): Promise<unknown>;
}
