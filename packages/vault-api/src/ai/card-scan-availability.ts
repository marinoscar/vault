import type { AiConfigService } from '@marinoscar/platform-api/ai';
import {
  isScanAvailable as isScanAvailableRule,
  type ScanAiFeature,
  type ScanTargets,
} from '@marinoscar/vault-contract/secrets';

/** The public AI config of one organization (`AiConfigService.describePublic`). */
export type PublicAiConfig = Awaited<ReturnType<AiConfigService['describePublic']>>;

/**
 * Whether a scan feature (`card_extract`, `document_extract`) is usable by the caller's
 * organization: AI on, the model the target resolver picks for the feature is an enabled
 * catalogue model on an enabled provider declaring `vision_input`, `structured_output` and
 * `responses`, and its call can be paid (a keyless OpenAI-compatible server, or the deployment
 * key under `byok_with_org_fallback`). The rule is `isScanAvailable` of
 * `@marinoscar/vault-contract/secrets`, shared with the web's `useAiStatus` (#213).
 *
 * `targets` comes from `ScanTargetsService.targets()`; without it the pre-#213 assumption
 * (an OpenAI model that can scan) applies.
 */
export function isScanAvailable(
  config: PublicAiConfig | null | undefined,
  feature: ScanAiFeature,
  targets?: ScanTargets,
): boolean {
  return isScanAvailableRule(targets === undefined ? config : { config, targets }, feature);
}

/**
 * Whether card scanning is usable, from the public config alone (AI on, the `openai`
 * provider on with its deployment key, `byok_with_org_fallback`).
 *
 * @deprecated Since #213 availability depends on the chosen model, not on the vendor: use
 *   `isScanAvailable(config, 'card_extract', targets)`. Kept for one release.
 */
export function isCardScanAvailable(config: PublicAiConfig): boolean {
  return isScanAvailable(config, 'card_extract');
}
