import { z } from 'zod';

/**
 * Service keys (issue #241): the keys of outside services (a web search provider's API key, for
 * example) that an owner keeps in Vault for a server process to call that service with. A service
 * key is a `Service Key` system secret: one secret value (`key`), the `service` it is for and a
 * `key_name` that tells two keys of one service apart. It has no website and no allowed-sites list:
 * it is never typed into a page. A host's item kind `api_key` maps to it.
 *
 * Plain data: no I/O.
 *
 * @packageDocumentation
 */

/** The name of the system secret type that holds a service key. @stability experimental */
export const SERVICE_KEY_TYPE_NAME = 'Service Key' as const;

/** The field of a `Service Key` secret that names the service (`web_search`). @stability experimental */
export const SERVICE_KEY_SERVICE_FIELD = 'service' as const;

/** The field of a `Service Key` secret that names the key within its service (`provider_a`). @stability experimental */
export const SERVICE_KEY_NAME_FIELD = 'key_name' as const;

/** The sensitive field of a `Service Key` secret: the value a server process receives. @stability experimental */
export const SERVICE_KEY_VALUE_FIELD = 'key' as const;

/** Longest `service` or `key_name`. @stability experimental */
export const SERVICE_KEY_ID_MAX_LENGTH = 64;

/**
 * What a `service` and a `key_name` look like once normalized: lower-case letters, digits, `_` and
 * `-`, starting with a letter or a digit, at most {@link SERVICE_KEY_ID_MAX_LENGTH} characters.
 *
 * @stability experimental
 */
export const SERVICE_KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * A `service` or `key_name` as it is stored and matched: trimmed and lower-cased, then
 * {@link SERVICE_KEY_ID_PATTERN}. `Web_Search` and `web_search` are the same service.
 *
 * @stability experimental
 */
export const serviceKeyIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SERVICE_KEY_ID_PATTERN, 'Use lower-case letters, digits, "_" and "-" (at most 64, starting with a letter or a digit)');

/**
 * The normalized form of a `service` or `key_name`, or `null` when it is not a valid id. Pure.
 *
 * @stability experimental
 */
export function normalizeServiceKeyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = serviceKeyIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
