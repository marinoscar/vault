import {
  VAULT_AI_CREDENTIAL_LABEL,
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../../src/platform/credentials/credentials.config';

// The `ai` purpose is the platform AI slice's own definition, registered by the app manifest (E8.1).
// Vault's key must stay at the address that slice reads, or it becomes unreadable.
// Loaded with `require`: importing the `ai` subpath's types in a spec can break
// ts-jest's resolution of `@marinoscar/platform-api/testing` elsewhere.
describe('the ai credential purpose', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platformAi = require('@marinoscar/platform-api/ai');

  it('stores the OpenAI key at the address the AI slice reads', () => {
    expect(VAULT_AI_CREDENTIAL_PURPOSE).toBe(platformAi.AI_CREDENTIAL_PURPOSE);
    expect(VAULT_AI_CREDENTIAL_NAME).toBe(platformAi.aiCredentialName('openai'));
    expect(VAULT_AI_CREDENTIAL_LABEL).toBe(platformAi.aiCredentialLabel('OpenAI'));
  });

  it('is the purpose definition the platform registers', () => {
    expect(platformAi.AI_CREDENTIAL_PURPOSE_DEF.purpose).toBe(VAULT_AI_CREDENTIAL_PURPOSE);
    expect(platformAi.AI_CREDENTIAL_PURPOSE_DEF.tiers).toEqual(['system', 'org']);
  });
});
