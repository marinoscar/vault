// =============================================================================
// OpenAI Chat Completions Transport
// =============================================================================
//
// One place where the outbound call is made, so the verify probe and the real
// extraction cannot drift apart. Both go through `sendChatCompletion`, which
// means the adaptive-parameter behaviour proven by a successful verify is
// literally the same code path an extraction will take.

import { Logger } from '@nestjs/common';

import { AiProviderError } from '../vision-provider.interface';
import {
  OpenAiErrorEnvelope,
  OpenAiUpstreamReason,
  classifyUpstreamError,
  detectUnsupportedParameter,
  parseErrorEnvelope,
  requestIncludesImage,
} from './openai-error-classifier';

export const OPENAI_CHAT_COMPLETIONS_URL =
  'https://api.openai.com/v1/chat/completions';

/** Maximum characters of an upstream error body kept for debug logs. */
const UPSTREAM_BODY_LOG_LIMIT = 500;

/**
 * Hard ceiling on adaptive retries.
 *
 * ONE. Not a loop, not a budget, not exponential backoff. A second attempt is
 * the difference between "every extraction fails on this model" and "it works";
 * a third attempt is just money. If the retried request fails again for any
 * reason - including naming a second unsupported parameter - that failure is
 * returned as-is.
 *
 * Do not turn this into a loop. See the note in docs/API.md.
 */
const MAX_ADAPTIVE_RETRIES = 1;

export interface OpenAiChatOptions {
  /** Plaintext credential. Never logged. */
  apiKey: string;
  timeoutMs: number;
  /**
   * Logger of the CALLING class, so log lines are attributed to the provider
   * rather than to this module.
   */
  logger: Logger;
}

export interface OpenAiChatSuccess {
  ok: true;
  /** Parsed response envelope. */
  payload: unknown;
  /** Parameters removed by the adaptive retry, in the order they were dropped. */
  droppedParameters: string[];
}

export interface OpenAiChatFailure {
  ok: false;
  status: number;
  reason: OpenAiUpstreamReason;
  envelope: OpenAiErrorEnvelope;
  retryAfterSeconds?: number;
  droppedParameters: string[];
}

export type OpenAiChatResult = OpenAiChatSuccess | OpenAiChatFailure;

/**
 * POST a chat-completions request, with at most one adaptive retry.
 *
 * Returns a discriminated result for anything the server answered, and throws
 * `AiProviderError('unavailable')` only for a transport failure (DNS, reset,
 * or our own timeout) - there is no response to classify in that case.
 *
 * THE ADAPTIVE RETRY, and why it is not dead code:
 *
 * `temperature: 0` is the right setting for transcription, but some model
 * families accept only their default temperature and reject any explicit value
 * with a 400 that names the parameter. The same is true of the two spellings of
 * the token limit. Rather than maintaining a table of which model wants which
 * parameter - a table that is a guess about every model released after this
 * comment was written - the request is sent optimistically and, if and only if
 * the 400 names one of our own droppable parameters, that parameter is removed
 * and the request is sent again exactly once.
 *
 * Determinism is a nice-to-have. Failing 100% of extractions is not.
 *
 * A genuine auth, quota, rate-limit, model-not-found or capability failure is
 * NEVER retried: `classifyUpstreamError` has to return `bad_request` before
 * `detectUnsupportedParameter` is even consulted.
 */
