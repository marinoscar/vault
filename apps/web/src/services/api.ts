/**
 * Vault's one HTTP client (the host's).
 *
 * E3.3 (#78): the transport is the platform's `PlatformHttpClient`
 * (`@marinoscar/platform-web/core`): the access-token holder, the one-shot
 * 401 -> refresh -> retry, the cross-page refresh lock and the "session
 * expired" signal the packaged `AuthProvider` drives sessions through
 * (`identity/IdentityProviders.tsx` passes this instance as its `client`). The
 * packaged platform pages reach the same instance through
 * `createPlatformApiClient` (`platform/platformHost.tsx`).
 *
 * E12.3 (#104): the Vault domain calls live in `@marinoscar/vault-web`; this
 * module builds the client and hands it to the package (`configureVaultWeb`)
 * as it is first imported, before the first render.
 */

import { ApiError, PlatformHttpClient } from '@marinoscar/platform-web/core';
import { configureVaultWeb } from '@marinoscar/vault-web/core/headless';
import { PRODUCT_NAME } from '@marinoscar/vault-web/brand';

/** Where the API lives (same origin by default). */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export { ApiError };

export const api = new PlatformHttpClient({
  baseUrl: API_BASE_URL,
  // Named after the app so two apps on one origin never contend for a lock.
  refreshLockName: `${PRODUCT_NAME.toLowerCase()}-auth-refresh`,
});

configureVaultWeb({ http: api, apiBaseUrl: API_BASE_URL });
