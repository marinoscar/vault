import type { AiModel } from '@marinoscar/platform-web/ai/headless';
import { SCAN_MODEL_NEEDS } from '@marinoscar/vault-contract/secrets';

import { ScanModelsSection, scanModelCandidates } from './ScanModelsSection.js';

/**
 * What the `card_extract` AI feature needs from a model.
 *
 * @deprecated Use `SCAN_MODEL_NEEDS` of `@marinoscar/vault-contract/secrets` (#213). Kept for one release.
 */
export const CARD_EXTRACT_NEEDS = SCAN_MODEL_NEEDS;

/**
 * The models listed for card scanning: enabled, and able to do what it needs.
 *
 * @deprecated Use `scanModelCandidates` (#213), which keeps a model per provider. Kept for one release.
 */
export function cardScanCandidates(models: readonly AiModel[]): AiModel[] {
  return scanModelCandidates(models);
}

/**
 * The card scanning model section.
 *
 * @deprecated Use `ScanModelsSection` (#213), which also picks the document scanning model. Kept for one release.
 */
export const CardScanModelSection = ScanModelsSection;
