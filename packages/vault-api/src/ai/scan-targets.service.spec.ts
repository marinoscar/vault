import { SCAN_MODEL_NEEDS } from '@marinoscar/vault-contract/secrets';

import { isCardScanAvailable, isScanAvailable, type PublicAiConfig } from './card-scan-availability';
import { ScanTargetsService } from './scan-targets.service';

// Issue #213: the targets come from the `ai` settings plus the model catalogue, and the
// availability is the contract's rule over the public config and those targets.

const VISION = [...SCAN_MODEL_NEEDS];

type Row = { enabled: boolean; deprecatedAt: Date | null; capabilities: unknown };

function build(policy: Record<string, unknown>, rows: Record<string, Row>, config: Partial<PublicAiConfig> = {}) {
  const findUnique = jest.fn(async ({ where }: { where: { provider_modelId: { provider: string; modelId: string } } }) => {
    const { provider, modelId } = where.provider_modelId;
    return rows[`${provider}/${modelId}`] ?? null;
  });
  const describePublic = jest.fn(async () => ({
    enabled: true,
    keyPolicy: 'byok_with_org_fallback',
    providers: [
      { id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true },
      { id: 'openai-compatible', displayName: 'OpenAI-compatible', enabled: true, hasOrgKey: false, requiresKey: false },
    ],
    ...config,
  }));
  const service = new ScanTargetsService(
    { getNamespace: jest.fn(async () => policy), getSettings: jest.fn() } as never,
    { aiModel: { findUnique } } as never,
    { describePublic } as never,
  );
  return { service, findUnique, describePublic };
}

const enabled = (capabilities: string[]): Row => ({ enabled: true, deprecatedAt: null, capabilities: { capabilities } });

describe('ScanTargetsService', () => {
  it('reads the card model (provider openai by default) and the document model with its provider', async () => {
    const { service, findUnique } = build(
      {
        cardExtractModel: 'vision-model-a',
        documentExtractModel: 'local-vision-model',
        documentExtractProvider: 'openai-compatible',
      },
      { 'openai/vision-model-a': enabled(VISION), 'openai-compatible/local-vision-model': enabled(VISION) },
    );
    await expect(service.targets()).resolves.toEqual({
      card_extract: { provider: 'openai', model: 'vision-model-a', capabilities: VISION },
      document_extract: { provider: 'openai-compatible', model: 'local-vision-model', capabilities: VISION },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('falls back to the card choice for documents', async () => {
    const { service } = build(
      { cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' },
      { 'openai-compatible/local-vision-model': enabled(VISION) },
    );
    const targets = await service.targets();
    expect(targets.document_extract).toEqual(targets.card_extract);
    expect(targets.card_extract?.provider).toBe('openai-compatible');
  });

  it('marks a missing, disabled or deprecated model with null capabilities', async () => {
    const { service } = build(
      { cardExtractModel: 'off-model', documentExtractModel: 'gone-model' },
      { 'openai/off-model': { ...enabled(VISION), enabled: false } },
    );
    const targets = await service.targets();
    expect(targets.card_extract?.capabilities).toBeNull();
    expect(targets.document_extract?.capabilities).toBeNull();

    const old = build({ cardExtractModel: 'old' }, { 'openai/old': { ...enabled(VISION), deprecatedAt: new Date() } });
    expect((await old.service.targets()).card_extract?.capabilities).toBeNull();
  });

  it('is null for a feature without a chosen model', async () => {
    const { service } = build({}, {});
    await expect(service.targets()).resolves.toEqual({ card_extract: null, document_extract: null });
  });

  it('answers availability per feature for the organization', async () => {
    const { service, describePublic } = build(
      {
        cardExtractModel: 'vision-model-a',
        documentExtractModel: 'local-text-model',
        documentExtractProvider: 'openai-compatible',
      },
      { 'openai/vision-model-a': enabled(VISION), 'openai-compatible/local-text-model': enabled(['responses']) },
    );
    await expect(service.isAvailable('org-alpha', 'card_extract')).resolves.toBe(true);
    await expect(service.isAvailable('org-alpha', 'document_extract')).resolves.toBe(false);
    expect(describePublic).toHaveBeenCalledWith('org-alpha');
  });

  it('is unavailable while AI is off', async () => {
    const { service } = build({ cardExtractModel: 'vision-model-a' }, { 'openai/vision-model-a': enabled(VISION) }, {
      enabled: false,
      providers: [],
    });
    await expect(service.isAvailable('org-alpha', 'card_extract')).resolves.toBe(false);
  });
});

describe('isCardScanAvailable (deprecated alias)', () => {
  const config = {
    enabled: true,
    keyPolicy: 'byok_with_org_fallback',
    providers: [{ id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true }],
  } as PublicAiConfig;

  it('keeps the pre-#213 answers for the OpenAI configuration', () => {
    expect(isCardScanAvailable(config)).toBe(true);
    expect(isCardScanAvailable({ ...config, enabled: false })).toBe(false);
    expect(isCardScanAvailable({ ...config, keyPolicy: 'byok' })).toBe(false);
    expect(isCardScanAvailable({ ...config, providers: [{ ...config.providers[0], hasOrgKey: false }] })).toBe(false);
  });

  it('equals isScanAvailable(config, card_extract) without targets', () => {
    expect(isScanAvailable(config, 'card_extract')).toBe(isCardScanAvailable(config));
  });
});
