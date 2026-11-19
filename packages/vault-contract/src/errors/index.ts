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

  // Agent access (E14.3).
  { code: 'AGENT_ACCESS_UNSUPPORTED_TYPE', status: 422, description: 'Only a Credential, Card or Identity system secret can be opened to agents; this secret type cannot be set to fill.' },

  // Agent credential API (E14.6). Contract: `@marinoscar/vault-contract/agent`.
  { code: 'ORIGIN_MISMATCH', status: 403, description: 'The origin sent by the agent is not exactly one of the credential origins, so nothing was filled.' },
  { code: 'AGENT_ACCESS_DISABLED', status: 403, description: 'Agent access is switched off for this deployment.' },
  { code: 'AGENT_CREDENTIAL_REQUIRED', status: 403, description: 'The agent API accepts only an OAuth access token (oat_) or a personal access token (pat_), not a browser session.' },
  { code: 'RATE_LIMITED', status: 429, description: 'The per-minute limit of an agent API call was reached; see the Retry-After header.' },
  { code: 'AGENT_ACTIVITY_FORBIDDEN', status: 403, description: 'The agent activity list is for the owner (a browser session or a personal access token); an OAuth access token cannot read it.' },

  // Agent release of cards and identity (ADR-0003). Contract: `@marinoscar/vault-contract/agent`.
  { code: 'CARD_ACCESS_DISABLED', status: 403, description: 'Card release to agents is switched off for this deployment (agentAccess.cards.enabled).' },
  { code: 'IDENTITY_ACCESS_DISABLED', status: 403, description: 'Identity release to agents is switched off for this deployment (agentAccess.identity.enabled).' },
  { code: 'SECURITY_CODE_NOT_GRANTED', status: 403, description: 'The security code was asked for under a merchant grant that does not include it.' },
  { code: 'CARD_AMOUNT_EXCEEDED', status: 403, description: 'The amount is above the maximum of the merchant grant.' },
  { code: 'CARD_CURRENCY_MISMATCH', status: 403, description: 'The currency is not the currency of the merchant grant.' },
  { code: 'CARD_PERIOD_LIMIT_REACHED', status: 403, description: 'The period limit of the merchant grant (releases or total amount per day or month) was reached.' },
  { code: 'CARD_DAILY_CAP_REACHED', status: 403, description: 'The per-card daily cap of card releases was reached.' },
  { code: 'CARD_GRANT_EXPIRED', status: 403, description: 'The merchant grant of this card has expired.' },
  { code: 'CARD_GRANT_EXISTS', status: 409, description: 'The card already has a live grant for this merchant; revoke it first.' },
  { code: 'CARD_GRANT_REQUEST_NOT_PENDING', status: 409, description: 'The grant request was already approved or declined.' },
  { code: 'OWNER_SESSION_REQUIRED', status: 403, description: 'Changing what agents may do needs the owner signed in to Vault; an OAuth access token or a personal access token cannot.' },

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
