/**
 * One-time rewrite of Vault's `ai` system-settings block into the platform AI slice's
 * shape, plus the enabled `ai_models` row for the card-extraction model. Issue #87
 * (E8.1) with #88 (E8.2). Runbook: docs/runbooks/ai-platform-migration.md.
 *
 *   npm run vault:migrate-ai-platform                          # dry run (default): changes nothing
 *   npm run vault:migrate-ai-platform -- --apply               # write the model row and the settings
 *   npm run vault:migrate-ai-platform -- --apply --snapshot /var/backups/ai-platform-legacy.json
 *
 * Needs POSTGRES_* and SECRETS_ENCRYPTION_KEY (to DESCRIBE the deployment key, never
 * to read it). Idempotent. Never prints a key or any card data.
 *
 * Exit codes: 0 done (or nothing to do), 1 a problem or a failure.
 */
import 'reflect-metadata';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import '../src/platform/credentials/credential-purposes.manifest';
import {
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../src/platform/credentials/credentials.config';
import { formatAiPlatformMigrationReport, migrateAiPlatform } from '../src/ai/ai-platform-migration';
import { buildDatabaseUrl } from '../src/common/database-url';

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

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const snapshotIndex = args.indexOf('--snapshot');
  const snapshotPath = snapshotIndex >= 0 ? args[snapshotIndex + 1] : undefined;

  const prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
  try {
    const credentials = new CredentialsService(prisma as never);
    const report = await migrateAiPlatform(
      {
        prisma: prisma as never,
        keyConfigured: async () =>
          (await credentials.describe(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME)) !== null,
      },
      { apply, snapshotPath },
    );
    for (const line of formatAiPlatformMigrationReport(report)) console.log(line);
    return report.problems.length > 0 ? 1 : 0;
  } catch (error) {
    // Name the error class and our own message only: a driver message can echo parameters.
    console.error(`failed: ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message?.slice(0, 200)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
