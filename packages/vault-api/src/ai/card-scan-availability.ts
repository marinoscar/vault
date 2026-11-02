import type { AiConfigService } from '@marinoscar/platform-api/ai';

import { AI_PROVIDER_ID } from './ai.constants';

/** The public AI config of one organization (`AiConfigService.describePublic`). */
export type PublicAiConfig = Awaited<ReturnType<AiConfigService['describePublic']>>;

/**
 * Whether card scanning is usable by the caller: the organization has AI on, the OpenAI provider is
 * switched on, and the deployment key is stored AND serves everyone (`keyPolicy:
 * 'byok_with_org_fallback'`: Vault users hold no key of their own). The one rule behind
 * the onboarding step "Scan a card" (the web applies the same rule to `GET /api/ai/config`).
 */
export function isCardScanAvailable(config: PublicAiConfig): boolean {
  const provider = config.providers.find((p) => p.id === AI_PROVIDER_ID);
  return (
    config.enabled &&
    config.keyPolicy === 'byok_with_org_fallback' &&
    provider?.enabled === true &&
    provider.hasOrgKey === true
  );
}
