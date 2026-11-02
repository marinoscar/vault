/**
 * The one port every Vault slice reaches the API through.
 *
 * The host builds the transport (the platform's `PlatformHttpClient`: the
 * access-token holder, the 401 -> refresh -> retry, the refresh lock) and hands
 * it over ONCE, before the first render, with {@link configureVaultWeb}. The
 * package never builds a client and never reads a build-time variable: the base
 * URL and the lock name are the host's to choose.
 *
 * A module-level port (like `configureNotificationsWeb` of
 * `@marinoscar/platform-web/notifications`) rather than a React provider,
 * because the domain calls are plain async functions (`api.ts`) used from
 * hooks, effects and event handlers alike.
 */

import type { PlatformHttpClient } from '@marinoscar/platform-web/core';

/** What a host passes to {@link configureVaultWeb}. */
export interface VaultWebConfig {
  /** The host's one HTTP client; the same instance the platform's `AuthProvider` drives. */
  http: PlatformHttpClient;
  /**
   * The API base the client was built with (default `/api`). Read only by the
   * two raw `fetch` calls that stream a file (attachment upload and download).
   */
  apiBaseUrl?: string;
}

/** Thrown when a slice calls the API before the host configured the package. */
export class VaultWebNotConfiguredError extends Error {
  constructor() {
    super('@marinoscar/vault-web is not configured: call configureVaultWeb({ http }) before the first render.');
    this.name = 'VaultWebNotConfiguredError';
  }
}

let config: { http: PlatformHttpClient; apiBaseUrl: string } | null = null;

/** Hands the package its transport. Call once, at start-up; a later call replaces it. */
export function configureVaultWeb(options: VaultWebConfig): void {
  config = { http: options.http, apiBaseUrl: options.apiBaseUrl ?? '/api' };
}

/** The configured client. Throws {@link VaultWebNotConfiguredError} before {@link configureVaultWeb}. */
export function getVaultHttp(): PlatformHttpClient {
  if (!config) throw new VaultWebNotConfiguredError();
  return config.http;
}

/** The configured API base URL (`/api` by default). */
export function getVaultApiBaseUrl(): string {
  if (!config) throw new VaultWebNotConfiguredError();
  return config.apiBaseUrl;
}

/**
 * The configured client, resolved on every member access, so call sites keep
 * writing `api.get(...)` and a module may import it before the host configures
 * the package.
 */
export const api: PlatformHttpClient = new Proxy({} as PlatformHttpClient, {
  get(_target, prop) {
    const client = getVaultHttp();
    const value: unknown = Reflect.get(client, prop, client);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
