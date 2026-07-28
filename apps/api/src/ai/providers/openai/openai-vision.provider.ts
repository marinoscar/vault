import { Injectable, Logger } from '@nestjs/common';

import { OPENAI_REQUEST_TIMEOUT_MS } from '../../ai.constants';
import {
  AiProviderError,
  AiVisionProvider,
  EXTRACTED_FIELD_NAMES,
  ExtractCardOptions,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
  VerifyModelResult,
  VisionImage,
} from '../vision-provider.interface';
import {
  OPENAI_CARD_JSON_SCHEMA,
  OPENAI_CARD_SCHEMA_NAME,
  OPENAI_CARD_SYSTEM_PROMPT,
  openAiCardResponseSchema,
} from './openai-card-schema';
import {
  OpenAiChatFailure,
  sendChatCompletion,
} from './openai-chat.client';
import { buildProbeRequestBody } from './openai-probe';

/**
 * OpenAI chat-completions vision provider.
 *
 * Uses Node 20's global `fetch` - this is the only outbound call the API makes,
 * and it is not worth an HTTP client dependency. There is deliberately no retry
 * loop for transient failures: a card scan is user-initiated and interactive,
 * so a fast, honest 502 is better than silently spending 60 seconds and twice
 * the money.
 *
 * The ONE exception is the adaptive-parameter retry in `sendChatCompletion`,
 * which fires only on a 400 that names one of our own sampling parameters. See
 * the extended note there before touching it.
 *
 * NO MODEL NAME APPEARS IN THIS FILE'S LOGIC. The model is an opaque string
 * supplied by the administrator; what it can and cannot do is discovered by
 * asking the API, never by pattern-matching its name.
 */
@Injectable()
export class OpenAiVisionProvider implements AiVisionProvider {
  private readonly logger = new Logger(OpenAiVisionProvider.name);

  async extractCard(
    images: VisionImage[],
    options: ExtractCardOptions,
  ): Promise<RawExtraction> {
    if (images.length === 0) {
      throw new AiProviderError('invalid_output', 'No images supplied');
    }

    const result = await sendChatCompletion(
      this.buildRequestBody(images, options.model),
      {
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS,
        logger: this.logger,
      },
    );

    if (!result.ok) {
      throw this.toProviderError(result);
    }

    return this.parseExtraction(result.payload, options.model);
  }

  /**
   * Empirical capability probe behind `POST /system-settings/ai/verify`.
   *
   * Sends one minimal request carrying an inline 1x1 PNG and a trivial
   * `json_schema` response format. A 200 proves, in a single call, that:
   *   - the credential authenticates
   *   - the model name resolves for that credential
   *   - the model accepts image input
   *   - the model honours strict structured outputs
   *
   * None of those four can be established by a lookup - `/v1/models` returns no
   * capability metadata - which is why this spends a fraction of a cent instead.
   */
  async verifyModel(options: ExtractCardOptions): Promise<VerifyModelResult> {
    const result = await sendChatCompletion(
      buildProbeRequestBody(options.model),
      {
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS,
        logger: this.logger,
      },
    );

    if (!result.ok) {
      throw this.toProviderError(result);
    }

    const payload = result.payload as any;

    // A 200 with no choices is not a proof of anything. Treated as an
    // unfamiliar shape rather than assumed to be a success.
    if (!Array.isArray(payload?.choices) || payload.choices.length === 0) {
      throw new AiProviderError(
        'invalid_output',
        'The provider accepted the request but returned no completion',
      );
    }

    return {
      model: typeof payload?.model === 'string' ? payload.model : options.model,
      droppedParameters: result.droppedParameters,
    };
  }

  // ---------------------------------------------------------------------------
  // Request
  // ---------------------------------------------------------------------------

