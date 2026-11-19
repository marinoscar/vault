import { describe, it, expect } from 'vitest';
import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';

import type { ScanTargets } from '@marinoscar/vault-contract/secrets';

import {
  isCardScanAvailable,
  isDocumentScanAvailable,
  isScanAvailable,
} from '../../src/core/headless/cardScanAvailability.js';

// The same cases as the server's rule (packages/vault-api/src/ai/card-scan-availability.ts).
const openai = { id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true };
const config = (overrides: Partial<AiPublicConfig> = {}): AiPublicConfig => ({
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [openai],
  ...overrides,
});

describe('isCardScanAvailable (deprecated alias: the pre-#213 answers)', () => {
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

// The availability matrix of #213, mirrored from the contract's spec
// (packages/vault-contract/test/scan-availability.test.ts): the web runs the same rule.
describe('isScanAvailable (web mirror of the availability matrix)', () => {
  const VISION = ['responses', 'structured_output', 'vision_input'];
  const keyless = { id: 'openai-compatible', displayName: 'OpenAI-compatible', enabled: true, hasOrgKey: false, requiresKey: false };
  const both = (target: ScanTargets['card_extract']): ScanTargets => ({ card_extract: target, document_extract: target });
  const openaiVision = both({ provider: 'openai', model: 'vision-model-a', capabilities: VISION });

  const MATRIX: Array<[string, AiPublicConfig, ScanTargets, boolean]> = [
    ['AI disabled', config({ enabled: false, providers: [] }), openaiVision, false],
    ['OpenAI with key and a vision model', config({ providers: [openai, keyless] }), openaiVision, true],
    ['OpenAI without key', config({ providers: [{ ...openai, hasOrgKey: false }, keyless] }), openaiVision, false],
    [
      'openai-compatible keyless with both capabilities',
      config({ providers: [openai, keyless] }),
      both({ provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION }),
      true,
    ],
    [
      'openai-compatible model missing vision_input',
      config({ providers: [openai, keyless] }),
      both({ provider: 'openai-compatible', model: 'local-text-model', capabilities: ['responses', 'structured_output'] }),
      false,
    ],
    [
      'selected model not found',
      config({ providers: [openai, keyless] }),
      both({ provider: 'openai', model: 'retired-model', capabilities: null }),
      false,
    ],
  ];

  for (const [name, cfg, targets, expected] of MATRIX) {
    for (const feature of ['card_extract', 'document_extract'] as const) {
      it(`${name}: ${feature} -> ${expected}`, () => {
        expect(isScanAvailable(cfg, feature, targets)).toBe(expected);
      });
    }
  }

  it('fails closed on null targets (not loaded or failed)', () => {
    expect(isScanAvailable(config(), 'card_extract', null)).toBe(false);
  });
});

describe('isDocumentScanAvailable', () => {
  const VISION = ['responses', 'structured_output', 'vision_input'];
  it('applies the shared rule to document_extract', () => {
    const targets: ScanTargets = {
      card_extract: { provider: 'openai', model: 'vision-model-a', capabilities: VISION },
      document_extract: { provider: 'openai', model: 'text-model', capabilities: ['responses'] },
    };
    expect(isDocumentScanAvailable(config(), targets)).toBe(false);
    expect(isDocumentScanAvailable(config(), { ...targets, document_extract: targets.card_extract })).toBe(true);
  });

  it('is the card rule without targets', () => {
    expect(isDocumentScanAvailable(config())).toBe(isCardScanAvailable(config()));
  });
});
