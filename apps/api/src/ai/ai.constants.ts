// =============================================================================
// AI Feature Constants
// =============================================================================

/**
 * Error codes returned by the AI endpoints.
 *
 * Every one of these is deliberately distinct so the web client can tell an
 * "admin has not configured this yet" (503) apart from "OpenAI rejected our
 * key" (502) apart from "you are going too fast" (429).
 *
 * IMPORTANT: none of the upstream-provider failures map to 401/403.
 * `apps/web/src/services/api.ts` treats a 401 as an expired session: it fires a
 * token refresh, retries the request, and can log the user out if the refresh
 * fails. A bad OpenAI key must never be able to sign a user out, so an upstream
 * 401/403 surfaces here as 502 AI_UPSTREAM_AUTH.
 */
export const AI_ERROR_CODES = {
  /** AI disabled by the admin, or no API key stored. */
  NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  /** Key is stored but cannot be decrypted (vault key missing/rotated). */
  KEY_UNREADABLE: 'AI_KEY_UNREADABLE',
  /** Request body was not a pair of acceptable base64 image data URLs. */
  INVALID_IMAGE: 'AI_INVALID_IMAGE',
  /** Per-user in-memory burst window exhausted. */
  RATE_LIMITED: 'AI_RATE_LIMITED',
  /** Per-user durable daily budget exhausted. */
  QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  /** OpenAI rejected our credential (upstream 401/403). */
  UPSTREAM_AUTH: 'AI_UPSTREAM_AUTH',
  /** OpenAI rate limited us (upstream 429). */
  UPSTREAM_RATE_LIMITED: 'AI_UPSTREAM_RATE_LIMITED',
  /** OpenAI 5xx, network failure, or our 20s timeout. */
  UPSTREAM_UNAVAILABLE: 'AI_UPSTREAM_UNAVAILABLE',
  /** Call succeeded but the model refused, or its output did not validate. */
  EXTRACTION_FAILED: 'AI_EXTRACTION_FAILED',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/** Audit action used both for the audit trail and for the daily budget count. */
export const AI_CARD_EXTRACT_ACTION = 'ai.card.extract';

/**
 * Largest accepted data URL string, in characters.
 *
 * Base64 inflates by ~4/3, so this is roughly a 2 MB image. Two of these plus
 * JSON overhead must fit inside the 8 MiB Fastify `bodyLimit` set in main.ts.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 2_800_000;

/** Hard ceiling on a single OpenAI call. */
export const OPENAI_REQUEST_TIMEOUT_MS = 20_000;

/** In-memory burst window: 10 extractions per 5 minutes per user. */
export const BURST_WINDOW_MS = 5 * 60 * 1000;
export const BURST_MAX_IN_WINDOW = 10;

/** Rolling window for the durable daily budget. */
export const DAILY_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
