import { ServiceUnavailableException } from '@nestjs/common';

import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import {
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../platform/credentials/credentials.config';
import { AI_ERROR_CODES } from './ai.constants';
import { AiConfigService } from './ai-config.service';
import { AiException } from './ai.errors';

type SettingsStub = Pick<SystemSettingsService, 'getNamespace'>;
type CredentialsStub = Pick<CredentialsService, 'getSecret' | 'describe'>;

const readyAi = {
  enabled: true,
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
  maxCallsPerUserPerDay: 50,
  apiKeyConfigured: true,
  apiKeyLast4: 'cdef',
  apiKeyUpdatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * `ai` is the stored `ai` namespace (no key material) plus `apiKeyConfigured`,
 * which here decides what the credential store's `describe` answers. A `null`
 * stands for a row with no `ai` block: the namespace reads as its defaults.
 */
function buildService(ai: (Record<string, unknown> & { apiKeyConfigured?: boolean }) | null, key: (() => Promise<string | null>) | Error) {
  const { apiKeyConfigured, ...namespace } = ai ?? {
    enabled: false,
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxCallsPerUserPerDay: 50,
    apiKeyConfigured: false,
  };
  const settings: jest.Mocked<SettingsStub> = {
    getNamespace: jest.fn().mockResolvedValue(namespace),
  } as any;
  const credentials: jest.Mocked<CredentialsStub> = {
    describe: jest.fn().mockResolvedValue(
      apiKeyConfigured === false
        ? null
        : { hint: '••••cdef', updatedAt: new Date('2026-01-01T00:00:00.000Z') },
    ),
    getSecret:
      key instanceof Error
        ? jest.fn().mockRejectedValue(key)
        : jest.fn().mockImplementation(key),
  } as any;

  return {
    service: new AiConfigService(
      settings as unknown as SystemSettingsService,
      credentials as unknown as CredentialsService,
    ),
    settings,
    credentials,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiException);
    return (error as AiException).code;
  }
  throw new Error('Expected the promise to reject');
}

describe('AiConfigService', () => {
  describe('resolveForExtraction', () => {
    it('returns the model, budget and decrypted key when configured', async () => {
      const { service } = buildService(readyAi, async () => 'sk-live-1234');

      await expect(service.resolveForExtraction()).resolves.toEqual({
        model: 'gpt-4o-mini',
        maxCallsPerUserPerDay: 50,
        apiKey: 'sk-live-1234',
      });
    });

    it('obtains the key from the credential store (ai/openai), not the settings row', async () => {
      const { service, credentials } = buildService(readyAi, async () => 'sk-live-1234');

      await service.resolveForExtraction();

      expect(credentials.getSecret).toHaveBeenCalledTimes(1);
      expect(credentials.getSecret).toHaveBeenCalledWith(
        VAULT_AI_CREDENTIAL_PURPOSE,
        VAULT_AI_CREDENTIAL_NAME,
      );
      expect([VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME]).toEqual(['ai', 'openai']);
    });

    it('AI_NOT_CONFIGURED when the feature flag is off', async () => {
      const { service } = buildService(
        { ...readyAi, enabled: false },
        async () => 'sk-live-1234',
      );

      await expect(codeOf(service.resolveForExtraction())).resolves.toBe(
        AI_ERROR_CODES.NOT_CONFIGURED,
      );
    });

    it('AI_NOT_CONFIGURED when no key is stored', async () => {
      const { service, credentials } = buildService(
        { ...readyAi, apiKeyConfigured: false, apiKeyLast4: null },
        async () => null,
      );

      await expect(codeOf(service.resolveForExtraction())).resolves.toBe(
        AI_ERROR_CODES.NOT_CONFIGURED,
      );
      // Short-circuits before attempting decryption.
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });

    it('AI_NOT_CONFIGURED when no ai block was ever stored (defaults: off, no key)', async () => {
      const { service } = buildService(null, async () => null);

      await expect(codeOf(service.resolveForExtraction())).resolves.toBe(
        AI_ERROR_CODES.NOT_CONFIGURED,
      );
    });

    it('AI_KEY_UNREADABLE when the stored key will not decrypt', async () => {
      const { service } = buildService(
        readyAi,
        new Error('Credential "ai/openai" could not be decrypted. It must be set again.'),
      );

      await expect(codeOf(service.resolveForExtraction())).resolves.toBe(
        AI_ERROR_CODES.KEY_UNREADABLE,
      );
    });

    it('AI_NOT_CONFIGURED when the key is cleared between the two reads', async () => {
      const { service } = buildService(readyAi, async () => null);

      await expect(codeOf(service.resolveForExtraction())).resolves.toBe(
        AI_ERROR_CODES.NOT_CONFIGURED,
      );
    });
  });

  describe('resolveForVerification', () => {
    it('resolves the same config as an extraction would', async () => {
      const { service } = buildService(readyAi, async () => 'sk-live-1234');

      await expect(service.resolveForVerification()).resolves.toEqual({
        model: 'gpt-4o-mini',
        maxCallsPerUserPerDay: 50,
        apiKey: 'sk-live-1234',
      });
    });

    it('works while the feature is still switched off', async () => {
      // The natural order is: paste the key, pick a model, CHECK IT, then turn
      // the feature on. Requiring `enabled` first would force an admin to
      // expose a possibly-broken feature to every user in order to find out
      // whether it is broken.
      const { service } = buildService(
        { ...readyAi, enabled: false },
        async () => 'sk-live-1234',
      );

      await expect(service.resolveForVerification()).resolves.toMatchObject({
        apiKey: 'sk-live-1234',
      });
    });

    it('AI_NOT_CONFIGURED when there is no key to check', async () => {
      const { service } = buildService(
        { ...readyAi, apiKeyConfigured: false },
        async () => null,
      );

      await expect(codeOf(service.resolveForVerification())).resolves.toBe(
        AI_ERROR_CODES.NOT_CONFIGURED,
      );
    });

    it('AI_NOT_CONFIGURED when the ai block predates this feature', async () => {
      const { service } = buildService(null, async () => null);

      await expect(codeOf(service.resolveForVerification())).resolves.toBe(
        AI_ERROR_CODES.NOT_CONFIGURED,
      );
    });

    it('AI_KEY_UNREADABLE when the stored key cannot be decrypted', async () => {
      const { service } = buildService(
        readyAi,
        new ServiceUnavailableException('undecryptable'),
      );

      await expect(codeOf(service.resolveForVerification())).resolves.toBe(
        AI_ERROR_CODES.KEY_UNREADABLE,
      );
    });
  });

  describe('isReady', () => {
    it('true when enabled with a decryptable key', async () => {
      const { service } = buildService(readyAi, async () => 'sk-live-1234');
      await expect(service.isReady()).resolves.toBe(true);
    });

    it('false when the flag is off', async () => {
      const { service } = buildService(
        { ...readyAi, enabled: false },
        async () => 'sk-live-1234',
      );
      await expect(service.isReady()).resolves.toBe(false);
    });

    it('false when no key is stored', async () => {
      const { service } = buildService(
        { ...readyAi, apiKeyConfigured: false },
        async () => null,
      );
      await expect(service.isReady()).resolves.toBe(false);
    });

    it('false, not a throw, when the key cannot be decrypted', async () => {
      const { service } = buildService(
        readyAi,
        new ServiceUnavailableException('undecryptable'),
      );
      await expect(service.isReady()).resolves.toBe(false);
    });

    it('false when reading settings blows up entirely', async () => {
      const { service } = buildService(readyAi, async () => 'sk-live-1234');
      (service as any).systemSettings.getNamespace.mockRejectedValue(
        new Error('db down'),
      );
      await expect(service.isReady()).resolves.toBe(false);
    });
  });
});
