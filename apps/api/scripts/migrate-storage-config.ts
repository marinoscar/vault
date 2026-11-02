/**
 * One-time move of the object-storage configuration from the environment
 * (STORAGE_PROVIDER, S3_BUCKET, S3_REGION, S3_ENDPOINT, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY) into the platform storage settings (`system_settings`
 * `global`.`storage`) and the encrypted credential `storage` / `default`
 * (SECRETS_ENCRYPTION_KEY). Issue #84 (E6.1). Runbook:
 * docs/runbooks/storage-config-migration.md.
 *
 *   npm run vault:migrate-storage-config              # dry run (default): changes nothing
 *   npm run vault:migrate-storage-config -- --apply   # store the credential, write the settings
 *
 * Needs POSTGRES_*, SECRETS_ENCRYPTION_KEY and the legacy variables (from the
 * environment, or infra/compose/.env). Idempotent: a rerun reports
 * `already-configured`. The API runs the same import once at boot when the runtime
 * configuration is empty. NEVER prints the secret access key.
 *
 * Exit codes: 0 done (or nothing to do), 1 a stage failed, 2 conflict (a different
 * bucket or secret is already configured), 3 incomplete (the access keys are missing).
 */
import 'reflect-metadata';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { assertEncryptionKeyConfigured } from '@marinoscar/platform-api/core';

import '../src/platform/credentials/credentials.config';
import { buildDatabaseUrl } from '../src/common/database-url';
import {
  StorageImportError,
  formatStorageImportReport,
  importStorageConfig,
} from '../src/platform/storage/storage-env-import';

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

  try {
    assertEncryptionKeyConfigured();
  } catch {
    console.error('SECRETS_ENCRYPTION_KEY is missing or malformed (openssl rand -base64 32). Nothing was changed.');
    return 1;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
  try {
    const credentials = new CredentialsService(prisma as never);
    const report = await importStorageConfig({ prisma: prisma as never, credentials }, process.env, { apply });
    for (const line of formatStorageImportReport(report)) console.log(line);
    if (report.outcome === 'conflict') return 2;
    if (report.outcome === 'incomplete') return 3;
    return 0;
  } catch (error) {
    if (error instanceof StorageImportError) {
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
