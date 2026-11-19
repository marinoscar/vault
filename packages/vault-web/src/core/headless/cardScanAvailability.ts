import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';
import {
  isScanAvailable as isScanAvailableRule,
  type ScanAiFeature,
  type ScanTargets,
} from '@marinoscar/vault-contract/secrets';

/**
 * The provider a scan model id means when none is stored beside it (every choice
 * made before #213 named an OpenAI model).
 *
 * @deprecated Availability no longer depends on a vendor (#213); kept for one release.
 */
export const CARD_SCAN_AI_PROVIDER_ID = 'openai';

/**
 * Whether a scan feature (`card_extract`, `document_extract`) is usable, from the
 * platform's `GET /api/ai/config` and Vault's `GET /api/secrets/scan/targets`:
 * AI is on, the feature's model is an enabled catalogue model on an enabled
 * provider declaring `vision_input`, `structured_output` and `responses`, and its
 * call can be paid (a keyless OpenAI-compatible server, or the deployment key
 * under `byok_with_org_fallback`).
 *
 * EXACTLY the server's rule: both call `isScanAvailable` of
 * `@marinoscar/vault-contract/secrets` (#213). It says nothing about the viewer:
 * the `ai:use` permission is combined in `useAiStatus`.
 *
 * Pure, and fails closed on a malformed body. Without `targets` the pre-#213
 * assumption applies (an OpenAI model that can scan).
 */
export function isScanAvailable(
  config: AiPublicConfig | null | undefined,
  feature: ScanAiFeature,
  targets?: ScanTargets | null,
): boolean {
  return isScanAvailableRule(targets === undefined ? config : { config, targets }, feature);
}

/**
 * Whether card scanning is usable, from `GET /api/ai/config` alone.
 *
 * @deprecated Since #213 availability depends on the chosen model: use
 *   `isScanAvailable(config, 'card_extract', targets)`. Kept for one release.
 */
export function isCardScanAvailable(config: AiPublicConfig | null | undefined): boolean {
  return isScanAvailable(config, 'card_extract');
}

/**
 * Whether document scanning (Passport, ID Document) is usable: the shared rule for
 * `document_extract` (its own model, or the card model when none is chosen). The one
 * place the web decides it (`useAiStatus().documentScanEnabled`, #211, #213).
 * Without `targets` the pre-#213 assumption applies (the card rule).
 */
export function isDocumentScanAvailable(
  config: AiPublicConfig | null | undefined,
  targets?: ScanTargets | null,
): boolean {
  return isScanAvailable(config, 'document_extract', targets);
}
