/**
 * Vault's `api` (services/api.ts) as the platform's `PlatformApiClient`: the
 * transport every packaged page calls through `PlatformHostProvider` (E10.3,
 * issue #94: the Doctor, About and Maintenance cards).
 *
 * The same bearer token, the same refresh-and-retry-once, the same `{ data }`
 * unwrapping: each call goes through Vault's one client. Vault's `ApiError`
 * already satisfies `PlatformApiError` (`status`, `message`, optional string
 * `code`), so errors pass through unchanged.
 *
 * A STOP-GAP until E3.3 replaces Vault's client with the platform's
 * `PlatformHttpClient` + `createPlatformApiClient`
 * (docs/platform-adoption/local-exceptions.md). Built once, at module scope:
 * packaged hooks key on its identity.
 */

import type {
  PlatformApiClient,
  PlatformBlobResponse,
  PlatformRequestOptions,
} from '@marinoscar/platform-web/core';

import { api } from '../services/api';

/** `PlatformRequestOptions` as the `RequestInit` fields Vault's client takes. */
function toInit(options: PlatformRequestOptions | undefined): RequestInit | undefined {
  if (!options) return undefined;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.ifMatch !== undefined) headers['If-Match'] = options.ifMatch;
  return { signal: options.signal, headers };
}

/** The body to send: an explicit `jsonBody` wins over the positional one. */
function bodyOf(body: unknown, options: PlatformRequestOptions | undefined): unknown {
  return options?.jsonBody !== undefined ? options.jsonBody : body;
}

async function getBlob(path: string, options?: PlatformRequestOptions): Promise<PlatformBlobResponse> {
  const response = await api.getForResponse(path, toInit(options));
  return { blob: await response.blob(), headers: response.headers };
}

async function postBlob(
  path: string,
  body?: unknown,
  options?: PlatformRequestOptions,
): Promise<PlatformBlobResponse> {
  const response = await api.postForResponse(path, bodyOf(body, options), toInit(options));
  return { blob: await response.blob(), headers: response.headers };
}

// PLATFORM-ADOPTION-SHIM(E3.3): Vault's client adapted to PlatformApiClient.
export const vaultPlatformApi: PlatformApiClient = Object.freeze({
  get: <T>(path: string, options?: PlatformRequestOptions) => api.get<T>(path, toInit(options)),
  post: <T>(path: string, body?: unknown, options?: PlatformRequestOptions) =>
    api.post<T>(path, bodyOf(body, options), toInit(options)),
  put: <T>(path: string, body?: unknown, options?: PlatformRequestOptions) =>
    api.put<T>(path, bodyOf(body, options), toInit(options)),
  patch: <T>(path: string, body?: unknown, options?: PlatformRequestOptions) =>
    api.patch<T>(path, bodyOf(body, options), toInit(options)),
  delete: <T>(path: string, options?: PlatformRequestOptions) => api.delete<T>(path, toInit(options)),
  getBlob,
  postBlob,
});
