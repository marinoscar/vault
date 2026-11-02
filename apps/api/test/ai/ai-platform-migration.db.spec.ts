// =============================================================================
// Real-Postgres test: `vault:migrate-ai-platform` (issue #87, E8.1; #88, E8.2)
// =============================================================================
//
// Plants the `global` row EXACTLY as the pre-E8 build wrote it (Vault's own `ai`
// block), the deployment key at ('ai', 'openai') as E4.2 left it, runs the REAL
// command through ts-node as the application role, and proves:
//   * a dry run changes nothing;
//   * apply rewrites only `ai`, writes the enabled catalogue row, a snapshot and one
//     audit row; every other key survives; the key is untouched and never printed;
//   * the platform reads the result: the extended `ai` namespace parses it;
//   * a rerun is a no-op and never re-enables a model an administrator disabled.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CredentialsService } from '@marinoscar/platform-api/credentials';

import '../../src/settings/registry';
import '../../src/platform/credentials/credential-purposes.manifest';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import { VAULT_AI_POLICY } from '../../src/app-registrations/settings';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const API_ROOT = join(__dirname, '..', '..');
const KEY = 'sk-test-0123456789abcdefghijklmnop';

describeWithDb('vault:migrate-ai-platform against a real database', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let dir: string;

  const run = (...args: string[]) => {
    const { DATABASE_URL: _ignored, ...base } = process.env;
    try {
      const stdout = execFileSync(
        process.execPath,
        [require.resolve('ts-node/dist/bin.js'), '--project', 'prisma/tsconfig.json', '--transpile-only', 'scripts/migrate-ai-platform.ts', ...args],
        { cwd: API_ROOT, env: { ...base, ...(deployment.env as Record<string, string>), NODE_ENV: 'test' }, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 },
      );
      return { stdout, stderr: '', status: 0 };
    } catch (error: any) {
      return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), status: error.status ?? 1 };
    }
  };
  const globalRow = () => prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();
    dir = mkdtempSync(join(tmpdir(), 'ai-platform-db-'));

    await prisma.systemSettings.create({
      data: {
        key: 'global',
        value: {
          ui: { allowUserThemeOverride: false },
          features: { cardScanning: true },
          ai: { enabled: true, provider: 'openai', model: 'gpt-4o', maxCallsPerUserPerDay: 12, apiKey: null },
          futureThing: { keep: 'me' },
        },
      },
    });
    // The key as E4.2 stored it (the command only DESCRIBES it).
    await new CredentialsService(prisma as never).setSecret('ai', 'openai', KEY, { label: 'AI provider key (OpenAI)' });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await deployment?.drop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('a dry run (the default) changes nothing and prints no key', async () => {
    const before = await globalRow();
    const res = run('--snapshot', join(dir, 'dry.json'));

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('outcome: would-migrate');
    expect(res.stdout).toContain('perUserRequestsPerDay=12');
    expect(res.stdout + res.stderr).not.toContain(KEY);
    expect((await globalRow()).version).toBe(before.version);
    expect(await prisma.aiModel.count()).toBe(0);
    expect(existsSync(join(dir, 'dry.json'))).toBe(false);
  }, 150_000);

  it('apply rewrites only the ai block, enables the model, snapshots the old block and audits once', async () => {
    const snapshot = join(dir, 'apply.json');
    const res = run('--apply', '--snapshot', snapshot);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('outcome: migrated');
    expect(res.stdout + res.stderr).not.toContain(KEY);

    const value = (await globalRow()).value as Record<string, any>;
    expect(value.ui).toEqual({ allowUserThemeOverride: false });
    expect(value.futureThing).toEqual({ keep: 'me' });
    expect(value.ai).toEqual({
      enabled: true,
      keyPolicy: 'byok_with_org_fallback',
      providers: { openai: { enabled: true } },
      cardExtractModel: 'gpt-4o',
      limits: { perUser: { requestsPerDay: 12 } },
    });
    // The platform namespace (with Vault's extension) accepts what was written.
    const d = DEFAULT_SYSTEM_SETTINGS.ai as Record<string, any>;
    expect(VAULT_AI_POLICY.storedSchema.safeParse({ ...d, ...value.ai, providers: { ...d.providers, ...value.ai.providers } }).success).toBe(true);

    const model = await prisma.aiModel.findUniqueOrThrow({ where: { provider_modelId: { provider: 'openai', modelId: 'gpt-4o' } } });
    expect(model).toMatchObject({ enabled: true, capabilitySource: 'admin_override' });
    expect((model.capabilities as { capabilities: string[] }).capabilities).toEqual(expect.arrayContaining(['responses']));

    expect(JSON.parse(readFileSync(snapshot, 'utf8')).ai).toMatchObject({ model: 'gpt-4o', maxCallsPerUserPerDay: 12, provider: 'openai' });
    expect(await prisma.auditEvent.count({ where: { action: 'system_settings:ai-platform-migrate' } })).toBe(1);
    expect(JSON.stringify(await prisma.auditEvent.findMany())).not.toContain(KEY);
    // The key is exactly where the AI slice reads it.
    expect(await new CredentialsService(prisma as never).getSecret('ai', 'openai')).toBe(KEY);
  }, 150_000);

  it('is idempotent: a rerun changes nothing, and never re-enables a model an administrator turned off', async () => {
    await prisma.aiModel.updateMany({ where: { modelId: 'gpt-4o' }, data: { enabled: false } });
    const before = await globalRow();

    const res = run('--apply', '--snapshot', join(dir, 'again.json'));

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('outcome: already-migrated');
    expect((await globalRow()).version).toBe(before.version);
    expect((await prisma.aiModel.findFirstOrThrow({ where: { modelId: 'gpt-4o' } })).enabled).toBe(false);
    expect(await prisma.auditEvent.count({ where: { action: 'system_settings:ai-platform-migrate' } })).toBe(1);
    expect(existsSync(join(dir, 'again.json'))).toBe(false);
  }, 150_000);
});
