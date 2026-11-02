import {
  formatSettingsMigrationReport,
  migrateSettings,
  migrateUserSettingsValue,
  SETTINGS_MIGRATION_AUDIT_ACTION,
  type SettingsMigrationPrisma,
} from './settings-migration';

type Row = { id: string; userId: string; value: unknown; version: number };

function fakePrisma(rows: Row[], system: unknown = null, opts: { stale?: Set<string> } = {}) {
  const audit: unknown[] = [];
  const prisma: SettingsMigrationPrisma = {
    systemSettings: { findUnique: jest.fn(async () => (system === null ? null : { value: system })) },
    userSettings: {
      findMany: jest.fn(async ({ take, cursor, skip }) => {
        const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
        const start = cursor ? sorted.findIndex((r) => r.id === cursor.id) + (skip ?? 0) : 0;
        return sorted.slice(start, start + take);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row || row.version !== where.version || opts.stale?.has(where.id)) return { count: 0 };
        row.value = data.value;
        row.version += data.version.increment;
        return { count: 1 };
      }),
    },
    auditEvent: { create: jest.fn(async (args) => audit.push(args.data)) },
  };
  return { prisma, audit };
}

const legacy = (over: Record<string, unknown> = {}): Row => ({
  id: 'u1',
  userId: 'user-1',
  version: 1,
  value: {
    theme: 'dark',
    profile: { displayName: 'Person A', useProviderImage: true, customImageUrl: null },
    ...over,
  },
});

describe('migrateUserSettingsValue', () => {
  it('turns useProviderImage true into imageSource provider and keeps theme and name', () => {
    expect(migrateUserSettingsValue(legacy().value)).toEqual({
      theme: 'dark',
      profile: { displayName: 'Person A', imageSource: 'provider', imageObjectId: null },
    });
  });

  it('turns useProviderImage false into none and keeps a custom image URL', () => {
    const value = { theme: 'light', profile: { useProviderImage: false, customImageUrl: 'https://img.example.test/a.png' } };
    expect(migrateUserSettingsValue(value)).toEqual({
      theme: 'light',
      profile: { imageSource: 'none', imageObjectId: null, customImageUrl: 'https://img.example.test/a.png' },
    });
  });

  it('drops an empty or null custom image URL', () => {
    const value = { theme: 'system', profile: { useProviderImage: false, customImageUrl: '' } };
    expect(migrateUserSettingsValue(value)).toEqual({
      theme: 'system',
      profile: { imageSource: 'none', imageObjectId: null },
    });
  });

  it('keeps every key it does not own (a namespace, an unknown key)', () => {
    const value = { theme: 'system', profile: { useProviderImage: true }, dataTables: { t: {} }, future: 1 };
    expect(migrateUserSettingsValue(value)).toMatchObject({ dataTables: { t: {} }, future: 1 });
  });

  it('returns null for a profile already in the platform layout', () => {
    expect(migrateUserSettingsValue({ theme: 'dark', profile: { imageSource: 'upload', imageObjectId: null } })).toBeNull();
  });

  it('returns null for something that is not a settings document', () => {
    expect(migrateUserSettingsValue(null)).toBeNull();
    expect(migrateUserSettingsValue('x')).toBeNull();
    expect(migrateUserSettingsValue({ theme: 'dark' })).toBeNull();
  });

  it('is idempotent', () => {
    const once = migrateUserSettingsValue(legacy().value);
    expect(migrateUserSettingsValue(once)).toBeNull();
  });
});

