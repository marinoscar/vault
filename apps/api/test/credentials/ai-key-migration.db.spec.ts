// =============================================================================
// Real-Postgres round trip: `vault:migrate-ai-key` (issue #80, E4.2)
// =============================================================================
//
// Runs against a migrated throwaway database owned by the ORDINARY application
// role (the helper the RLS suites use):
//
//   * the legacy `system_settings.ai.apiKey` block, encrypted with
//     VAULT_ENCRYPTION_KEY, moves into `credentials` (purpose `ai`, name
//     `openai`) under SECRETS_ENCRYPTION_KEY, and the old field is blanked;
//   * the real command (`scripts/migrate-ai-key.ts`, through ts-node) does the
//     same, dry run first, and never prints the key;
//   * a rerun changes nothing;
//   * `secret_versions` is byte-identical before and after: the move must never
//     touch a secret value (still under VAULT_ENCRYPTION_KEY).
//
// A `*.db.spec.ts`: excluded from `npm test`, run by `npm run test:db`, skipped
// when no superuser Postgres is reachable.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '@marinoscar/platform-api/core';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import '../../src/platform/credentials/credentials.config';
import { migrateAiKey } from '../../src/ai/ai-key-migration';
import { CryptoService } from '../../src/common/services/crypto.service';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();

if (!admin) {
  // eslint-disable-next-line no-console
  console.warn('\n[ai-key-migration.db.spec] SKIPPED: no superuser Postgres reachable to bootstrap the application role.\n');
}

const describeWithDb = admin ? describe : describe.skip;

const PLAINTEXT = 'sk-test-0123456789abcdefghijklmnop';
const API_ROOT = join(__dirname, '..', '..');

describeWithDb('vault:migrate-ai-key against a real database', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let crypto: CryptoService;

  const secretVersionsFingerprint = async (): Promise<string> => {
    const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(
      `SELECT md5(coalesce(string_agg(sv::text, '|' ORDER BY sv.id), '')) AS fp FROM secret_versions sv`,
    );
    return rows[0].fp ?? '';
  };

  const runCommand = (...args: string[]): { stdout: string; stderr: string; status: number } => {
    const { DATABASE_URL: _ignored, ...base } = process.env;
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          require.resolve('ts-node/dist/bin.js'),
          '--project',
          'prisma/tsconfig.json',
          '--transpile-only',
          'scripts/migrate-ai-key.ts',
          ...args,
        ],
        {
          cwd: API_ROOT,
          env: { ...base, ...(deployment.env as Record<string, string>), NODE_ENV: 'test' },
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

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();

    crypto = new CryptoService({ get: () => process.env.VAULT_ENCRYPTION_KEY } as never);
    crypto.onModuleInit();

    const enc = crypto.encrypt(PLAINTEXT);
    await prisma.systemSettings.create({
      data: {
        key: 'global',
        value: {
          ui: { allowUserThemeOverride: true },
          features: {},
          maintenance: { enabled: false },
          ai: {
            enabled: true,
            provider: 'openai',
            model: 'gpt-4o-mini',
            maxCallsPerUserPerDay: 50,
            apiKey: { ...enc, last4: PLAINTEXT.slice(-4), updatedAt: '2026-01-01T00:00:00.000Z' },
          },
        },
      },
    });

    // A secret value under VAULT_ENCRYPTION_KEY, to prove the move leaves it alone.
    const type = await prisma.secretType.create({
      data: { name: 'Note', fields: [], isSystem: false },
    });
    const secret = await prisma.secret.create({ data: { name: 'fixture', typeId: type.id } });
    const value = crypto.encrypt('{"note":"fixture value"}');
    await prisma.secretVersion.create({
      data: {
        secretId: secret.id,
        version: 1,
        encryptedData: value.ciphertext,
        iv: value.iv,
        authTag: value.authTag,
        isCurrent: true,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await deployment?.drop();
  });

  it('dry run, then apply, then a rerun: the key moves once, and nothing else changes', async () => {
    const versionsBefore = await secretVersionsFingerprint();
    expect(versionsBefore).not.toBe('');

    // --- dry run (the default) -------------------------------------------
    const dry = runCommand();
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('dry run');
    expect(dry.stdout).toContain('outcome: would-migrate');
    expect(dry.stdout).toContain('legacy key decrypts with VAULT_ENCRYPTION_KEY: yes');
    expect(dry.stdout + dry.stderr).not.toContain(PLAINTEXT);
    expect(await prisma.credential.count()).toBe(0);
    expect(((await prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } })).value as any).ai.apiKey).not.toBeNull();

    // --- apply -------------------------------------------------------------
    const applied = runCommand('--apply');
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('outcome: migrated');
    expect(applied.stdout + applied.stderr).not.toContain(PLAINTEXT);

    const credential = await prisma.credential.findUniqueOrThrow({
      where: { purpose_name: { purpose: 'ai', name: 'openai' } },
    });
    expect(decryptSecret(credential.secret, 'ai')).toBe(PLAINTEXT);
    expect(credential.secret).not.toContain(PLAINTEXT);
    expect(credential.hint).toBe('••••mnop');

    const row = await prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });
    const value = row.value as any;
    expect(value.ai.apiKey).toBeNull();
    expect(value.ai).toMatchObject({ enabled: true, model: 'gpt-4o-mini', maxCallsPerUserPerDay: 50 });
    expect(value.maintenance).toEqual({ enabled: false });
    expect(row.version).toBe(2);
    expect(JSON.stringify(row)).not.toContain(PLAINTEXT);

    const audit = await prisma.auditEvent.findMany({ where: { action: 'ai.key.migrated' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(PLAINTEXT);

    // --- rerun: idempotent ---------------------------------------------------
    const rerun = runCommand('--apply');
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain('outcome: nothing-to-migrate');
    expect(rerun.stdout + rerun.stderr).not.toContain(PLAINTEXT);
    expect(await prisma.credential.count()).toBe(1);
    expect((await prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } })).version).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: 'ai.key.migrated' } })).toBe(1);

    // --- the platform store now answers for the key -------------------------
    const credentials = new CredentialsService(prisma as never);
    await expect(credentials.getSecret('ai', 'openai')).resolves.toBe(PLAINTEXT);

    // --- secret values were never touched -----------------------------------
    expect(await secretVersionsFingerprint()).toBe(versionsBefore);
  }, 240_000);

  it('the library function refuses a different credential and reports counts only', async () => {
    // State after the test above: key moved. Put a legacy block back with a
    // DIFFERENT key while the credential holds the original.
    const other = crypto.encrypt('sk-test-OTHER-OTHER-OTHER-OTHER-12');
    const row = await prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });
    const value = row.value as any;
    await prisma.systemSettings.update({
      where: { key: 'global' },
      data: { value: { ...value, ai: { ...value.ai, apiKey: { ...other, last4: 'ER-12', updatedAt: 'x' } } } },
    });

    const report = await migrateAiKey(
      { prisma: prisma as never, crypto, credentials: new CredentialsService(prisma as never) },
      { apply: true },
    );

    expect(report.outcome).toBe('conflict');
    const stored = await new CredentialsService(prisma as never).getSecret('ai', 'openai');
    expect(stored).toBe(PLAINTEXT);
  });
});
