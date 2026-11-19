import { ApiError } from './api.js';
import { AI_DISABLED_REASON, AI_ERROR_CODES, type AiErrorCode } from './types.js';

/**
 * A scan failure rendered for a human (card or document scan).
 *
 * `detail` is written to tell the user what to do next, which is why the
 * per-code branches exist at all — "Too many requests" is true for both the
 * burst limiter and the daily budget, and useless for either.
 */
export interface ScanErrorMessage {
  title: string;
  detail: string;
  /** True when only an administrator can clear the condition. */
  adminActionRequired: boolean;
  /** True when retrying the same images could plausibly succeed. */
  retryable: boolean;
  /**
   * Where an administrator fixes it, when the page should offer a link there
   * (shown only to a viewer who can open it: `ai_config:read`).
   */
  adminLink?: { label: string; to: string };
}

/**
 * What is being scanned, as the messages name it: `noun` ("card",
 * "document") and its plural. Every sentence of {@link describeScanError} is
 * built from these two words, so the card and the document flows read alike.
 */
export interface ScanSubject {
  noun: string;
  plural: string;
}

/** The card scan's wording (`describeCardExtractionError`). */
export const CARD_SCAN_SUBJECT: ScanSubject = { noun: 'card', plural: 'cards' };

/** The document scan's wording (Passport and ID Document). */
export const DOCUMENT_SCAN_SUBJECT: ScanSubject = { noun: 'document', plural: 'documents' };

/** The Console's AI page, where AI is switched on and set up. */
export const AI_SETTINGS_PATH = '/admin/settings/ai';

const AI_SETTINGS_LINK = { label: 'Open Console → AI', to: AI_SETTINGS_PATH } as const;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** AI switched off by an administrator (the platform kill switch's 403). */
export function scanDisabledMessage(subject: ScanSubject): ScanErrorMessage {
  return {
    title: 'AI is off',
    detail: `AI is off — an admin can turn it on in Console → AI. You can still enter the ${subject.noun} details yourself.`,
    adminActionRequired: true,
    retryable: false,
    adminLink: AI_SETTINGS_LINK,
  };
}

/** AI on, but the provider, model or key is not set up (503 `AI_NOT_CONFIGURED`). */
export function scanNotConfiguredMessage(subject: ScanSubject): ScanErrorMessage {
  return {
    title: 'AI is not set up yet',
    detail: `AI is not set up yet — an administrator needs to add the OpenAI key and choose the ${subject.noun} scanning model in Console → AI. You can still enter the ${subject.noun} details yourself.`,
    adminActionRequired: true,
    retryable: false,
    adminLink: AI_SETTINGS_LINK,
  };
}

/** The caller may not use AI (a `403` without `AI_DISABLED`: no `ai:use`). */
export function scanForbiddenMessage(subject: ScanSubject): ScanErrorMessage {
  return {
    title: `${capitalize(subject.noun)} scanning is not available to you`,
    detail: `Your role does not include AI features. Enter the ${subject.noun} details yourself, or ask an administrator.`,
    adminActionRequired: true,
    retryable: false,
  };
}

/** `details.reason` of an API error, when it is a string. */
function detailReason(error: ApiError | null): string | undefined {
  const reason = (error?.details as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

const AI_ERROR_CODE_VALUES: readonly string[] = Object.values(AI_ERROR_CODES);

function isAiErrorCode(code: string | undefined): code is AiErrorCode {
  return code !== undefined && AI_ERROR_CODE_VALUES.includes(code);
}

/**
 * Map a scan (extraction) failure to an actionable message, worded for
 * `subject`.
 *
 * AI switched off is checked first: the platform kill switch answers `403` with
 * top-level code `FORBIDDEN` and `details.reason: 'AI_DISABLED'` (E8.1; it was a
 * 503 before). Any other 403 means the caller lacks `ai:use`. Then the API's
 * `AI_*` `code`, then the HTTP status. Codes are matched against the known
 * `AI_*` set rather than trusted blindly, so a status-derived stand-in
 * ('TOO_MANY_REQUESTS', 'BAD_REQUEST') falls through to the status branch.
 * Message text is never parsed: it is copy, and it will be reworded.
 */
export function describeScanError(error: unknown, subject: ScanSubject): ScanErrorMessage {
  const apiError = error instanceof ApiError ? error : null;
  const code = isAiErrorCode(apiError?.code) ? apiError.code : undefined;
  const status = apiError?.status;
  const { noun, plural } = subject;
  const unreadable: ScanErrorMessage = {
    title: `The ${noun} could not be read`,
    detail: 'Try again with a sharper, better-lit photo, or enter the details yourself below.',
    adminActionRequired: false,
    retryable: true,
  };
  const badImages: ScanErrorMessage = {
    title: 'Those photos could not be sent',
    detail: 'The images were not accepted. Retake the photos and try again.',
    adminActionRequired: false,
    retryable: true,
  };

  if (detailReason(apiError) === AI_DISABLED_REASON || apiError?.code === AI_DISABLED_REASON) {
    return scanDisabledMessage(subject);
  }
  if (status === 403) return scanForbiddenMessage(subject);

  switch (code) {
    case AI_ERROR_CODES.NOT_CONFIGURED:
      return scanNotConfiguredMessage(subject);
    case AI_ERROR_CODES.INVALID_IMAGE:
      return badImages;
    case AI_ERROR_CODES.RATE_LIMITED:
      return {
        title: 'Too many scans just now',
        detail: `You have scanned several ${plural} in a short period. Wait a moment and try again shortly.`,
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.QUOTA_EXCEEDED:
      return {
        title: 'Daily scan limit reached',
        detail: `You have used your daily ${noun} scan allowance. Try again tomorrow, or ask an administrator to raise the limit.`,
        adminActionRequired: false,
        retryable: false,
      };
    case AI_ERROR_CODES.UPSTREAM_AUTH:
      return {
        title: `${capitalize(noun)} scanning is unavailable`,
        detail:
          'The AI provider rejected the configured API key. An administrator needs to check it in Console → AI.',
        adminActionRequired: true,
        retryable: false,
        adminLink: AI_SETTINGS_LINK,
      };
    case AI_ERROR_CODES.UPSTREAM_RATE_LIMITED:
      return {
        title: 'The AI provider is busy',
        detail: 'The provider is rate limiting requests. Try again shortly.',
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.UPSTREAM_UNAVAILABLE:
      return {
        title: 'The AI provider is unavailable',
        detail: `The provider could not be reached. Try again shortly, or enter the ${noun} details yourself.`,
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.EXTRACTION_FAILED:
      return unreadable;
    default:
      break;
  }

  switch (status) {
    case 400:
      return badImages;
    case 422:
      return unreadable;
    case 429:
      // A 429 without a recognised code: the wording covers both the burst limit
      // and the daily cap without claiming either.
      return {
        title: 'Scan limit reached',
        detail: `You have hit a ${noun} scan limit — either too many scans in a short period, or your daily allowance. Wait a few minutes and try again; if it persists you are out of scans for today.`,
        adminActionRequired: false,
        retryable: true,
      };
    case 502:
      return {
        title: 'The AI provider is unavailable',
        detail: `The provider could not be reached, or rejected the configured API key. Try again shortly, or enter the ${noun} details yourself.`,
        adminActionRequired: false,
        retryable: true,
      };
    case 503:
      return scanNotConfiguredMessage(subject);
    default:
      return {
        title: `The ${noun} could not be read`,
        detail:
          error instanceof Error && error.message
            ? error.message
            : `Something went wrong reading the ${noun}. Enter the details yourself below.`,
        adminActionRequired: false,
        retryable: true,
      };
  }
}
