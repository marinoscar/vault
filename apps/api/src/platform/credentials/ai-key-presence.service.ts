import { Injectable, Module } from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import {
  CredentialsModule,
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from './credentials.config';

/**
 * Whether the deployment's AI key is stored: a `describe` of credential
 * `('ai', 'openai')`, which never selects the ciphertext. The one reader the
 * backup archive's `system/settings.json` needs (it lives here, not in
 * `src/backups/`, because `test/credentials/vault-key-separation.spec.ts` keeps
 * `backups` clear of the credential store). The key itself is read only by the
 * platform AI slice.
 */
@Injectable()
export class AiKeyPresence {
  constructor(private readonly credentials: CredentialsService) {}

  async isConfigured(): Promise<boolean> {
    return (await this.credentials.describe(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME)) !== null;
  }
}

@Module({ imports: [CredentialsModule], providers: [AiKeyPresence], exports: [AiKeyPresence] })
export class AiKeyPresenceModule {}
