import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';

/**
 * The AI provider card scanning runs on. Mirrors `AI_PROVIDER_ID` of the API
 * (`packages/vault-api/src/ai/ai.constants.ts`).
 */
export const CARD_SCAN_AI_PROVIDER_ID = 'openai';

/**
 * Whether card scanning is usable, read from the platform's `GET /api/ai/config`:
 * AI is on, the key policy is `byok_with_org_fallback` (Vault users hold no key of
 * their own, so the deployment key must serve everyone), and the `openai` provider
 * is switched on with its deployment key stored.
 *
 * EXACTLY the server's rule, `isCardScanAvailable` in
 * `packages/vault-api/src/ai/card-scan-availability.ts` (the onboarding step
 * "Scan a card"); change both together. It says nothing about the viewer: the
 * `ai:use` permission is combined in `useAiStatus`.
 *
 * Pure, and fails closed on a malformed body (no `providers` array is "no").
 */
export function isCardScanAvailable(config: AiPublicConfig | null | undefined): boolean {
  if (!config || !Array.isArray(config.providers)) return false;
  const provider = config.providers.find((p) => p.id === CARD_SCAN_AI_PROVIDER_ID);
  return (
    config.enabled === true &&
    config.keyPolicy === 'byok_with_org_fallback' &&
    provider?.enabled === true &&
    provider.hasOrgKey === true
  );
}

/**
 * Whether document scanning (Passport and ID Document) is usable, read from the
 * same `GET /api/ai/config`. For now it is exactly the card rule
 * ({@link isCardScanAvailable}): the document scan runs on the same provider and
 * deployment key. Kept as its own helper so the scan-model choice (IDOC-10,
 * issue #213) can change it in one place.
 */
export function isDocumentScanAvailable(config: AiPublicConfig | null | undefined): boolean {
  return isCardScanAvailable(config);
}
