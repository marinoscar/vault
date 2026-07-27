import { HttpException, HttpStatus } from '@nestjs/common';

import { AI_ERROR_CODES, AiErrorCode } from './ai.constants';

/**
 * Base class for every client-facing AI failure.
 *
 * Carries `retryAfterSeconds` so the controller can emit a `Retry-After`
 * header: NestJS `HttpException` has no header channel, and the global
 * `HttpExceptionFilter` writes the response with `reply.code().send()`, which
 * keeps headers already set on the reply but knows nothing about the exception.
 */
export class AiException extends HttpException {
  readonly code: AiErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(
    status: HttpStatus,
    code: AiErrorCode,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super({ code, message }, status);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const aiNotConfigured = () =>
  new AiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    AI_ERROR_CODES.NOT_CONFIGURED,
    'AI card scanning is not configured. An administrator must enable it and store an OpenAI API key in System Settings.',
  );

export const aiKeyUnreadable = () =>
  new AiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    AI_ERROR_CODES.KEY_UNREADABLE,
    'The stored OpenAI API key could not be decrypted. An administrator must re-enter it in System Settings.',
  );

export const aiInvalidImage = (detail?: string) =>
  new AiException(
    HttpStatus.BAD_REQUEST,
    AI_ERROR_CODES.INVALID_IMAGE,
    detail ??
      'Images must be base64 data URLs of type image/jpeg, image/png or image/webp, and within the size limit.',
  );

export const aiRateLimited = (retryAfterSeconds: number) =>
  new AiException(
    HttpStatus.TOO_MANY_REQUESTS,
    AI_ERROR_CODES.RATE_LIMITED,
    'Too many card scans in a short period. Please wait a moment and try again.',
    retryAfterSeconds,
  );

export const aiQuotaExceeded = (limit: number) =>
  new AiException(
    HttpStatus.TOO_MANY_REQUESTS,
    AI_ERROR_CODES.QUOTA_EXCEEDED,
    `Daily card scan limit of ${limit} reached. Please try again tomorrow or ask an administrator to raise the limit.`,
  );

/**
 * 502, never 401/403. An upstream credential problem is a server-side
 * misconfiguration; letting it reach the browser as a 401 would make
 * `apps/web/src/services/api.ts` refresh the token, retry, and potentially log
 * the user out over an admin's expired OpenAI key.
 */
export const aiUpstreamAuth = () =>
  new AiException(
    HttpStatus.BAD_GATEWAY,
    AI_ERROR_CODES.UPSTREAM_AUTH,
    'The AI provider rejected the configured API key. An administrator must check the key in System Settings.',
  );

export const aiUpstreamRateLimited = (retryAfterSeconds?: number) =>
  new AiException(
    HttpStatus.TOO_MANY_REQUESTS,
    AI_ERROR_CODES.UPSTREAM_RATE_LIMITED,
    'The AI provider is rate limiting requests. Please try again shortly.',
    retryAfterSeconds,
  );

export const aiUpstreamUnavailable = () =>
  new AiException(
    HttpStatus.BAD_GATEWAY,
    AI_ERROR_CODES.UPSTREAM_UNAVAILABLE,
    'The AI provider is temporarily unavailable. Please try again shortly.',
  );

export const aiExtractionFailed = () =>
  new AiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    AI_ERROR_CODES.EXTRACTION_FAILED,
    'The card could not be read from these images. Try again with a sharper, better-lit photo, or enter the details manually.',
  );
