import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';

import { AI_VERIFY_ACTION, OPENAI_VERIFY_TIMEOUT_MS } from './ai.constants';
import { aiRateLimited } from './ai.errors';
import {
  AiBurstLimiterService,
  VERIFY_BURST,
} from './ai-burst-limiter.service';
import { AiConfigService } from './ai-config.service';
import {
  AI_VERIFY_FAILURE_MESSAGES,
  AiVerifyFailureReason,
  AiVerifyResult,
} from './dto/verify-ai.dto';
import {
  AI_VISION_PROVIDER,
  AiProviderError,
  AiVisionProvider,
} from './providers/vision-provider.interface';

/**
 * Admin connectivity/capability check for the configured AI provider.
 *
 * WHY THIS RETURNS 200 ON FAILURE
 *
 * The result is a discriminated union in the response BODY, not an HTTP error.
 * Two reasons:
 *
 *   1. A failed check is a successful diagnosis. "Your model name is wrong" is
 *      the answer the admin pressed the button to get, not an error condition
 *      of the endpoint.
 *   2. It makes it structurally impossible for an upstream 401 to become a
 *      client-facing 401. `apps/web/src/services/api.ts` treats any 401 as an
 *      expired session: it refreshes the token, retries, and can sign the user
 *      out. An admin pasting a typo'd OpenAI key must not be able to log
 *      themselves out of the application.
 *
 * The endpoint still throws for its OWN failures - not configured (503) and
 * rate limited (429) - because those are not diagnoses of the provider.
 *
 * NOTHING derived from the upstream error body is returned. Messages come from
 * a fixed table keyed by reason.
 */
@Injectable()
export class AiVerifyService {
  private readonly logger = new Logger(AiVerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfigService,
    private readonly burstLimiter: AiBurstLimiterService,
    @Inject(AI_VISION_PROVIDER)
    private readonly vision: AiVisionProvider,
  ) {}

  /**
   * Gate order mirrors the extraction path:
   *   1. configuration - nothing to verify without a stored key
   *   2. burst window  - this is an outbound paid call behind a button
   *   3. provider call - the only step that costs money
   */
  async verify(user: RequestUser): Promise<AiVerifyResult> {
    const config = await this.aiConfig.resolveForVerification();

    const burst = this.burstLimiter.consume(
      AiBurstLimiterService.verifyKey(user.id),
      Date.now(),
      VERIFY_BURST,
    );
    if (!burst.allowed) {
      throw aiRateLimited(burst.retryAfterSeconds);
    }

    const startedAt = Date.now();

    try {
      const probe = await this.vision.verifyModel({
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: OPENAI_VERIFY_TIMEOUT_MS,
      });

      const durationMs = Date.now() - startedAt;

      this.logger.log(
        `AI verification succeeded for model '${probe.model}' in ${durationMs}ms` +
          (probe.droppedParameters.length > 0
            ? ` (adapted: ${probe.droppedParameters.join(', ')})`
            : ''),
      );

      await this.audit(user.id, config.model, 'ok', durationMs, probe.droppedParameters);

      return {
        ok: true,
        model: probe.model,
        imageSupport: true,
        durationMs,
        adaptedParameters: probe.droppedParameters,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const reason = this.toReason(error);

      // The provider's own logger has already written the scrubbed upstream
      // body at debug. Only the classification is logged here.
      this.logger.warn(
        `AI verification failed for model '${config.model}': ${reason}`,
      );

      await this.audit(user.id, config.model, reason, durationMs, []);

      return {
        ok: false,
        reason,
        message: AI_VERIFY_FAILURE_MESSAGES[reason],
        model: config.model,
        durationMs,
        adaptedParameters: [],
      };
    }
  }

  /**
   * Map a provider failure onto a verify reason.
   *
   * `detail` carries the fine-grained cause when the provider was able to
   * establish one; `kind` is the fallback. Anything that is not an
   * `AiProviderError` at all is `unknown` - an unrecognised failure is reported
   * as unrecognised rather than guessed at.
   */
  private toReason(error: unknown): AiVerifyFailureReason {
    if (!(error instanceof AiProviderError)) {
      this.logger.error(
        `Unexpected AI verification failure: ${(error as Error)?.message}`,
      );
      return 'unknown';
    }

    switch (error.detail) {
      case 'model_not_found':
        return 'model_not_found';
      case 'model_no_image_support':
        return 'model_no_image_support';
      case 'model_no_structured_output':
        return 'model_no_structured_output';
      case 'quota':
        return 'quota';
      default:
        break;
    }

    switch (error.kind) {
      case 'auth':
        return 'invalid_key';
      // A plain 429 with no quota signal. Folded into `quota` because the
      // remedy an admin can act on is the same page - account limits - and the
      // message covers both.
      case 'rate_limited':
        return 'quota';
      case 'unavailable':
        return 'network';
      case 'invalid_output':
      default:
        return 'unknown';
    }
  }

  /**
   * Record the attempt.
   *
   * `meta` carries who/when (the row itself), the model, the outcome and the
   * duration. It must never carry the API key, any part of it, its length, or
   * anything derived from the upstream response body - audit rows are permanent
   * and are read by anyone with database access.
   *
   * Uses AI_VERIFY_ACTION, NOT AI_CARD_EXTRACT_ACTION: the daily extraction
   * budget counts the latter, and an admin testing a key must not consume it.
   *
   * A failure to audit does not fail the check - the admin still gets their
   * answer - but it is logged.
   */
  private async audit(
    userId: string,
    model: string,
    outcome: 'ok' | AiVerifyFailureReason,
    durationMs: number,
    adaptedParameters: string[],
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          action: AI_VERIFY_ACTION,
          targetType: 'ai_verification',
          targetId: userId,
          meta: {
            model,
            outcome,
            durationMs,
            adaptedParameters,
          } as any,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record AI verification audit event: ${(error as Error)?.message}`,
      );
    }
  }
}
