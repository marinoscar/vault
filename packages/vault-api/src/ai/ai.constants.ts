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
 * Longest base64 data URL accepted for one scanned photo (about 4.5 MB of image);
 * two must fit in the 16 MiB Fastify `bodyLimit` set in `main.ts`. Defined once in the
 * contract so the card and document scan bodies share one value.
 */
export { MAX_IMAGE_DATA_URL_LENGTH } from '@marinoscar/vault-contract/secrets';

/** The registered AI feature id of document scanning (passport, ID document); permanent, usage rows carry it. */
export const DOCUMENT_EXTRACT_FEATURE = 'document_extract';

/** Backstop for a wedged provider connection. */
export const OPENAI_REQUEST_TIMEOUT_MS = 90_000;
