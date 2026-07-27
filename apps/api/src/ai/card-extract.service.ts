import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';

import {
  AI_CARD_EXTRACT_ACTION,
  DAILY_BUDGET_WINDOW_MS,
  OPENAI_REQUEST_TIMEOUT_MS,
} from './ai.constants';
import {
  aiExtractionFailed,
  aiInvalidImage,
  aiQuotaExceeded,
  aiRateLimited,
  aiUpstreamAuth,
  aiUpstreamRateLimited,
  aiUpstreamUnavailable,
  AiException,
} from './ai.errors';
import { AiBurstLimiterService } from './ai-burst-limiter.service';
import { AiConfigService, ResolvedAiConfig } from './ai-config.service';
import { normalizeExtractions } from './card-normalizer';
import { extractCardSchema } from './dto/extract-card.dto';
import {
  AI_VISION_PROVIDER,
  AiProviderError,
  AiVisionProvider,
  EXTRACTED_FIELD_NAMES,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
  VisionImage,
} from './providers/vision-provider.interface';

export interface ExtractCardResult {
  fields: RawCardFields;
  confidence: RawCardConfidence;
  warnings: string[];
  model: string;
  /** True when the call succeeded but nothing legible came back. */
  partial: boolean;
}

type ExtractOutcome =
  | 'started'
  | 'success'
  | 'partial'
  | 'upstream_error'
  | 'extraction_failed';

/**
 * Card extraction orchestration.
 *
 * PERSISTS NOTHING about the card. The only row this writes is an
 * `audit_events` record carrying counts and timings - never an image, never a
 * field value. The extracted data exists only in the HTTP response, and it is
 * the user who decides on the review screen whether any of it becomes a secret.
 */
@Injectable()
export class CardExtractService {
  private readonly logger = new Logger(CardExtractService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfigService,
    private readonly burstLimiter: AiBurstLimiterService,
    @Inject(AI_VISION_PROVIDER)
    private readonly vision: AiVisionProvider,
  ) {}

  /**
   * Gate order is deliberate:
   *   1. configuration  - if the feature is off, nothing else is worth checking
   *   2. input shape    - cheap, deterministic, no I/O
   *   3. burst window   - in-memory, protects the provider from a stuck client
   *   4. daily budget   - one DB count, protects the bill
   *   5. provider call  - the only step that costs money
   */
  async extract(body: unknown, user: RequestUser): Promise<ExtractCardResult> {
    const config = await this.aiConfig.resolveForExtraction();

    const parsed = extractCardSchema.safeParse(body);
    if (!parsed.success) {
      // The issue paths are safe to echo (they are field names). The issue
      // values are image bytes and must not be.
      throw aiInvalidImage(
        `Invalid image payload: ${parsed.error.issues
          .map((issue) => issue.path.join('.') || 'body')
          .join(', ')}`,
      );
    }

    const burst = this.burstLimiter.consume(user.id);
    if (!burst.allowed) {
      throw aiRateLimited(burst.retryAfterSeconds);
    }

    await this.assertWithinDailyBudget(user.id, config.maxCallsPerUserPerDay);

    const images: VisionImage[] = [{ side: 'front', dataUrl: parsed.data.front }];
    if (parsed.data.back) {
      images.push({ side: 'back', dataUrl: parsed.data.back });
    }

    return this.runExtraction(images, config, user.id);
  }

  // ---------------------------------------------------------------------------
  // Budget
  // ---------------------------------------------------------------------------

  /**
   * Durable per-user daily budget.
   *
   * Counts `audit_events` rows rather than keeping a counter, which means it
   * survives restarts and is correct across replicas without introducing a
   * table, a migration, or a Redis dependency. The audit row is written BEFORE
   * the provider call precisely so that budget is reserved even if the process
   * dies mid-request - a counter incremented on success would let a crash loop
   * spend without ever being counted.
   */
  private async assertWithinDailyBudget(
    userId: string,
    limit: number,
  ): Promise<void> {
    if (!Number.isFinite(limit) || limit <= 0) {
      throw aiQuotaExceeded(limit);
    }

    const since = new Date(Date.now() - DAILY_BUDGET_WINDOW_MS);
    const used = await this.prisma.auditEvent.count({
      where: {
        actorUserId: userId,
        action: AI_CARD_EXTRACT_ACTION,
        createdAt: { gte: since },
      },
    });

    if (used >= limit) {
      this.logger.warn(
        `User ${userId} hit the daily AI card extraction budget (${used}/${limit})`,
      );
      throw aiQuotaExceeded(limit);
    }
  }

  // ---------------------------------------------------------------------------
  // Provider orchestration
  // ---------------------------------------------------------------------------

  private async runExtraction(
    images: VisionImage[],
    config: ResolvedAiConfig,
    userId: string,
  ): Promise<ExtractCardResult> {
    const auditId = await this.beginAudit(userId, images.length, config.model);
    const startedAt = Date.now();

    try {
      const sources = await this.callProvider(images, config);
      const normalized = normalizeExtractions(sources);

      const result: ExtractCardResult = {
        fields: normalized.fields,
        confidence: normalized.confidence,
        warnings: normalized.warnings,
        model: sources[0]?.model ?? config.model,
        partial: normalized.partial,
      };

      await this.finishAudit(
        auditId,
        normalized.partial ? 'partial' : 'success',
        Date.now() - startedAt,
      );

      return result;
    } catch (error) {
      const mapped = this.mapProviderError(error);
      await this.finishAudit(
        auditId,
        mapped.getStatus() === 422 ? 'extraction_failed' : 'upstream_error',
        Date.now() - startedAt,
        mapped.code,
      );
      throw mapped;
    }
  }

