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
  { code: 'AGENT_ACCESS_UNSUPPORTED_TYPE', status: 422, description: 'Only a Credential, Card, Identity or Service Key system secret can be opened to agents; this secret type cannot be set to fill.' },

  // Reveal to assistants (#244, ADR-0005).
  { code: 'ASSISTANT_REVEAL_UNSUPPORTED_TYPE', status: 422, description: 'A Card (or identity document) secret can never be revealed to an assistant; assistantReveal cannot be switched on for this secret type.' },

  // Credential broker (#246, ADR-0006). Contract: `@marinoscar/vault-contract/broker`.
  { code: 'BROKER_DISABLED', status: 403, description: 'The credential broker is switched off for this deployment (agentAccess.enabled and agentAccess.broker.enabled).' },
  { code: 'BROKER_CREDENTIAL_REFUSED', status: 403, description: 'The broker accepts only a broker token (vbk_) or a personal access token (pat_), not an OAuth access token or a browser session; broker tokens and the opt-in are managed with a session or a personal access token.' },
  { code: 'BROKER_ORIGIN_MISMATCH', status: 403, description: 'The upstream origin is not exactly one of the origins the owner allowed for this secret, so nothing was sent.' },
  { code: 'BROKER_DESTINATION_BLOCKED', status: 403, description: 'The upstream host resolves to a private, loopback, link-local or otherwise blocked address, so nothing was sent.' },
  { code: 'BROKER_REQUEST_TOO_LARGE', status: 413, description: 'The request body is above the broker request size limit (agentAccess.broker.maxRequestBytes).' },
  { code: 'BROKER_RESPONSE_TOO_LARGE', status: 502, description: 'The upstream response is above the broker response size limit (agentAccess.broker.maxResponseBytes) and was withheld.' },
  { code: 'BROKER_UPSTREAM_TIMEOUT', status: 504, description: 'The upstream did not answer within the broker time limit (agentAccess.broker.timeoutMs).' },
  { code: 'BROKER_UPSTREAM_ERROR', status: 502, description: 'The connection to the upstream failed; no further detail is returned.' },
  { code: 'BROKER_KEY_ECHO', status: 502, description: 'The upstream response contained the key (as is, base64 or percent-encoded) and was withheld.' },
  { code: 'BROKER_KEY_MISSING', status: 422, description: 'The secret has no value in the field the broker injects.' },
  { code: 'BROKER_UNSUPPORTED_TYPE', status: 422, description: 'Only an API Key, Token or Service Key secret, or a custom type with one sensitive field, can be used through the broker.' },
  { code: 'BROKER_ORIGINS_REQUIRED', status: 422, description: 'Enabling the broker for a secret needs at least one allowed origin.' },
  { code: 'BROKER_ORIGIN_INVALID', status: 422, description: 'An origin must be an exact public HTTPS origin (https://host[:port]): no userinfo, path or query, and not localhost, .local, .internal or a private IP address.' },
  { code: 'BROKER_FIELD_INVALID', status: 422, description: 'The broker field must name a sensitive field of the secret type.' },
  { code: 'BROKER_TOKEN_SECRET_INVALID', status: 422, description: 'A broker token can be restricted only to the caller\'s own secrets that have the broker switched on.' },

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

  // Service keys (issue #241). Contract: `@marinoscar/vault-contract/agent` and `/secret-types`.
  { code: 'SERVICE_KEY_AMBIGUOUS', status: 409, description: 'More than one service key opened to agents has this service and name, so none was released; keep one.' },
  { code: 'SERVICE_KEY_EXISTS', status: 409, description: 'You already have a service key with this service and key name; change that one instead.' },

  // Document images (attachment roles).
  { code: 'ATTACHMENT_ROLE_NOT_ALLOWED', status: 422, description: "The attachment role is not one of the image slots of the secret's type (Card: card_front, card_back; Passport: data_page, back; ID Document: front, back; a custom type: none)." },

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
