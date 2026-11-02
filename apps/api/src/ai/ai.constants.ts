// =============================================================================
// AI feature constants (card extraction over the platform AI slice, issue #87)
// =============================================================================

/**
 * Error codes of the card-scan routes (registered in
 * `app-registrations/error-codes.ts`). The platform's own `AI_*` codes are the
 * AI slice's; `CardExtractService` maps them onto these so the web's handling of
 * the scan flow does not change.
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

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/** The registered AI feature id (`app-registrations/ai.ts`); permanent, usage rows carry it. */
export const CARD_EXTRACT_FEATURE = 'card_extract';

/** Vault has one provider, OpenAI. */
export const AI_PROVIDER_ID = 'openai';

/**
 * Longest base64 data URL accepted for one card photo (about 4.5 MB of image);
 * two must fit in the 16 MiB Fastify `bodyLimit` set in `main.ts`.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;

/** Backstop for a wedged provider connection. */
export const OPENAI_REQUEST_TIMEOUT_MS = 90_000;
