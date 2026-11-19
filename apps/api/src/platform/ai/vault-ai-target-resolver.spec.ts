import type { DefaultAiTargetResolver } from '@marinoscar/platform-api/ai';
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { DocumentExtractService } from '@marinoscar/vault-api/ai';

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

  it('runs a scan feature on the provider stored beside its model (openai-compatible, #213)', async () => {
    policy = {
      cardExtractModel: 'vision-model-a',
      documentExtractModel: 'local-vision-model',
      documentExtractProvider: 'openai-compatible',
    };
    await expect(resolve('document_extract')).resolves.toEqual({
      provider: 'openai-compatible',
      model: 'local-vision-model',
    });
    await expect(resolve('card_extract')).resolves.toEqual({ provider: 'openai', model: 'vision-model-a' });

    policy = { cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' };
    await expect(resolve('document_extract')).resolves.toEqual({
      provider: 'openai-compatible',
      model: 'local-vision-model',
    });
  });

  it('routes POST /api/secrets/documents/extract to the selected openai-compatible model (no network)', async () => {
    policy = {
      cardExtractModel: 'vision-model-a',
      documentExtractModel: 'local-vision-model',
      documentExtractProvider: 'openai-compatible',
    };
    // A fake AiService: `forUser` hands the call to the target resolver exactly as the platform's
    // gate pipeline does (feature and any pinned model), records the target and answers nothing.
    const targets: unknown[] = [];
    const ai = {
      forUser: (userId: string, opts: { feature?: string }) => ({
        respondStructured: async (req: { model?: string }) => {
          targets.push(await resolver.resolve({ userId, feature: opts.feature, requested: { model: req.model } }));
          throw new Error('no provider in this test');
        },
      }),
    };
    const service = new DocumentExtractService(ai as never);
    const image = `data:image/png;base64,${Buffer.from('PLACEHOLDER-IMAGE').toString('base64')}`;
    const user = {
      id: 'user-a',
      email: 'person.a@example.test',
      roles: ['contributor'],
      permissions: ['secrets:write', 'ai:use'],
      isActive: true,
      activeOrgId: 'org-alpha',
    };

    await expect(service.extract({ documentType: 'id_document', images: { front: image } }, user as never)).rejects.toBeDefined();
    expect(targets).toEqual([{ provider: 'openai-compatible', model: 'local-vision-model' }]);
  });
});
