import { Injectable } from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import {
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../platform/credentials/credentials.config';

/**
 * What is left of Vault's AI configuration reader (issue #87, E8.1): whether the
 * deployment's OpenAI key is stored. The policy, the model and the budget are the
 * platform's (`AiConfigService` of `@marinoscar/platform-api/ai`), and the key is
 * decrypted only by the platform's key resolver.
 *
 * Kept (not deleted with the rest) because the system-section of the backup
 * archive reports `apiKeyConfigured` through it (`backups/`); the backups work
 * (E5.2) can read `CredentialsService.describe('ai', 'openai')` directly and
 * delete this file.
 */
@Injectable()
export class AiConfigService {
  constructor(private readonly credentials: CredentialsService) {}

  async isKeyConfigured(): Promise<boolean> {
    const info = await this.credentials.describe(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME);
    return info !== null;
  }
}
