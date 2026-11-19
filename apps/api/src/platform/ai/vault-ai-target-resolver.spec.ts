import type { DefaultAiTargetResolver } from '@marinoscar/platform-api/ai';
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { VaultAiTargetResolver } from './vault-ai-target-resolver';

describe('VaultAiTargetResolver', () => {
  const fallbackTarget = { provider: 'openai', model: 'platform-default' };
  let policy: Record<string, unknown>;
  let fallback: { resolve: jest.Mock };
  let resolver: VaultAiTargetResolver;

  beforeEach(() => {
    policy = { cardExtractModel: 'card-model', documentExtractModel: 'document-model' };
    fallback = { resolve: jest.fn().mockResolvedValue(fallbackTarget) };
    const settings = { getNamespace: jest.fn(async () => policy) };
    resolver = new VaultAiTargetResolver(
      settings as unknown as SystemSettingsService,
      fallback as unknown as DefaultAiTargetResolver,
    );
  });

  const resolve = (feature: string | undefined, model?: string) =>
    resolver.resolve({ userId: 'user-a', feature, requested: { model } });

  it('runs card_extract on cardExtractModel', async () => {
    await expect(resolve('card_extract')).resolves.toEqual({ provider: 'openai', model: 'card-model' });
  });

  it('runs document_extract on documentExtractModel', async () => {
    await expect(resolve('document_extract')).resolves.toEqual({ provider: 'openai', model: 'document-model' });
  });

  it('falls back to cardExtractModel when documentExtractModel is unset', async () => {
    delete policy.documentExtractModel;
    await expect(resolve('document_extract')).resolves.toEqual({ provider: 'openai', model: 'card-model' });
  });

  it('lets a requested model win for both features', async () => {
    await expect(resolve('document_extract', ' pinned ')).resolves.toEqual({ provider: 'openai', model: 'pinned' });
    await expect(resolve('card_extract', 'pinned')).resolves.toEqual({ provider: 'openai', model: 'pinned' });
  });

  it('hands every other feature to the platform order', async () => {
    await expect(resolve('playground')).resolves.toBe(fallbackTarget);
    await expect(resolve(undefined)).resolves.toBe(fallbackTarget);
    expect(fallback.resolve).toHaveBeenCalledTimes(2);
  });
});
