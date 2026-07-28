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
  /** OpenAI 5xx, network failure, or our request timeout. */
  UPSTREAM_UNAVAILABLE: 'AI_UPSTREAM_UNAVAILABLE',
  /** Call succeeded but the model refused, or its output did not validate. */
  EXTRACTION_FAILED: 'AI_EXTRACTION_FAILED',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/** Audit action used both for the audit trail and for the daily budget count. */
export const AI_CARD_EXTRACT_ACTION = 'ai.card.extract';

/**
 * Audit action for an admin-triggered connectivity/capability check.
 *
 * Separate from AI_CARD_EXTRACT_ACTION on purpose: these rows must NOT be
 * counted by the per-user daily extraction budget, and an admin repeatedly
 * testing a key should not consume a user's card-scanning allowance.
 */
export const AI_VERIFY_ACTION = 'ai.model.verify';

/**
 * Longest accepted model name, in characters.
 *
 * Deliberately a length bound and nothing else. It exists to stop an
 * unbounded string reaching a log line, an audit row and an outbound request
 * body - NOT to police the shape of a model name. Model naming is
 * provider-controlled and the next family will not match today's conventions;
 * a pattern or allowlist here would reject models that do not exist yet, which
 * is precisely what this feature exists to test empirically.
 *
 * Matches the bound on `ai.model` in the system settings schema
 * (`patchSystemSettingsSchema`), so a name that can be probed is a name that
 * can then be saved.
 */
export const MAX_MODEL_NAME_LENGTH = 100;

/**
 * Largest accepted data URL string, in characters.
 *
 * Base64 inflates by ~4/3, so this is roughly a 4.5 MB binary image. The
 * client now sends FULL, uncropped photos (the AI locates the card itself),
 * so the cap is sized for whole camera frames: two of these plus JSON
 * overhead must fit inside the 16 MiB Fastify `bodyLimit` set in main.ts.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;

/**
 * Hard ceiling on a single OpenAI call.
 *
 * 90s, not less: an extraction is ONE combined call carrying up to two
 * ~4.5 MB high-detail images, and vision models - the mini and reasoning
 * families included - routinely need well over 20s to answer it. The old 20s
 * value was tuned for the previous one-image-per-call flow; against the
 * combined call it made real extractions die at the ceiling and surface as
 * AI_UPSTREAM_UNAVAILABLE, while the admin's tiny verify probe kept passing.
 * The move from 60s to 90s tracks the move from cropped card images to full
 * uncropped photos: the uploads are roughly twice the bytes, so the upload
 * leg of the call takes correspondingly longer.
 *
 * Nginx's /api proxy_read_timeout (600s) comfortably exceeds this, so the
 * request cannot be cut off downstream first. The verify probe deliberately
 * keeps its own, shorter OPENAI_VERIFY_TIMEOUT_MS below.
 */
export const OPENAI_REQUEST_TIMEOUT_MS = 90_000;

/**
 * Hard ceiling on the verify probe.
 *
 * Shorter than an extraction: the probe sends a 70-byte image and expects a
 * one-property JSON object, so anything slower than this is a connectivity
 * problem the admin needs told about promptly - they are sitting watching a
 * spinner having just pressed a button.
 */
export const OPENAI_VERIFY_TIMEOUT_MS = 15_000;

/** In-memory burst window: 10 extractions per 5 minutes per user. */
export const BURST_WINDOW_MS = 5 * 60 * 1000;
export const BURST_MAX_IN_WINDOW = 10;

/**
 * Burst window for the verify probe: 5 checks per 5 minutes per admin.
 *
 * Modest on purpose. Each press of the button is an outbound, billable call to
 * a paid API, and there is no legitimate reason to press it in a loop - the
 * answer only changes when the key or model setting changes. Kept at or below
 * BURST_WINDOW_MS so the shared sweep in AiBurstLimiterService cannot age a
 * verify window out early.
 */
export const VERIFY_BURST_WINDOW_MS = 5 * 60 * 1000;
export const VERIFY_BURST_MAX_IN_WINDOW = 5;

/** Rolling window for the durable daily budget. */
export const DAILY_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
