/**
 * One-time move of stored settings onto the platform settings layout.
 * Issue #79 (E4.1). Runbook: docs/runbooks/settings-migration.md.
 *
 *   npm run vault:migrate-settings              # dry run (default): changes nothing
 *   npm run vault:migrate-settings -- --apply   # rewrite the legacy user profiles
 *
 * Needs POSTGRES_*. Idempotent: a rerun reports zero changes. Prints counts only,
 * never a settings value.
 *
 * Exit codes: 0 done (or nothing to do), 1 failed.
 */
import 'reflect-metadata';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { buildDatabaseUrl } from '../src/common/database-url';
import { formatSettingsMigrationReport, migrateSettings } from '../src/settings/settings-migration';

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
  const prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
  try {
    const report = await migrateSettings(prisma as never, { apply });
    for (const line of formatSettingsMigrationReport(report)) console.log(line);
    return 0;
  } catch (error) {
    // Name the error class only: a driver message can echo parameters.
    console.error(`failed: ${(error as Error)?.name ?? 'Error'}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
