import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '../settings/registry';
import { systemSettingsNamespaceRegistry } from '@marinoscar/platform-api/settings';
import { VAULT_AI_POLICY } from '../app-registrations/settings';
import {
  AI_PLATFORM_MIGRATION_AUDIT_ACTION,
  AiPlatformMigrationPrisma,
  formatAiPlatformMigrationReport,
  migrateAiPlatform,
  planAiBlock,
} from './ai-platform-migration';

const LEGACY = { enabled: true, provider: 'openai', model: 'gpt-4o', maxCallsPerUserPerDay: 30, apiKey: null };

function harness(initial: Record<string, unknown>, models: Array<{ modelId: string; enabled: boolean }> = []) {
  const state = {
    row: { id: 'row-1', value: initial, version: 4 },
    models: [...models],
    audits: [] as Array<Record<string, any>>,
    versionBump: false,
  };
  const prisma: AiPlatformMigrationPrisma = {
    systemSettings: {
      findUnique: async () => state.row,
      updateMany: async ({ where, data }) => {
        if (state.versionBump || where.version !== state.row.version) return { count: 0 };
        state.row = { ...state.row, value: data.value as never, version: state.row.version + 1 };
        return { count: 1 };
      },
    },
    aiModel: {
      findUnique: async ({ where }) =>
        state.models.find((m) => m.modelId === where.provider_modelId.modelId) ?? null,
      create: async ({ data }) => {
        state.models.push({ modelId: data.modelId as string, enabled: data.enabled as boolean });
        return data;
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      },
    },
  };
  return { state, prisma };
}

describe('planAiBlock', () => {
  it('maps the legacy block into the platform shape and drops the old fields', () => {
    const plan = planAiBlock(LEGACY);
    expect(plan.next).toEqual({
      enabled: true,
      keyPolicy: 'byok_with_org_fallback',
      providers: { openai: { enabled: true } },
      cardExtractModel: 'gpt-4o',
      limits: { perUser: { requestsPerDay: 30 } },
    });
    expect(plan.next).not.toHaveProperty('model');
    expect(plan.next).not.toHaveProperty('maxCallsPerUserPerDay');
    expect(plan.next).not.toHaveProperty('provider');
  });

  it('produces a block the registered (platform + Vault) ai namespace accepts', () => {
    // A stored block is partial; the namespace fills the rest from its defaults on read.
    const ns = systemSettingsNamespaceRegistry.list().find((n) => n.key === 'ai')!;
    const d = ns.defaults as Record<string, any>;
    const next = planAiBlock(LEGACY).next as Record<string, any>;
    const parsed = VAULT_AI_POLICY.storedSchema.safeParse({ ...d, ...next, providers: { ...d.providers, ...next.providers } });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ cardExtractModel: 'gpt-4o', keyPolicy: 'byok_with_org_fallback', limits: { perUser: { requestsPerDay: 30 } } });
  });

  it('turns a zero budget (scanning blocked) into AI off, with no cap', () => {
    const plan = planAiBlock({ ...LEGACY, maxCallsPerUserPerDay: 0 });
    expect(plan.blockedByZeroBudget).toBe(true);
    expect(plan.next.enabled).toBe(false);
    expect(plan.next).not.toHaveProperty('limits');
  });

  it('keeps a platform value that is already there', () => {
    const plan = planAiBlock({ ...LEGACY, keyPolicy: 'byok', cardExtractModel: 'gpt-x', limits: { perUser: { requestsPerDay: 5 } } });
    expect(plan.next.keyPolicy).toBe('byok');
    expect(plan.next.cardExtractModel).toBe('gpt-x');
    expect((plan.next.limits as any).perUser.requestsPerDay).toBe(5);
  });
});

