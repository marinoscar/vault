import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AiError, type AiInputItem } from '@marinoscar/platform-api/ai';
import { type RequestUser } from '@marinoscar/platform-api/identity';


import { CARD_EXTRACT_FEATURE, OPENAI_REQUEST_TIMEOUT_MS } from './ai.constants';
import {
  aiExtractionFailed,
  aiInvalidImage,
  aiNotConfigured,
  aiQuotaExceeded,
  aiRateLimited,
  aiUpstreamAuth,
  aiUpstreamRateLimited,
  aiUpstreamUnavailable,
  AiException,
} from './ai.errors';
import { normalizeExtractions } from './card-normalizer';

import type { CARD_EXTRACTION_OUTCOMES } from '../core/metric-labels';
import {
  CARD_EXTRACT_SCHEMA_NAME,
  CARD_EXTRACT_SYSTEM_PROMPT,
  cardExtractionModelSchema,
  toRawExtraction,
} from './card-extraction.schema';
import type {
  CardCropBox,
  RawCardConfidence,
  RawCardFields,
} from './card-extraction.types';
import { extractCardSchema } from './dto/extract-card.dto';
import {
  VAULT_AI,
  VAULT_METRICS,
  VAULT_SETTINGS,
  type VaultAiPort,
  type VaultMetricsPort,
  type VaultSettingsPort,
} from '../ports';

export interface ExtractCardResult {
  fields: RawCardFields;
  confidence: RawCardConfidence;
  warnings: string[];
  model: string;
  /**
   * AI-located card bounding box per supplied image, in fractions (0-1) of
   * that image exactly as sent, plus the clockwise quarter-turns that make
   * the crop read upright. Null when the image was absent or no card was
   * visible in it.
   */
  crops: { front: CardCropBox | null; back: CardCropBox | null };
  /** True when the call succeeded but nothing legible came back. */
  partial: boolean;
}

/**
 * Card extraction over the platform AI slice (issue #87, E8.1).
 *
 * `AiService.forUser(userId, { orgId, feature: 'card_extract' })` runs the whole
 * gate pipeline: kill switch, provider and model enablement, capability match
 * (the `card_extract` feature needs `responses` + image input), the per-user
 * caps of `ai.limits`, key resolution (the deployment key `('ai','openai')`)
 * and one `ai_usage_events` row. This service owns only the card rules: the
 * prompt, the image payload shape, the normalizer, and the error taxonomy the
 * web already speaks.
 *
 * PERSISTS NOTHING about the card. The images and the extracted values exist
 * only in the request and the response; the platform records token counts, never
 * the input (and `ai.logPromptContent` logs text only, truncated). The security
 * code is never requested and is stripped by the normalizer.
 */
@Injectable()
export class CardExtractService {
  private readonly logger = new Logger(CardExtractService.name);

  /**
   * Vault's metrics (E9.2, #90): one `app.vault.cards.extractions` count per request, labelled by
   * outcome only. Property-injected and optional so the constructor stays as the specs build it.
   * Nothing about the card, the images or the user is ever passed.
   */
  @Optional()
  @Inject(VAULT_METRICS)
  private readonly vaultMetrics?: VaultMetricsPort;

  constructor(
    @Inject(VAULT_AI) private readonly ai: VaultAiPort,
    @Inject(VAULT_SETTINGS) private readonly systemSettings: VaultSettingsPort,
  ) {}

