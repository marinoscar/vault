// =============================================================================
// Real-Postgres round trip: `vault:migrate-storage-config` (issue #84, E6.1)
// =============================================================================
//
// Runs the REAL command (`scripts/migrate-storage-config.ts`, through ts-node)
// against a migrated throwaway database owned by the ORDINARY application role:
//
//   * a dry run changes nothing and never prints the secret access key;
//   * `--apply` stores the key in the credential store (purpose `storage`, name
//     `default`, SECRETS_ENCRYPTION_KEY) and the settings in `system_settings`
//     `global`.`storage`, leaving the other namespaces alone;
//   * a rerun is `already-configured` and changes nothing;
//   * a different runtime bucket is a conflict (exit 2) and is left alone;
//   * a missing key pair is `incomplete` (exit 3) and writes nothing.
//
// A `*.db.spec.ts`: excluded from `npm test`, run by `npm run test:db`, skipped
// when no superuser Postgres is reachable.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import '../../src/platform/credentials/credentials.config';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();

if (!admin) {
  // eslint-disable-next-line no-console
  console.warn('\n[storage-config-migration.db.spec] SKIPPED: no superuser Postgres reachable to bootstrap the application role.\n');
}

const describeWithDb = admin ? describe : describe.skip;

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYexamplekey';
const API_ROOT = join(__dirname, '..', '..');
const LEGACY_ENV = {
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'vault-prod-bucket',
  S3_REGION: 'eu-west-1',
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
  AWS_SECRET_ACCESS_KEY: SECRET,
};

describeWithDb('vault:migrate-storage-config against a real database', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;

  const run = (legacy: Record<string, string>, ...args: string[]) => {
    const { DATABASE_URL: _ignored, ...base } = process.env;
    const clean = Object.fromEntries(
      Object.entries(base).filter(([key]) => !/^(STORAGE_PROVIDER|S3_|AWS_)/.test(key)),
    ) as Record<string, string>;
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          require.resolve('ts-node/dist/bin.js'),
          '--project',
          'prisma/tsconfig.json',
          '--transpile-only',
          'scripts/migrate-storage-config.ts',
          ...args,
        ],
        {
          cwd: API_ROOT,
          env: { ...clean, ...(deployment.env as Record<string, string>), ...legacy, NODE_ENV: 'test' },
          stdio: 'pipe',
          encoding: 'utf8',
          timeout: 120_000,
        },
      );
      return { stdout, stderr: '', status: 0 };
    } catch (error: any) {
      return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), status: error.status ?? 1 };
    }
  };

  const settingsRow = () => prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });
  const storedSecret = () => new CredentialsService(prisma as never).getSecret('storage', 'default');

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();
    await prisma.systemSettings.create({
      data: { key: 'global', value: { ui: { allowUserThemeOverride: true }, features: {} } },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await deployment?.drop();
  });

  it('dry run, apply, rerun: the configuration moves once and the key is never printed', async () => {
    const before = await settingsRow();

    const dry = run(LEGACY_ENV);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('dry run');
    expect(dry.stdout).toContain('outcome: would-import');
    expect((await settingsRow()).version).toBe(before.version);
    expect(await storedSecret()).toBeNull();

    const applied = run(LEGACY_ENV, '--apply');
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('outcome: imported');
    const after = await settingsRow();
    expect(after.version).toBe(before.version + 1);
    expect(after.value).toEqual({
      ui: { allowUserThemeOverride: true },
      features: {},
      storage: {
        provider: 's3',
        drivers: {
          s3: { bucket: 'vault-prod-bucket', region: 'eu-west-1', endpoint: '', accessKeyId: 'AKIAEXAMPLEKEYID', forcePathStyle: null },
        },
      },
    });
    expect(await storedSecret()).toBe(SECRET);
    expect(await prisma.auditEvent.count({ where: { action: 'storage.config.imported' } })).toBe(1);

    const again = run(LEGACY_ENV, '--apply');
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('outcome: already-configured');
    expect((await settingsRow()).version).toBe(after.version);
    expect(await prisma.auditEvent.count({ where: { action: 'storage.config.imported' } })).toBe(1);

    for (const output of [dry, applied, again]) {
      expect(output.stdout + output.stderr).not.toContain(SECRET);
    }
  });

  it('leaves a different runtime bucket alone and exits 2', async () => {
    const before = await settingsRow();
    const result = run({ ...LEGACY_ENV, S3_BUCKET: 'some-other-bucket' }, '--apply');
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('outcome: conflict');
    expect((await settingsRow()).version).toBe(before.version);
  });

  it('exits 3 and writes nothing when the key pair is incomplete', async () => {
    await prisma.systemSettings.update({
      where: { key: 'global' },
      data: { value: { ui: { allowUserThemeOverride: true }, features: {} } },
    });
    await new CredentialsService(prisma as never).deleteSecret('storage', 'default');
    const before = await settingsRow();

    const result = run({ ...LEGACY_ENV, AWS_SECRET_ACCESS_KEY: '' }, '--apply');
    expect(result.status).toBe(3);
    expect(result.stdout).toContain('outcome: incomplete');
    expect((await settingsRow()).version).toBe(before.version);
    expect(await storedSecret()).toBeNull();
  });

  it('does nothing when the environment names no bucket (the placeholder is not a bucket)', async () => {
    const result = run({ S3_BUCKET: 'your-bucket-name' }, '--apply');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('outcome: nothing-to-import');
  });
});
