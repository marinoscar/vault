import { assembleVaultSystemSettingsNamespaces } from '../settings/registry/system-settings.manifest';
import { DEFAULT_CARD_EXTRACT_MODEL } from './settings';

// Issue #213: the `ai` namespace as assembled (platform policy + Vault's extension) stores a
// provider beside each scan model, and a `null` patch clears the document choice.
describe('the ai namespace with the scan-model extension', () => {
  const ai = assembleVaultSystemSettingsNamespaces().find((ns) => ns.key === 'ai')!;
  const base = () => ai.storedSchema.parse(ai.defaults) as Record<string, unknown>;
  const merge = (current: Record<string, unknown>, patch: Record<string, unknown>) =>
    ai.storedSchema.parse(ai.merge(current, ai.patchSchema.parse(patch))) as Record<string, unknown>;

  it('defaults the card model and leaves the providers and the document model unset', () => {
    const value = base();
    expect(value.cardExtractModel).toBe(DEFAULT_CARD_EXTRACT_MODEL);
    expect(value).not.toHaveProperty('cardExtractProvider');
    expect(value).not.toHaveProperty('documentExtractModel');
  });

  it('stores a model with its provider', () => {
    const value = merge(base(), { cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' });
    expect(value).toMatchObject({ cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' });
  });

  it('drops a stale provider when a model is set without one', () => {
    const current = merge(base(), { cardExtractModel: 'local-vision-model', cardExtractProvider: 'openai-compatible' });
    const value = merge(current, { cardExtractModel: 'vision-model-a' });
    expect(value.cardExtractModel).toBe('vision-model-a');
    expect(value).not.toHaveProperty('cardExtractProvider');
  });

  it('clears the document choice with null ("Same as card scanning")', () => {
    const current = merge(base(), { documentExtractModel: 'local-vision-model', documentExtractProvider: 'openai-compatible' });
    expect(current).toMatchObject({ documentExtractModel: 'local-vision-model', documentExtractProvider: 'openai-compatible' });
    const value = merge(current, { documentExtractModel: null });
    expect(value).not.toHaveProperty('documentExtractModel');
    expect(value).not.toHaveProperty('documentExtractProvider');
    expect(value.cardExtractModel).toBe(DEFAULT_CARD_EXTRACT_MODEL);
  });

  it('keeps the extension fields through a patch of a platform field', () => {
    const current = merge(base(), { documentExtractModel: 'local-vision-model', documentExtractProvider: 'openai-compatible' });
    const value = merge(current, { enabled: !current.enabled });
    expect(value).toMatchObject({ documentExtractModel: 'local-vision-model', documentExtractProvider: 'openai-compatible' });
  });

  it('refuses a null card model (the card choice cannot be cleared)', () => {
    expect(() => ai.patchSchema.parse({ cardExtractModel: null })).toThrow();
  });
});
