/**
 * Realistic `GET /api/ai/config` payloads (the platform's `AiPublicConfig`) for the
 * card-scan gate (`useAiStatus` -> `isCardScanAvailable`).
 */
import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';

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
