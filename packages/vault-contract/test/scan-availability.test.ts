import { describe, expect, it } from 'vitest';

import {
  SCAN_AI_FEATURES,
  SCAN_MODEL_NEEDS,
  isScanAvailable,
  resolveScanModelRef,
  scanModelFits,
  scanTargetsSchema,
  type ScanAvailabilityConfig,
  type ScanTargets,
} from '../src/secrets/index.js';

// The availability matrix of issue #213. Every case is asserted for BOTH scan features:
// the rule does not depend on the feature, only on the model the feature runs on.

const VISION = [...SCAN_MODEL_NEEDS];
const openai = { id: 'openai', enabled: true, hasOrgKey: true };
const compatibleKeyless = { id: 'openai-compatible', enabled: true, hasOrgKey: false, requiresKey: false };

const config = (overrides: Partial<ScanAvailabilityConfig> = {}): ScanAvailabilityConfig => ({
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  providers: [openai, compatibleKeyless],
  ...overrides,
});

const both = (target: ScanTargets['card_extract']): ScanTargets => ({ card_extract: target, document_extract: target });

const MATRIX: Array<{ name: string; config: ScanAvailabilityConfig; targets: ScanTargets; expected: boolean }> = [
  {
    name: 'AI disabled',
    config: config({ enabled: false, providers: [] }),
    targets: both({ provider: 'openai', model: 'vision-model-a', capabilities: VISION }),
    expected: false,
  },
  {
    name: 'OpenAI with its key and a vision model',
    config: config(),
    targets: both({ provider: 'openai', model: 'vision-model-a', capabilities: VISION }),
    expected: true,
  },
  {
    name: 'OpenAI without a key',
    config: config({ providers: [{ ...openai, hasOrgKey: false }] }),
    targets: both({ provider: 'openai', model: 'vision-model-a', capabilities: VISION }),
    expected: false,
  },
  {
    name: 'openai-compatible keyless, model declaring both capabilities',
    config: config(),
    targets: both({ provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION }),
    expected: true,
  },
  {
    name: 'openai-compatible, model missing vision_input',
    config: config(),
    targets: both({
      provider: 'openai-compatible',
      model: 'local-text-model',
      capabilities: ['responses', 'structured_output'],
    }),
    expected: false,
  },
  {
    name: 'selected model not found in the catalogue',
    config: config(),
    targets: both({ provider: 'openai', model: 'retired-model', capabilities: null }),
    expected: false,
  },
];

describe('isScanAvailable: the availability matrix', () => {
  for (const row of MATRIX) {
    for (const feature of SCAN_AI_FEATURES) {
      it(`${row.name}: ${feature} -> ${row.expected}`, () => {
        expect(isScanAvailable({ config: row.config, targets: row.targets }, feature)).toBe(row.expected);
      });
    }
  }
});