export async function sendChatCompletion(
  requestBody: Record<string, unknown>,
  options: OpenAiChatOptions,
): Promise<OpenAiChatResult> {
  const { logger } = options;
  const droppedParameters: string[] = [];
  let body: Record<string, unknown> = { ...requestBody };

  for (let attempt = 0; attempt <= MAX_ADAPTIVE_RETRIES; attempt++) {
    const response = await post(body, options);

    if (response.ok) {
      if (droppedParameters.length > 0) {
        logger.log(
          `OpenAI request succeeded after dropping unsupported parameter(s): ${droppedParameters.join(
            ', ',
          )}`,
        );
      }
      return {
        ok: true,
        payload: await readJson(response),
        droppedParameters,
      };
    }

    const bodyText = await readBodyForLog(response);

    // Debug level only, and scrubbed. OpenAI echoes fragments of the request
    // back inside error payloads - including the credential and, on an image
    // rejection, the image.
    logger.debug(
      `OpenAI responded ${response.status}: ${scrubUpstreamBody(
        bodyText,
        options.apiKey,
      )}`,
    );

    const envelope = parseErrorEnvelope(bodyText);
    const reason = classifyUpstreamError(
      response.status,
      envelope,
      requestIncludesImage(body),
    );

    // Only an otherwise-unexplained 400 is a retry candidate. Everything with a
    // real diagnosis - bad key, no quota, unknown model, no vision, no
    // structured outputs - is returned immediately.
    if (attempt < MAX_ADAPTIVE_RETRIES && reason === 'bad_request') {
      const unsupported = detectUnsupportedParameter(
        response.status,
        envelope,
        body,
      );

      if (unsupported) {
        logger.warn(
          `OpenAI rejected the '${unsupported}' parameter for model ` +
            `'${String(body.model)}'; retrying once without it. This is the ` +
            `adaptive-parameter fallback, not an error.`,
        );
        const { [unsupported]: _removed, ...rest } = body;
        body = rest;
        droppedParameters.push(unsupported);
        continue;
      }
    }

    return {
      ok: false,
      status: response.status,
      reason,
      envelope,
      retryAfterSeconds: parseRetryAfter(response.headers?.get?.('retry-after')),
      droppedParameters,
    };
  }

  // Unreachable: the loop either returns or `continue`s, and `continue` is
  // guarded by `attempt < MAX_ADAPTIVE_RETRIES`. Present so the function is
  // total for the type checker.
  /* istanbul ignore next */
  throw new AiProviderError(
    'unavailable',
    'Vision provider request exhausted its adaptive retry',
  );
}

async function post(
  body: unknown,
  options: OpenAiChatOptions,
): Promise<Response> {
  try {
    return await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    // DNS failure, connection reset, or our own AbortSignal.timeout firing.
    // The message may contain a hostname but never the key or the images.
    const reason =
      (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network error';
    options.logger.warn(`OpenAI request failed (${reason})`);
    throw new AiProviderError(
      'unavailable',
      `Vision provider unreachable (${reason})`,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AiProviderError(
      'invalid_output',
      'Vision provider returned a non-JSON response',
    );
  }
}

async function readBodyForLog(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable>';
  }
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Remove anything sensitive the provider may have reflected back, before
 * logging.
 *
 * Belt and braces: the error body is only logged at debug, but debug logs get
 * turned on in production during incidents, which is exactly when a reflected
 * card image or credential would be most damaging.
 *
 * Three passes, in order:
 *   1. The credential itself, matched literally. This is the strongest of the
 *      three because it does not depend on guessing the key's FORMAT - OpenAI's
 *      auth error is literally "Incorrect API key provided: <the key>", and a
 *      proxy in front of the API can echo anything it likes.
 *   2. `sk-`-prefixed tokens, for a credential that reached the log by some
 *      other route (a stale key in a message, a second key in a proxy error).
 *   3. Base64 image payloads and long bare blobs - our request body is two
 *      photographs of a payment card.
 */
export function scrubUpstreamBody(text: string, apiKey?: string): string {
  let scrubbed = text;

  // Literal match. `split`/`join` rather than a RegExp so no character in the
  // key can be interpreted as a pattern.
  if (apiKey && apiKey.length >= 8) {
    scrubbed = scrubbed.split(apiKey).join('[credential redacted]');
  }

  return scrubbed
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, '[credential redacted]')
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]*/g, '[image redacted]')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[redacted]')
    .slice(0, UPSTREAM_BODY_LOG_LIMIT);
}
