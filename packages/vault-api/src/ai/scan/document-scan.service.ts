import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AiError, type AiInputItem } from '@marinoscar/platform-api/ai';
import { type RequestUser } from '@marinoscar/platform-api/identity';

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
} from '../ai.errors';
import { VAULT_AI, VAULT_METRICS, type VaultAiPort, type VaultMetricsPort } from '../../ports';
import type { ScanOutcome, ScanProfile } from './scan-profile';
import { ScanProfileRegistry } from './scan-profile.registry';

/**
 * Runs one AI document scan for a registered {@link ScanProfile} (issue #204, IDOC-1).
 *
 * `AiService.forUser(userId, { orgId, feature })` runs the platform's gate pipeline (kill switch,
 * provider and model enablement, capability match, caps, key resolution, one usage row). This
 * service owns the generic part around it: one user message with the profile's text line and one
 * image part per provided slot in slot order, the timeout, the profile's repair and normalizer,
 * the error taxonomy the web already speaks, and the outcome metric.
 *
 * PERSISTS AND LOGS NOTHING about the document: the images and the extracted values exist only in
 * the request and the response. Log lines carry error codes only.
 *
 * @stability experimental
 */
@Injectable()
export class DocumentScanService {
  private readonly logger = new Logger(DocumentScanService.name);

  constructor(
    @Inject(VAULT_AI) private readonly ai: VaultAiPort,
    private readonly registry: ScanProfileRegistry,
    @Optional() @Inject(VAULT_METRICS) private readonly metrics?: VaultMetricsPort,
  ) {}

  /**
   * Scans `images` (data URLs keyed by slot) with the profile `profileId`. An absent or empty
   * optional slot is skipped; an absent required slot is `AI_INVALID_IMAGE`. Image validation
   * (type, size) is the caller's.
   */
  async extract<TResult = unknown>(
    profileId: string,
    user: RequestUser,
    images: Readonly<Record<string, string | null | undefined>>,
  ): Promise<TResult> {
    const profile = this.registry.get<unknown, TResult>(profileId);

    const provided: Record<string, string> = {};
    for (const slot of profile.imageSlots) {
      const url = images[slot.key];
      if (url) provided[slot.key] = url;
      else if (slot.required) {
        this.record(profile, 'invalid_image');
        throw aiInvalidImage(`Invalid image payload: ${slot.key}`);
      }
    }
    const providedSlots = profile.imageSlots.map((s) => s.key).filter((key) => key in provided);

    const input: AiInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'text', text: profile.userText(provided) },
          ...providedSlots.map((key) => ({ type: 'image' as const, url: provided[key], detail: 'high' as const })),
        ],
      },
    ];

    try {
      const result = await this.ai
        .forUser(user.id, { orgId: user.activeOrgId ?? undefined, feature: profile.aiFeature })
        .respondStructured(
          {
            schema: profile.modelSchema,
            schemaName: profile.schemaName,
            instructions: profile.systemPrompt,
            input,
            temperature: 0,
          },
          { signal: AbortSignal.timeout(profile.timeoutMs) },
        );

      const raw = profile.toRaw(result.parsed, { model: result.model });
      const normalized = profile.normalize(raw, { providedSlots, model: result.model });
      this.record(profile, 'succeeded');
      return normalized;
    } catch (error) {
      const mapped = this.mapError(error);
      this.record(profile, extractionOutcome(mapped.code));
      throw mapped;
    }
  }

  private record(profile: ScanProfile<unknown, unknown>, outcome: ScanOutcome): void {
    if (this.metrics) profile.recordOutcome?.(this.metrics, outcome);
  }

  /**
   * Platform failure to this feature's HTTP taxonomy (the codes the web already
   * handles). Never a 401/403 (the web reads a 401 as an expired session), and
   * never an upstream body: it can echo fragments of the images.
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
export function extractionOutcome(code: string): ScanOutcome {
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
