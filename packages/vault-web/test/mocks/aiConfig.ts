/**
 * Realistic `GET /api/ai/config` payloads (the platform's `AiPublicConfig`) for the
 * card-scan gate (`useAiStatus` -> `isCardScanAvailable`).
 */
import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';
import type { ScanTargets } from '@marinoscar/vault-contract/secrets';

const OPENAI = { id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true };

/** AI on, the deployment key serving everyone, the openai provider on with its key: card scanning available. */
export const AI_CONFIG_CARD_SCAN_ON: AiPublicConfig = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [OPENAI],
};

/** AI switched off (the providers list is empty while off). */
export const AI_CONFIG_OFF: AiPublicConfig = {
  enabled: false,
  keyPolicy: 'byok_with_org_fallback',
  providers: [],
};

/** AI on, but the openai provider has no deployment key: card scanning is not set up. */
export const AI_CONFIG_ON_NO_KEY: AiPublicConfig = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [{ ...OPENAI, hasOrgKey: false }],
};

/** `AI_CONFIG_CARD_SCAN_ON` or `AI_CONFIG_OFF`. */
export function aiConfigPayload(cardScanAvailable: boolean): AiPublicConfig {
  return cardScanAvailable ? AI_CONFIG_CARD_SCAN_ON : AI_CONFIG_OFF;
}

/** What both scan features need from a model. */
const VISION = ['responses', 'structured_output', 'vision_input'];

/** `GET /api/secrets/scan/targets` (#213): an OpenAI vision model for both scan features. */
export const SCAN_TARGETS_OPENAI: ScanTargets = {
  card_extract: { provider: 'openai', model: 'vision-model-a', capabilities: VISION },
  document_extract: { provider: 'openai', model: 'vision-model-a', capabilities: VISION },
};

/** Both scan features on a keyless OpenAI-compatible server's vision model. */
export const SCAN_TARGETS_COMPATIBLE: ScanTargets = {
  card_extract: { provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION },
  document_extract: { provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION },
};

/** AI on with a keyless OpenAI-compatible server beside OpenAI (no OpenAI key). */
export const AI_CONFIG_COMPATIBLE_KEYLESS: AiPublicConfig = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [
    { ...OPENAI, hasOrgKey: false },
    { id: 'openai-compatible', displayName: 'OpenAI-compatible', enabled: true, hasOrgKey: false, requiresKey: false },
  ],
};
