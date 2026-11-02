/**
 * Vault's machine-readable error codes: the wire contract of `{ code }` in an
 * error response, as data. The API registers every entry with the platform's
 * error-code registry (`registerErrorCode`) so the exception filter keeps the
 * code; this package has no dependency on the platform.
 *
 * @packageDocumentation
 */

/**
 * One error code: the string a client reads, the HTTP status it is thrown with
 * and a one-line description.
 *
 * @stability experimental
 */
export interface VaultErrorCodeDef {
  /** The code a client reads in `{ code }`. */
  readonly code: string;
  /** The HTTP status the exception carries; the platform keeps the code only for this status. */
  readonly status: number;
  /** What the code means. */
  readonly description: string;
}

/**
 * Error codes of the card-scan routes. The platform's own `AI_*` codes (kill
 * switch, key, model, limits) belong to the AI slice; the API maps them onto
 * these so the web's handling of the scan flow does not change.
 *
 * @stability experimental
 */
export const AI_ERROR_CODES = {
  NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  INVALID_IMAGE: 'AI_INVALID_IMAGE',
  RATE_LIMITED: 'AI_RATE_LIMITED',
  QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  UPSTREAM_AUTH: 'AI_UPSTREAM_AUTH',
  UPSTREAM_RATE_LIMITED: 'AI_UPSTREAM_RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'AI_UPSTREAM_UNAVAILABLE',
  EXTRACTION_FAILED: 'AI_EXTRACTION_FAILED',
} as const;

/** @stability experimental */
export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/**
 * Every code Vault adds to the platform's, with the status it is thrown with.
 *
 * @stability experimental
 */
export const VAULT_ERROR_CODES: readonly VaultErrorCodeDef[] = Object.freeze([
  // Seed and encryption preconditions.
  { code: 'DATABASE_SEED_REQUIRED', status: 500, description: 'Migrations ran but the seed data (roles, permissions) is missing.' },
  { code: 'ENCRYPTION_UNAVAILABLE', status: 503, description: 'VAULT_ENCRYPTION_KEY is not configured, so a secret value could not be stored.' },

  // Card scanning. The platform's own `AI_*` codes are registered by the AI slice.
  { code: AI_ERROR_CODES.NOT_CONFIGURED, status: 503, description: 'AI card scanning is not set up (provider, model or deployment key missing).' },
  { code: AI_ERROR_CODES.INVALID_IMAGE, status: 400, description: 'The images are not acceptable base64 data URLs within the size limit.' },
  { code: AI_ERROR_CODES.RATE_LIMITED, status: 429, description: 'The per-user per-minute AI limit was reached.' },
  { code: AI_ERROR_CODES.QUOTA_EXCEEDED, status: 429, description: 'A daily AI limit (per user or per organization) was reached.' },
  { code: AI_ERROR_CODES.UPSTREAM_RATE_LIMITED, status: 429, description: 'The AI provider is rate limiting requests.' },
  { code: AI_ERROR_CODES.UPSTREAM_AUTH, status: 502, description: 'The AI provider rejected the configured API key.' },
  { code: AI_ERROR_CODES.UPSTREAM_UNAVAILABLE, status: 502, description: 'The AI provider failed, timed out or was unreachable.' },
  { code: AI_ERROR_CODES.EXTRACTION_FAILED, status: 422, description: 'The model refused, or its output did not validate.' },
]);

/**
 * Whether a string is one of {@link VAULT_ERROR_CODES}.
 *
 * @param value - Any string.
 * @stability experimental
 */
export function isVaultErrorCode(value: string): boolean {
  return VAULT_ERROR_CODES.some((def) => def.code === value);
}