describe('migrateAiPlatform', () => {
  let dir: string;
  let snapshot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-platform-'));
    snapshot = join(dir, 'snap.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const keyPresent = async () => true;

  it('a dry run changes nothing and reports what an apply would do', async () => {
    const { state, prisma } = harness({ ui: { x: 1 }, ai: LEGACY });
    const report = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: false, snapshotPath: snapshot });

    expect(report).toMatchObject({ outcome: 'would-migrate', legacyShape: true, model: { id: 'gpt-4o', action: 'would-create' } });
    expect(state.row.version).toBe(4);
    expect(state.models).toEqual([]);
    expect(state.audits).toEqual([]);
    expect(existsSync(snapshot)).toBe(false);
  });

  it('apply writes the snapshot, the model row, the settings and one audit row; other keys survive', async () => {
    const { state, prisma } = harness({ ui: { x: 1 }, futureThing: { keep: 'me' }, ai: LEGACY });
    const report = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: snapshot });

    expect(report.outcome).toBe('migrated');
    const value = state.row.value as Record<string, any>;
    expect(value.ui).toEqual({ x: 1 });
    expect(value.futureThing).toEqual({ keep: 'me' });
    expect(value.ai).toMatchObject({ enabled: true, keyPolicy: 'byok_with_org_fallback', cardExtractModel: 'gpt-4o' });
    expect(state.models).toEqual([{ modelId: 'gpt-4o', enabled: true }]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].action).toBe(AI_PLATFORM_MIGRATION_AUDIT_ACTION);
    expect(JSON.parse(readFileSync(snapshot, 'utf8')).ai).toMatchObject({ model: 'gpt-4o', maxCallsPerUserPerDay: 30 });
  });

  it('is idempotent: a second run leaves the row version and the model alone', async () => {
    const { state, prisma } = harness({ ai: LEGACY });
    await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: snapshot });
    const version = state.row.version;

    const second = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: join(dir, 'snap2.json') });
    expect(second.outcome).toBe('already-migrated');
    expect(second.legacyShape).toBe(false);
    expect(state.row.version).toBe(version);
    expect(state.models).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(existsSync(join(dir, 'snap2.json'))).toBe(false);
  });

  it('never re-enables a model an administrator turned off', async () => {
    const { state, prisma } = harness({ ai: LEGACY }, [{ modelId: 'gpt-4o', enabled: false }]);
    const report = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: snapshot });
    expect(report.model).toMatchObject({ action: 'exists', enabled: false });
    expect(state.models).toEqual([{ modelId: 'gpt-4o', enabled: false }]);
  });

  it('refuses to apply while a pre-E4.2 ciphertext key block waits, writing nothing', async () => {
    const { state, prisma } = harness({ ai: { ...LEGACY, apiKey: { ciphertext: 'x', iv: 'y', authTag: 'z' } } });
    const report = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: snapshot });
    expect(report.problems.join(' ')).toContain('vault:migrate-ai-key');
    expect(state.row.version).toBe(4);
    expect(state.models).toEqual([]);
    expect(existsSync(snapshot)).toBe(false);
  });

  it('refuses to apply enabled AI with no deployment key', async () => {
    const { state, prisma } = harness({ ai: LEGACY });
    const report = await migrateAiPlatform({ prisma, keyConfigured: async () => false }, { apply: true, snapshotPath: snapshot });
    expect(report.problems.join(' ')).toContain('no deployment key');
    expect(state.row.version).toBe(4);
  });

  it('detects a concurrent settings write instead of overwriting it', async () => {
    const { state, prisma } = harness({ ai: LEGACY });
    state.versionBump = true;
    await expect(
      migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: snapshot }),
    ).rejects.toThrow(/changed while migrating/);
  });

  it('does nothing when there is no ai block', async () => {
    const { prisma } = harness({ ui: {} });
    const report = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: true, snapshotPath: snapshot });
    expect(report.outcome).toBe('nothing-to-migrate');
  });

  it('prints counts and names only', async () => {
    const { prisma } = harness({ ai: LEGACY });
    const report = await migrateAiPlatform({ prisma, keyConfigured: keyPresent }, { apply: false });
    const text = formatAiPlatformMigrationReport(report).join('\n');
    expect(text).toContain('cardExtractModel=gpt-4o');
    expect(text).toContain('perUserRequestsPerDay=30');
  });
});
