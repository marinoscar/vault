// =============================================================================
// The card as a scan profile (issue #204, IDOC-1)
// =============================================================================
// The first profile of the scan-profile registry. Built only from the existing
// card pieces (prompt, model schema, repair, normalizer), so the card scan's
// request and response are unchanged.

import { CARD_EXTRACT_FEATURE, OPENAI_REQUEST_TIMEOUT_MS } from './ai.constants';
import {
  CARD_EXTRACT_SCHEMA_NAME,
  CARD_EXTRACT_SYSTEM_PROMPT,
  cardExtractionModelSchema,
  toRawExtraction,
  type CardExtractionModelOutput,
} from './card-extraction.schema';
import type { RawExtraction } from './card-extraction.types';
import type { ExtractCardResult } from './card-extract.service';
import { normalizeExtractions } from './card-normalizer';
import type { ScanProfile } from './scan/scan-profile';

/** The card's registry key; permanent. */
export const CARD_SCAN_PROFILE_ID = 'card';

/**
 * The payment-card scan profile: a required `front` and an optional `back` image.
 *
 * @stability experimental
 */
export const cardScanProfile: ScanProfile<CardExtractionModelOutput, ExtractCardResult> = {
  id: CARD_SCAN_PROFILE_ID,
  aiFeature: CARD_EXTRACT_FEATURE,
  imageSlots: [
    { key: 'front', required: true, label: 'Front of the card' },
    { key: 'back', required: false, label: 'Back of the card' },
  ],
  schemaName: CARD_EXTRACT_SCHEMA_NAME,
  systemPrompt: CARD_EXTRACT_SYSTEM_PROMPT,
  modelSchema: cardExtractionModelSchema,
  timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
  userText: (images) =>
    images.back
      ? 'Image 1 is the FRONT of the card, image 2 is the BACK.'
      : 'Image 1 is the FRONT of the card; no back image was provided.',
  toRaw: (output, { model }) => toRawExtraction(output, model),
  normalize: (raw, { providedSlots }) => {
    const extraction = raw as RawExtraction;
    const normalized = normalizeExtractions([extraction]);
    return {
      fields: normalized.fields,
      confidence: normalized.confidence,
      warnings: normalized.warnings,
      model: extraction.model,
      crops: {
        front: normalized.crops.front,
        // A back box for an image that was never sent is a hallucination.
        back: providedSlots.includes('back') ? normalized.crops.back : null,
      },
      partial: normalized.partial,
    };
  },
  recordOutcome: (metrics, outcome) => metrics.cardExtracted(outcome),
};