  async extract(body: unknown, user: RequestUser): Promise<ExtractCardResult> {
    const parsed = extractCardSchema.safeParse(body);
    if (!parsed.success) {
      this.vaultMetrics?.cardExtracted('invalid_image');
      // The issue paths are safe to echo (field names). The values are image bytes.
      throw aiInvalidImage(
        `Invalid image payload: ${parsed.error.issues
          .map((issue) => issue.path.join('.') || 'body')
          .join(', ')}`,
      );
    }

    const orgId = user.activeOrgId ?? undefined;
    const sides = [parsed.data.front, ...(parsed.data.back ? [parsed.data.back] : [])];
    const input: AiInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              sides.length > 1
                ? 'Image 1 is the FRONT of the card, image 2 is the BACK.'
                : 'Image 1 is the FRONT of the card; no back image was provided.',
          },
          ...sides.map((url) => ({ type: 'image' as const, url, detail: 'high' as const })),
        ],
      },
    ];

    try {
      const result = await this.ai
        .forUser(user.id, { orgId, feature: CARD_EXTRACT_FEATURE })
        .respondStructured(
          {
            schema: cardExtractionModelSchema,
            schemaName: CARD_EXTRACT_SCHEMA_NAME,
            instructions: CARD_EXTRACT_SYSTEM_PROMPT,
            input,
            temperature: 0,
          },
          { signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS) },
        );

      const raw = toRawExtraction(result.parsed, result.model);
      const normalized = normalizeExtractions([raw]);
      this.vaultMetrics?.cardExtracted('succeeded');
      return {
        fields: normalized.fields,
        confidence: normalized.confidence,
        warnings: normalized.warnings,
        model: raw.model,
        crops: {
          front: normalized.crops.front,
          // A back box for an image that was never sent is a hallucination.
          back: sides.length > 1 ? normalized.crops.back : null,
        },
        partial: normalized.partial,
      };
    } catch (error) {
      const mapped = this.mapError(error);
      this.vaultMetrics?.cardExtracted(extractionOutcome(mapped.code));
      throw mapped;
    }
  }

  /**
   * The model the `card_extract` feature runs on, for the status route and tests.
   */
  async configuredModel(): Promise<string> {
    const ai = await this.systemSettings.getNamespace<{ cardExtractModel: string }>('ai');
    return ai.cardExtractModel;
  }

  /**
   * Platform failure to this feature's HTTP taxonomy (the codes the web already
   * handles). Never a 401/403 (the web reads a 401 as an expired session), and
   * never an upstream body: it can echo fragments of two card images.
   */
  private mapError(error: unknown): AiException {
    if (error instanceof AiException) return error;

    if (AiError.isAiError(error)) {
      switch (error.code) {
        case 'AI_DISABLED':
        case 'AI_PROVIDER_DISABLED':
        case 'AI_KEY_REQUIRED':
        case 'AI_MODEL_NOT_ENABLED':
        case 'AI_MODEL_NOT_REACHABLE':
        case 'AI_CAPABILITY_UNSUPPORTED':
          this.logger.warn(`Card extraction unavailable: ${error.code}`);
          return aiNotConfigured();
        case 'AI_RATE_LIMITED': {
          const retryAfterSeconds = error.retryAfterMs
            ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
            : undefined;
          const limit = String(error.getResponse().details.limit ?? '');
          // A provider-side throttle names no platform limit.
          if (!limit) return aiUpstreamRateLimited(retryAfterSeconds);
          return /perminute/i.test(limit)
            ? aiRateLimited(retryAfterSeconds ?? 60)
            : aiQuotaExceeded(retryAfterSeconds);
        }
        case 'AI_KEY_INVALID':
          this.logger.error('AI provider rejected the configured API key');
          return aiUpstreamAuth();
        case 'AI_STRUCTURED_OUTPUT_INVALID':
        case 'AI_CONTENT_FILTERED':
        case 'AI_INVALID_REQUEST':
          this.logger.warn(`AI extraction failed: ${error.code}`);
          return aiExtractionFailed();
        default:
          this.logger.warn(`AI provider unavailable: ${error.code}`);
          return aiUpstreamUnavailable();
      }
    }

    this.logger.error(`Unexpected AI failure: ${(error as Error)?.name}`);
    return aiUpstreamUnavailable();
  }
}

/** The metric outcome for a mapped failure code (`AI_ERROR_CODES`); anything unlisted is `failed`. */
function extractionOutcome(code: string): (typeof CARD_EXTRACTION_OUTCOMES)[number] {
  switch (code) {
    case 'AI_NOT_CONFIGURED':
      return 'not_configured';
    case 'AI_RATE_LIMITED':
      return 'rate_limited';
    case 'AI_QUOTA_EXCEEDED':
      return 'quota_exceeded';
    case 'AI_UPSTREAM_RATE_LIMITED':
    case 'AI_UPSTREAM_AUTH':
    case 'AI_UPSTREAM_UNAVAILABLE':
      return 'upstream_error';
    case 'AI_INVALID_IMAGE':
      return 'invalid_image';
    default:
      return 'failed';
  }
}
