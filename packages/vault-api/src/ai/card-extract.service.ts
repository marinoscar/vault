import { Inject, Injectable, Optional } from '@nestjs/common';

import { type RequestUser } from '@marinoscar/platform-api/identity';

import { aiInvalidImage } from './ai.errors';
import { CARD_SCAN_PROFILE_ID } from './card-scan.profile';
import type {
  CardCropBox,
  RawCardConfidence,
  RawCardFields,
} from './card-extraction.types';
import { extractCardSchema } from './dto/extract-card.dto';
import { DocumentScanService } from './scan/document-scan.service';
import { createScanProfileRegistry, type ScanProfileRegistry } from './scan/scan-profile.registry';
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
 * Since #204 (IDOC-1) the generic part (the platform call, the timeout, the
 * error taxonomy, the outcome metric) is `DocumentScanService` running the
 * `card` scan profile (`card-scan.profile.ts`); this service keeps the request
 * validation and its public contract.
 *
 * PERSISTS NOTHING about the card. The images and the extracted values exist
 * only in the request and the response; the platform records token counts, never
 * the input (and `ai.logPromptContent` logs text only, truncated). The security
 * code is never requested and is stripped by the normalizer.
 */
@Injectable()
export class CardExtractService {
  /**
   * Vault's metrics (E9.2, #90): one `app.vault.cards.extractions` count per request, labelled by
   * outcome only. Property-injected and optional so the constructor stays as the specs build it.
   * Nothing about the card, the images or the user is ever passed.
   */
  @Optional()
  @Inject(VAULT_METRICS)
  private readonly vaultMetrics?: VaultMetricsPort;

  /** The generic scan runner; property-injected so the constructor stays as the specs build it. */
  @Optional()
  @Inject(DocumentScanService)
  private readonly documentScan?: DocumentScanService;

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

    return this.scanner().extract<ExtractCardResult>(CARD_SCAN_PROFILE_ID, user, {
      front: parsed.data.front,
      back: parsed.data.back,
    });
  }

  /** The injected runner, or (built outside Nest) one over the built-in profiles and these ports. */
  private scanner(): DocumentScanService {
    return this.documentScan ?? new DocumentScanService(this.ai, defaultRegistry(), this.vaultMetrics);
  }

  /**
   * The model the `card_extract` feature runs on, for the status route and tests.
   */
  async configuredModel(): Promise<string> {
    const ai = await this.systemSettings.getNamespace<{ cardExtractModel: string }>('ai');
    return ai.cardExtractModel;
  }
}

let builtInRegistry: ScanProfileRegistry | undefined;

/** One shared registry of the built-in profiles for the out-of-Nest fallback. */
function defaultRegistry(): ScanProfileRegistry {
  return (builtInRegistry ??= createScanProfileRegistry());
}
