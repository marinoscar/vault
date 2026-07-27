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
  VisionImage,
} from '../vision-provider.interface';
import {
  OPENAI_CARD_JSON_SCHEMA,
  OPENAI_CARD_SCHEMA_NAME,
  OPENAI_CARD_SYSTEM_PROMPT,
  openAiCardResponseSchema,
} from './openai-card-schema';

const OPENAI_CHAT_COMPLETIONS_URL =
  'https://api.openai.com/v1/chat/completions';

/**
 * Maximum number of characters of an upstream error body kept for debug logs.
 */
const UPSTREAM_BODY_LOG_LIMIT = 500;

/**
 * OpenAI chat-completions vision provider.
 *
 * Uses Node 20's global `fetch` - this is the only outbound call the API makes,
 * and it is not worth an HTTP client dependency. There is deliberately no retry
 * loop: a card scan is user-initiated and interactive, so a fast, honest 502 is
 * better than silently spending 60 seconds and twice the money.
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

    const body = this.buildRequestBody(images, options.model);

    const response = await this.post(
      body,
      options.apiKey,
      options.timeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      await this.throwForStatus(response);
    }

    const payload = await this.readJson(response);
    return this.parseExtraction(payload, options.model);
  }

  // ---------------------------------------------------------------------------
  // Request
  // ---------------------------------------------------------------------------

  private buildRequestBody(images: VisionImage[], model: string) {
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
      model,
      // Transcription, not creativity. Any sampling here is pure downside.
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

  private async post(
    body: unknown,
    apiKey: string,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // DNS failure, connection reset, or our own AbortSignal.timeout firing.
      // The message may contain a hostname but never the key or the images.
      const reason = (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network error';
      this.logger.warn(`OpenAI request failed (${reason})`);
      throw new AiProviderError(
        'unavailable',
        `Vision provider unreachable (${reason})`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Failure classification
  // ---------------------------------------------------------------------------

  /**
   * Always throws. Split out so the status -> kind mapping is readable in one
   * place, and so the upstream body is handled exactly once.
   */
  private async throwForStatus(response: Response): Promise<never> {
    const bodyText = await this.readBodyForLog(response);

    // Debug level only, and scrubbed. OpenAI echoes fragments of the request
    // back inside error payloads, and our request contains base64 card images.
    this.logger.debug(
      `OpenAI responded ${response.status}: ${this.scrubUpstreamBody(bodyText)}`,
    );

    if (response.status === 401 || response.status === 403) {
      // NOT rethrown as 401/403 - see AI_ERROR_CODES.UPSTREAM_AUTH.
      throw new AiProviderError(
        'auth',
        'Vision provider rejected the configured credential',
      );
    }

    if (response.status === 429) {
      throw new AiProviderError(
        'rate_limited',
        'Vision provider rate limited the request',
        this.parseRetryAfter(response.headers.get('retry-after')),
      );
    }

    if (response.status >= 500) {
      throw new AiProviderError(
        'unavailable',
        'Vision provider is temporarily unavailable',
      );
    }

    // 400/404/422 etc: our request was malformed (bad model name, image the
    // provider refuses to decode). Not the user's session, not retryable.
    throw new AiProviderError(
      'invalid_output',
      'Vision provider rejected the request',
    );
  }

  private parseRetryAfter(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number.parseInt(header, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }

  private async readBodyForLog(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '<unreadable>';
    }
  }

  /**
   * Remove anything that could be a base64 image payload before logging.
   *
   * Belt and braces: the error body is only logged at debug, but debug logs get
   * turned on in production during incidents, which is exactly when a
   * reflected card image would be most damaging.
   */
  private scrubUpstreamBody(text: string): string {
    return text
      .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]*/g, '[image redacted]')
      .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[redacted]')
      .slice(0, UPSTREAM_BODY_LOG_LIMIT);
  }

  // ---------------------------------------------------------------------------
  // Response parsing
  // ---------------------------------------------------------------------------

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AiProviderError(
        'invalid_output',
        'Vision provider returned a non-JSON response',
      );
    }
  }

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
