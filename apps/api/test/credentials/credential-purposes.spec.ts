import {
  AI_CREDENTIAL_PURPOSE_DEF,
} from '../../src/platform/credentials/credential-purposes.manifest';
import {
  VAULT_AI_CREDENTIAL_LABEL,
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../../src/platform/credentials/credentials.config';

// The local `ai` purpose (SHIM(E8)) must equal the platform AI slice's, so the
// key stored today is at the address the AI slice reads in E8. Loaded with
// `require`: importing the `ai` subpath's types breaks ts-jest's resolution of
// `@marinoscar/platform-api/testing` elsewhere (see the manifest).
describe('the ai credential purpose', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platformAi = require('@marinoscar/platform-api/ai');

  it('equals the platform AI slice definition', () => {
    expect(AI_CREDENTIAL_PURPOSE_DEF).toEqual(platformAi.AI_CREDENTIAL_PURPOSE_DEF);
  });

  it('stores the OpenAI key at the address the AI slice reads', () => {
    expect(VAULT_AI_CREDENTIAL_PURPOSE).toBe(platformAi.AI_CREDENTIAL_PURPOSE);
    expect(VAULT_AI_CREDENTIAL_NAME).toBe(platformAi.aiCredentialName('openai'));
    expect(VAULT_AI_CREDENTIAL_LABEL).toBe(platformAi.aiCredentialLabel('OpenAI'));
  });
});
