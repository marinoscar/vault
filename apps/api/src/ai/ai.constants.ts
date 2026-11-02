// =============================================================================
// AI feature constants (card extraction over the platform AI slice, issue #87)
// =============================================================================

/**
 * Error codes of the card-scan routes (defined in `@marinoscar/vault-contract/errors`, registered in
 * `app-registrations/error-codes.ts`). The platform's own `AI_*` codes are the AI slice's;
 * `CardExtractService` maps them onto these so the web's handling of the scan flow does not change.
 */
export { AI_ERROR_CODES, type AiErrorCode } from '@marinoscar/vault-contract/errors';

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
