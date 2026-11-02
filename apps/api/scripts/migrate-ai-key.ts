/**
 * One-time move of the OpenAI key from `system_settings.ai.apiKey`
 * (VAULT_ENCRYPTION_KEY) into the platform credential store, purpose `ai`, name
 * `openai` (SECRETS_ENCRYPTION_KEY). Issue #80 (E4.2). Runbook:
 * docs/runbooks/ai-key-migration.md.
 *
 *   npm run vault:migrate-ai-key              # dry run (default): changes nothing
 *   npm run vault:migrate-ai-key -- --apply   # store the credential, blank the old field
 *
 * Needs POSTGRES_*, VAULT_ENCRYPTION_KEY and SECRETS_ENCRYPTION_KEY. Idempotent:
 * a rerun finds no legacy key and does nothing. NEVER prints the key: the output
 * is booleans, an outcome and the legacy last-four mask.
 *
 * Exit codes: 0 done (or nothing to do), 1 a stage failed, 2 conflict (a
 * different credential already exists).
 */
import 'reflect-metadata';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { assertEncryptionKeyConfigured } from '@marinoscar/platform-api/core';

import '../src/platform/credentials/credentials.config';
import {
  AiKeyMigrationError,
  formatAiKeyMigrationReport,
  migrateAiKey,
} from '../src/ai/ai-key-migration';
import { buildDatabaseUrl } from '../src/common/database-url';
import { CryptoService } from '../src/common/services/crypto.service';

async function main(): Promise<number> {
  if (process.env.NODE_ENV !== 'production') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dotenv = require('dotenv');
      dotenv.config();
      dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', 'infra', 'compose', '.env') });
    } catch {
      // dotenv is a convenience; the environment may already be complete.
    }
  }

  const apply = process.argv.includes('--apply');

  if (!process.env.VAULT_ENCRYPTION_KEY) {
    console.error('VAULT_ENCRYPTION_KEY is not set: the legacy key cannot be read.');
    return 1;
  }
  try {
    assertEncryptionKeyConfigured();
  } catch {
    console.error(
      'SECRETS_ENCRYPTION_KEY is missing or malformed (openssl rand -base64 32). Nothing was changed.',
    );
    return 1;
  }

  const crypto = new CryptoService({ get: () => process.env.VAULT_ENCRYPTION_KEY } as never);
  crypto.onModuleInit();

  const prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
  try {
    const credentials = new CredentialsService(prisma as never);
    const report = await migrateAiKey({ prisma: prisma as never, crypto, credentials }, { apply });
    for (const line of formatAiKeyMigrationReport(report)) console.log(line);
    return report.outcome === 'conflict' ? 2 : 0;
  } catch (error) {
    if (error instanceof AiKeyMigrationError) {
      console.error(`failed at stage "${error.stage}": ${error.message}`);
    } else {
      // Name the error class only: a driver message can echo parameters.
      console.error(`failed: ${(error as Error)?.name ?? 'Error'}`);
    }
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
