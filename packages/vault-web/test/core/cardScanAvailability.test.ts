import { describe, it, expect } from 'vitest';
import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';

import { isCardScanAvailable } from '../../src/core/headless/cardScanAvailability.js';

// The same cases as the server's rule (packages/vault-api/src/ai/card-scan-availability.ts).
const openai = { id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true };
const config = (overrides: Partial<AiPublicConfig> = {}): AiPublicConfig => ({
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [openai],
  ...overrides,
});

describe('isCardScanAvailable', () => {
  it('is available with AI on, the fallback key policy and the openai provider on with its key', () => {
    expect(isCardScanAvailable(config())).toBe(true);
  });

  it('is available when other providers are listed beside openai', () => {
    expect(
      isCardScanAvailable(
        config({ providers: [{ id: 'anthropic', displayName: 'Anthropic', enabled: false, hasOrgKey: false }, openai] }),
      ),
    ).toBe(true);
  });

  it('is unavailable while AI is off', () => {
    expect(isCardScanAvailable(config({ enabled: false }))).toBe(false);
  });

  it('is unavailable under the byok key policy (Vault users hold no key of their own)', () => {
    expect(isCardScanAvailable(config({ keyPolicy: 'byok' }))).toBe(false);
  });

  it('is unavailable when the openai provider is missing', () => {
    expect(
      isCardScanAvailable(
        config({ providers: [{ id: 'anthropic', displayName: 'Anthropic', enabled: true, hasOrgKey: true }] }),
      ),
    ).toBe(false);
    expect(isCardScanAvailable(config({ providers: [] }))).toBe(false);
  });

  it('is unavailable when the openai provider is disabled', () => {
    expect(isCardScanAvailable(config({ providers: [{ ...openai, enabled: false }] }))).toBe(false);
  });

  it('is unavailable when the openai provider has no deployment key', () => {
    expect(isCardScanAvailable(config({ providers: [{ ...openai, hasOrgKey: false }] }))).toBe(false);
  });

  it('fails closed on a missing or malformed config', () => {
    expect(isCardScanAvailable(null)).toBe(false);
    expect(isCardScanAvailable(undefined)).toBe(false);
    expect(isCardScanAvailable({ enabled: true, keyPolicy: 'byok_with_org_fallback' } as unknown as AiPublicConfig)).toBe(
      false,
    );
  });
});