  /**
   * No token-limit parameter is sent.
   *
   * `max_tokens` and `max_completion_tokens` are accepted by different model
   * families, and sending the wrong one is a 400 that fails the whole
   * extraction. Omitting both is valid everywhere, and the structured-output
   * schema already bounds the response to a handful of short strings, so a
   * limit would buy nothing but a truncation risk. If a limit is ever genuinely
   * needed, add it to ADAPTIVE_DROPPABLE_PARAMS rather than guessing the name.
   */
  private buildRequestBody(
    images: VisionImage[],
    model: string,
  ): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text:
          `Read the following payment card image(s): ` +
          images.map((image) => `${image.side} of the card`).join(', ') +
          `. The images are already cropped to the card.`,
      },
    ];

    for (const image of images) {
      content.push({
        type: 'image_url',
        image_url: { url: image.dataUrl, detail: 'high' },
      });
    }

    return {
      // Transcription, not creativity. Any sampling here is pure downside.
      // Sent optimistically: a model that rejects an explicit temperature
      // triggers the adaptive retry in sendChatCompletion, which resends
      // without it rather than failing every extraction.
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: OPENAI_CARD_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: OPENAI_CARD_SCHEMA_NAME,
          strict: true,
          schema: OPENAI_CARD_JSON_SCHEMA,
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Failure classification
  // ---------------------------------------------------------------------------

  /**
   * Map a classified upstream failure onto the provider error taxonomy.
   *
   * `kind` is what CardExtractService already switches on to pick an HTTP
   * status, and its meaning is unchanged. `detail` is additive and only carries
   * the extra precision the verify endpoint reports.
   *
   * The three capability/configuration reasons map to `unavailable` (502
   * AI_UPSTREAM_UNAVAILABLE) rather than `invalid_output` (422
   * AI_EXTRACTION_FAILED) because they are administrator misconfigurations. A
   * user told "try a sharper photo" will keep retaking a perfectly good photo
   * of a card the configured model was never going to be able to read.
   *
   * The upstream error body is never echoed into the thrown message. OpenAI
   * reflects fragments of the request back in its errors, and our request is
   * two base64 card images.
   */
  private toProviderError(failure: OpenAiChatFailure): AiProviderError {
    switch (failure.reason) {
      case 'auth':
        // NOT rethrown as 401/403 - see AI_ERROR_CODES.UPSTREAM_AUTH.
        return new AiProviderError(
          'auth',
          'Vision provider rejected the configured credential',
        );

      case 'quota':
        return new AiProviderError(
          'rate_limited',
          'The vision provider account has no remaining quota',
          failure.retryAfterSeconds,
          'quota',
        );

      case 'rate_limited':
        return new AiProviderError(
          'rate_limited',
          'Vision provider rate limited the request',
          failure.retryAfterSeconds,
        );

      case 'unavailable':
        return new AiProviderError(
          'unavailable',
          'Vision provider is temporarily unavailable',
        );

      case 'model_not_found':
        return new AiProviderError(
          'unavailable',
          'The configured model does not exist or is not available to this credential',
          undefined,
          'model_not_found',
        );

      case 'model_no_image_support':
        return new AiProviderError(
          'unavailable',
          'The configured model does not accept image input',
          undefined,
          'model_no_image_support',
        );

      case 'model_no_structured_output':
        return new AiProviderError(
          'unavailable',
          'The configured model does not support strict structured outputs',
          undefined,
          'model_no_structured_output',
        );

      case 'bad_request':
      default:
        // 400/422 with an unfamiliar cause: our request was rejected, but we
        // will not guess why. Not the user's session, not retryable.
        return new AiProviderError(
          'invalid_output',
          'Vision provider rejected the request',
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Response parsing
  // ---------------------------------------------------------------------------

  private parseExtraction(payload: unknown, model: string): RawExtraction {
    const choice = (payload as any)?.choices?.[0];

    // A refusal is a successful HTTP call with no content - the model declined.
    // Surfacing this as 422 rather than 502 tells the user to retake the photo
    // instead of implying the integration is broken.
    const refusal = choice?.message?.refusal;
    if (typeof refusal === 'string' && refusal.length > 0) {
      this.logger.debug('OpenAI returned a refusal');
      throw new AiProviderError('invalid_output', 'The model declined to read this image');
    }

    if (choice?.finish_reason === 'length') {
      throw new AiProviderError(
        'invalid_output',
        'The model response was truncated before it could be parsed',
      );
    }

    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AiProviderError(
        'invalid_output',
        'Vision provider returned an empty completion',
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new AiProviderError(
        'invalid_output',
        'Vision provider returned malformed JSON',
      );
    }

    const validated = openAiCardResponseSchema.safeParse(parsedJson);
    if (!validated.success) {
      // Only the Zod issue PATHS are logged. The issue values would be card
      // data.
      this.logger.debug(
        `OpenAI output failed schema validation at: ${validated.error.issues
          .map((issue) => issue.path.join('.'))
          .join(', ')}`,
      );
      throw new AiProviderError(
        'invalid_output',
        'Vision provider returned data that did not match the requested schema',
      );
    }

    const data = validated.data;

    const fields = {} as RawCardFields;
    const confidence = {} as RawCardConfidence;
    for (const name of EXTRACTED_FIELD_NAMES) {
      fields[name] = data[name];
      confidence[name] = data.confidence[name];
    }

    return {
      fields,
      confidence,
      warnings: data.warnings,
      model: typeof (payload as any)?.model === 'string' ? (payload as any).model : model,
    };
  }
}