describe('isScanAvailable: the other gates', () => {
  const vision = both({ provider: 'openai', model: 'vision-model-a', capabilities: VISION });

  it('refuses a disabled provider, even with a key', () => {
    expect(isScanAvailable({ config: config({ providers: [{ ...openai, enabled: false }] }), targets: vision }, 'card_extract')).toBe(false);
  });

  it('refuses a provider the config does not list', () => {
    expect(isScanAvailable({ config: config({ providers: [compatibleKeyless] }), targets: vision }, 'card_extract')).toBe(false);
  });

  it('refuses a keyed provider under the byok policy (Vault users hold no key), accepts a keyless one', () => {
    expect(isScanAvailable({ config: config({ keyPolicy: 'byok' }), targets: vision }, 'card_extract')).toBe(false);
    const local = both({ provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION });
    expect(isScanAvailable({ config: config({ keyPolicy: 'byok' }), targets: local }, 'document_extract')).toBe(true);
  });

  it('accepts an openai-compatible server that requires a key once the deployment key is stored', () => {
    const keyed = { id: 'openai-compatible', enabled: true, hasOrgKey: true, requiresKey: true };
    const local = both({ provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION });
    expect(isScanAvailable({ config: config({ providers: [keyed] }), targets: local }, 'card_extract')).toBe(true);
    expect(
      isScanAvailable({ config: config({ providers: [{ ...keyed, hasOrgKey: false }] }), targets: local }, 'card_extract'),
    ).toBe(false);
  });

  it('answers per feature: a document model can differ from the card model', () => {
    const targets: ScanTargets = {
      card_extract: { provider: 'openai', model: 'vision-model-a', capabilities: VISION },
      document_extract: { provider: 'openai-compatible', model: 'local-text-model', capabilities: ['responses'] },
    };
    expect(isScanAvailable({ config: config(), targets }, 'card_extract')).toBe(true);
    expect(isScanAvailable({ config: config(), targets }, 'document_extract')).toBe(false);
  });

  it('refuses a feature with no chosen model', () => {
    expect(isScanAvailable({ config: config(), targets: { card_extract: null, document_extract: null } }, 'card_extract')).toBe(false);
    expect(isScanAvailable({ config: config(), targets: {} }, 'document_extract')).toBe(false);
  });

  it('fails closed on a missing or malformed input', () => {
    expect(isScanAvailable(null, 'card_extract')).toBe(false);
    expect(isScanAvailable(undefined, 'document_extract')).toBe(false);
    expect(isScanAvailable({ config: null, targets: vision }, 'card_extract')).toBe(false);
    expect(isScanAvailable({ enabled: true, keyPolicy: 'byok_with_org_fallback' } as never, 'card_extract')).toBe(false);
  });

  it('reads a bare config with the pre-#213 assumption (an OpenAI model that can scan)', () => {
    expect(isScanAvailable(config(), 'card_extract')).toBe(true);
    expect(isScanAvailable(config({ providers: [{ ...openai, hasOrgKey: false }] }), 'card_extract')).toBe(false);
    expect(isScanAvailable(config({ providers: [compatibleKeyless] }), 'card_extract')).toBe(false);
  });
});

describe('resolveScanModelRef', () => {
  it('runs card_extract on the card choice, provider openai when none is stored', () => {
    expect(resolveScanModelRef({ cardExtractModel: 'vision-model-a' }, 'card_extract')).toEqual({
      provider: 'openai',
      model: 'vision-model-a',
    });
    expect(
      resolveScanModelRef({ cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' }, 'card_extract'),
    ).toEqual({ provider: 'openai-compatible', model: 'local-vision-model' });
  });

  it('runs document_extract on its own choice, else on the card choice', () => {
    const settings = {
      cardExtractModel: 'vision-model-a',
      documentExtractModel: ' local-vision-model ',
      documentExtractProvider: 'openai-compatible',
    };
    expect(resolveScanModelRef(settings, 'document_extract')).toEqual({
      provider: 'openai-compatible',
      model: 'local-vision-model',
    });
    expect(resolveScanModelRef({ ...settings, documentExtractModel: null }, 'document_extract')).toEqual({
      provider: 'openai',
      model: 'vision-model-a',
    });
  });

  it('is null when nothing is chosen', () => {
    expect(resolveScanModelRef({}, 'card_extract')).toBeNull();
    expect(resolveScanModelRef(null, 'document_extract')).toBeNull();
  });
});

describe('scanModelFits and the wire schema', () => {
  it('needs every capability', () => {
    expect(scanModelFits(VISION)).toBe(true);
    expect(scanModelFits(['vision_input', 'structured_output'])).toBe(false);
    expect(scanModelFits(null)).toBe(false);
  });

  it('parses a targets body', () => {
    expect(
      scanTargetsSchema.parse({
        card_extract: { provider: 'openai', model: 'vision-model-a', capabilities: VISION },
        document_extract: null,
      }).document_extract,
    ).toBeNull();
  });
});