describe('migrateSettings', () => {
  it('dry run counts and writes nothing', async () => {
    const rows = [legacy()];
    const before = JSON.stringify(rows);
    const { prisma, audit } = fakePrisma(rows, { ui: {}, features: {} });

    const report = await migrateSettings(prisma);

    expect(report).toMatchObject({ apply: false, userRowsScanned: 1, userRowsToMigrate: 1, userRowsMigrated: 0 });
    expect(JSON.stringify(rows)).toBe(before);
    expect(prisma.userSettings.updateMany).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it('apply rewrites legacy rows, bumps the version and audits counts only', async () => {
    const rows = [legacy(), { id: 'u2', userId: 'user-2', version: 3, value: { theme: 'system', profile: { imageSource: 'provider', imageObjectId: null } } }];
    const { prisma, audit } = fakePrisma(rows);

    const report = await migrateSettings(prisma, { apply: true });

    expect(report).toMatchObject({ userRowsScanned: 2, userRowsMigrated: 1, userRowsCurrent: 1 });
    expect(rows[0].version).toBe(2);
    expect((rows[0].value as { profile: Record<string, unknown> }).profile).toEqual({
      displayName: 'Person A',
      imageSource: 'provider',
      imageObjectId: null,
    });
    expect(rows[1].version).toBe(3);
    expect(audit).toEqual([
      expect.objectContaining({ action: SETTINGS_MIGRATION_AUDIT_ACTION, meta: { userRowsMigrated: 1, userRowsSkippedConcurrent: 0 } }),
    ]);
  });

  it('a rerun changes nothing and writes no audit row', async () => {
    const rows = [legacy()];
    const { prisma, audit } = fakePrisma(rows);
    await migrateSettings(prisma, { apply: true });
    audit.length = 0;

    const second = await migrateSettings(prisma, { apply: true });

    expect(second).toMatchObject({ userRowsMigrated: 0, userRowsToMigrate: 0, userRowsCurrent: 1 });
    expect(audit).toEqual([]);
  });

  it('skips a row changed between the read and the write', async () => {
    const rows = [legacy()];
    const { prisma } = fakePrisma(rows, null, { stale: new Set(['u1']) });

    const report = await migrateSettings(prisma, { apply: true });

    expect(report).toMatchObject({ userRowsMigrated: 0, userRowsSkippedConcurrent: 1 });
    expect((rows[0].value as { profile: Record<string, unknown> }).profile.useProviderImage).toBe(true);
  });

  it('pages through more rows than one page', async () => {
    const rows: Row[] = Array.from({ length: 1203 }, (_, i) => ({
      id: `r${String(i).padStart(5, '0')}`,
      userId: `u${i}`,
      version: 1,
      value: { theme: 'system', profile: { useProviderImage: true } },
    }));
    const { prisma } = fakePrisma(rows);

    const report = await migrateSettings(prisma, { apply: true });

    expect(report.userRowsScanned).toBe(1203);
    expect(report.userRowsMigrated).toBe(1203);
  });

  it('leaves a row that is not an object alone and counts it', async () => {
    const rows: Row[] = [{ id: 'u1', userId: 'x', version: 1, value: 'oops' }];
    const { prisma } = fakePrisma(rows);
    expect(await migrateSettings(prisma, { apply: true })).toMatchObject({ userRowsUnrecognised: 1, userRowsMigrated: 0 });
    expect(rows[0].value).toBe('oops');
  });

  it('reports a pre-E4.2 ai.apiKey block without touching the system row', async () => {
    const system = { ui: {}, ai: { enabled: true, apiKey: { ciphertext: 'x', iv: 'y', authTag: 'z' } } };
    const { prisma } = fakePrisma([], system);

    const report = await migrateSettings(prisma, { apply: true });

    expect(report.legacyAiKeyBlockPresent).toBe(true);
    expect(formatSettingsMigrationReport(report).join('\n')).toContain('vault:migrate-ai-key');
  });

  it('never prints a settings value', async () => {
    const { prisma } = fakePrisma([legacy({ profile: { displayName: 'Secret Name', useProviderImage: true } })]);
    const lines = formatSettingsMigrationReport(await migrateSettings(prisma, { apply: true })).join('\n');
    expect(lines).not.toContain('Secret Name');
  });
});
