/**
 * VAULT_HOST: what the slices need to know about the host deployment, bound once by the host
 * instead of being read from the environment (issue #194). Optional: a host that binds nothing gets
 * {@link VAULT_HOST_DEFAULTS} (no base URL, so a notification carries no call-to-action link).
 *
 * The package reads no environment variable: every deployment fact comes through a port or this binding.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_HOST = Symbol.for('@marinoscar/vault/VAULT_HOST');

/**
 * The host facts.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface VaultHostConfig {
  /**
   * The deployment's public base URL (`https://host.example.test`), used as the call-to-action
   * link of the backup and card-expiry notifications. `null` or absent: the payload carries no
   * `appUrl` and the renderers fall back to a relative link.
   */
  appUrl?: string | null;
}

/** What a slice uses when the host bound no `VAULT_HOST`. */
export const VAULT_HOST_DEFAULTS: Readonly<VaultHostConfig> = Object.freeze({ appUrl: null });

/** `{ appUrl }` when the host configured one, `{}` otherwise: the spread the notification payloads use. */
export function hostAppUrl(host: VaultHostConfig | null | undefined): { appUrl?: string } {
  const appUrl = host?.appUrl;
  return typeof appUrl === 'string' && appUrl.length > 0 ? { appUrl } : {};
}