  /**
   * One provider call per side.
   *
   * Each side must produce its OWN per-field confidence, otherwise
   * "prefer the higher-confidence source" in the merge has nothing to compare.
   *
   * The front is required; a failure there fails the request. A failure on the
   * BACK only downgrades to a warning - the number, expiry and cardholder name
   * all live on the front, so discarding a perfectly good front scan because
   * the second call timed out would be a worse outcome than a partial answer
   * the user can complete by hand.
   */
  private async callProvider(
    images: VisionImage[],
    config: ResolvedAiConfig,
  ): Promise<RawExtraction[]> {
    const options = {
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
    };

    const [front, ...rest] = images;

    const settled = await Promise.allSettled([
      this.vision.extractCard([front], options),
      ...rest.map((image) => this.vision.extractCard([image], options)),
    ]);

    const [frontResult, ...restResults] = settled;

    if (frontResult.status === 'rejected') {
      throw frontResult.reason;
    }

    const sources: RawExtraction[] = [frontResult.value];

    for (const outcome of restResults) {
      if (outcome.status === 'fulfilled') {
        sources.push(outcome.value);
      } else {
        this.logger.warn(
          `Back-of-card extraction failed, continuing with the front only: ${
            (outcome.reason as Error)?.message
          }`,
        );
        sources.push(emptyExtraction(config.model, [
          'The back of the card could not be read. Any details only printed on the back will need to be entered manually.',
        ]));
      }
    }

    return sources;
  }

  /**
   * Translate a provider failure into this feature's HTTP taxonomy.
   *
   * Note what is NOT here: 401 and 403. An upstream credential rejection
   * becomes 502 AI_UPSTREAM_AUTH, because `apps/web/src/services/api.ts` reads
   * a 401 as an expired session - it would refresh the token, retry, and can
   * sign the user out over a stale OpenAI key.
   *
   * The upstream error body is never echoed. OpenAI reflects fragments of the
   * request back in its errors, and our request is two base64 card images.
   */
  private mapProviderError(error: unknown): AiException {
    if (error instanceof AiException) {
      return error;
    }

    if (error instanceof AiProviderError) {
      switch (error.kind) {
        case 'auth':
          this.logger.error(
            'AI provider rejected the configured API key (upstream 401/403)',
          );
          return aiUpstreamAuth();
        case 'rate_limited':
          return aiUpstreamRateLimited(error.retryAfterSeconds);
        case 'invalid_output':
          this.logger.warn(`AI extraction failed: ${error.message}`);
          return aiExtractionFailed();
        case 'unavailable':
        default:
          this.logger.warn(`AI provider unavailable: ${error.message}`);
          return aiUpstreamUnavailable();
      }
    }

    // Anything unclassified is treated as an upstream problem rather than a 500:
    // the message is unknown, so it must not reach the client.
    this.logger.error(
      `Unexpected AI provider failure: ${(error as Error)?.message}`,
    );
    return aiUpstreamUnavailable();
  }

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  /**
   * Write the attempt row before the provider is called.
   *
   * `meta` carries counts, the model name and (later) a duration and outcome.
   * It must never carry an image, a field value, a confidence score or any part
   * of the API key: audit rows are permanent and are read by anyone with
   * database access.
   */
  private async beginAudit(
    userId: string,
    imageCount: number,
    model: string,
  ): Promise<string | null> {
    try {
      const event = await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          action: AI_CARD_EXTRACT_ACTION,
          targetType: 'ai_card_extract',
          // Non-nullable in the schema. The subject of the event is the user
          // whose quota it consumes, which also makes the
          // (targetType, targetId) index useful for per-user spend queries.
          targetId: userId,
          meta: {
            imageCount,
            model,
            durationMs: null,
            outcome: 'started' as ExtractOutcome,
          } as any,
        },
        select: { id: true },
      });
      return event.id;
    } catch (error) {
      // Auditing must not break the feature, but a failure here also means the
      // daily budget under-counts this call, so it is logged loudly.
      this.logger.error(
        `Failed to record AI extraction audit event: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  private async finishAudit(
    auditId: string | null,
    outcome: ExtractOutcome,
    durationMs: number,
    errorCode?: string,
  ): Promise<void> {
    if (!auditId) return;

    try {
      const existing = await this.prisma.auditEvent.findUnique({
        where: { id: auditId },
        select: { meta: true },
      });

      await this.prisma.auditEvent.update({
        where: { id: auditId },
        data: {
          meta: {
            ...((existing?.meta as Record<string, unknown>) ?? {}),
            durationMs,
            outcome,
            ...(errorCode ? { errorCode } : {}),
          } as any,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to finalise AI extraction audit event: ${(error as Error)?.message}`,
      );
    }
  }
}

function emptyExtraction(model: string, warnings: string[]): RawExtraction {
  const fields = {} as RawCardFields;
  const confidence = {} as RawCardConfidence;
  for (const name of EXTRACTED_FIELD_NAMES) {
    fields[name] = null;
    confidence[name] = 0;
  }
  return { fields, confidence, warnings, model };
}
