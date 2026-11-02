// The legacy-storage-environment import (issue #84, E6.1): dry run changes nothing,
// apply stores the credential FIRST then the settings, a rerun is a no-op, runtime
// configuration is never overwritten, and the secret never reaches the report.

import {
  StorageImportError,
  formatStorageImportReport,
  importStorageConfig,
  legacyStorageEnvPresent,
  readLegacyStorageEnv,
  type StorageImportPrisma,
} from './storage-env-import';

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYexamplekey';
const ENV = {
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'vault-prod-bucket',
  S3_REGION: 'eu-west-1',
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
  AWS_SECRET_ACCESS_KEY: SECRET,
};

function fakes(row: { value: unknown; version: number } | null, stored?: string | null) {
  const state = { row: row ? { id: 'row-1', ...row } : null, secret: stored ?? null, calls: [] as string[], audit: [] as unknown[] };
  const prisma: StorageImportPrisma = {
    systemSettings: {
      findUnique: async () => state.row,
      updateMany: async ({ where, data }) => {
        state.calls.push('settings');
        if (!state.row || state.row.version !== where.version) return { count: 0 };
        state.row = { ...state.row, value: data.value, version: state.row.version + 1 };
        return { count: 1 };
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        state.audit.push(data);
        return {};
      },
    },
  };
  const credentials = {
    describe: async () => (state.secret === null ? null : ({ purpose: 'storage', name: 'default' } as never)),
    getSecret: async () => state.secret,
    setSecret: async (_p: string, _n: string, secret: string | null | undefined) => {
      state.calls.push('credential');
      state.secret = secret ?? null;
    },
  };
  return { state, deps: { prisma, credentials } };
}

describe('readLegacyStorageEnv', () => {
  it('maps a plain S3 environment to the s3 driver with the legacy default region', () => {
    expect(readLegacyStorageEnv({ S3_BUCKET: 'b', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' })).toMatchObject({
      driver: 's3',
      bucket: 'b',
      region: 'us-east-1',
      endpoint: '',
    });
  });

  it('maps an endpoint to the s3compatible driver', () => {
    expect(readLegacyStorageEnv({ ...ENV, S3_ENDPOINT: 'http://localhost:9000' })).toMatchObject({
      driver: 's3compatible',
      endpoint: 'http://localhost:9000',
    });
  });

  it.each([[''], ['your-bucket-name'], ['your-bucket'], ['  ']])('treats %p as no bucket', (bucket) => {
    expect(readLegacyStorageEnv({ S3_BUCKET: bucket })).toBeNull();
    expect(legacyStorageEnvPresent({ S3_BUCKET: bucket })).toBe(false);
  });

  it('reports an endpoint alone as legacy configuration for the Doctor', () => {
    expect(legacyStorageEnvPresent({ S3_ENDPOINT: 'http://localhost:9000' })).toBe(true);
    expect(legacyStorageEnvPresent({ AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' })).toBe(false);
  });
});

describe('importStorageConfig', () => {
  const emptyRow = { value: { ui: { allowUserThemeOverride: true } }, version: 3 };

  it('has nothing to import without a bucket', async () => {
    const { deps, state } = fakes(emptyRow);
    const report = await importStorageConfig(deps, {}, { apply: true });
    expect(report.outcome).toBe('nothing-to-import');
    expect(state.calls).toEqual([]);
  });

  it('dry run reports would-import and changes nothing', async () => {
    const { deps, state } = fakes(emptyRow);
    const report = await importStorageConfig(deps, ENV, { apply: false });
    expect(report).toMatchObject({ outcome: 'would-import', apply: false, bucket: 'vault-prod-bucket', driver: 's3' });
    expect(state.calls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('apply stores the credential before the settings, keeps other namespaces and audits without the key', async () => {
    const { deps, state } = fakes(emptyRow);
    const report = await importStorageConfig(deps, ENV, { apply: true });

    expect(report.outcome).toBe('imported');
    expect(state.calls).toEqual(['credential', 'settings']);
    expect(state.secret).toBe(SECRET);
    expect(state.row?.version).toBe(4);
    expect(state.row?.value).toEqual({
      ui: { allowUserThemeOverride: true },
      storage: {
        provider: 's3',
        drivers: {
          s3: { bucket: 'vault-prod-bucket', region: 'eu-west-1', endpoint: '', accessKeyId: 'AKIAEXAMPLEKEYID', forcePathStyle: null },
        },
      },
    });
    expect(JSON.stringify(state.audit)).not.toContain(SECRET);
    expect(state.audit).toHaveLength(1);
  });

  it('is idempotent: a second apply is already-configured and writes nothing', async () => {
    const { deps, state } = fakes(emptyRow);
    await importStorageConfig(deps, ENV, { apply: true });
    state.calls.length = 0;
    state.audit.length = 0;

    const again = await importStorageConfig(deps, ENV, { apply: true });
    expect(again.outcome).toBe('already-configured');
    expect(state.calls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('finishes a half-done run (the secret stored, the settings not)', async () => {
    const { deps, state } = fakes(emptyRow, SECRET);
    const report = await importStorageConfig(deps, ENV, { apply: true });
    expect(report.outcome).toBe('imported');
    expect(state.calls).toEqual(['settings']);
  });

  it('never overwrites a different runtime bucket (conflict), flat or per driver', async () => {
    for (const storage of [{ bucket: 'other-bucket' }, { provider: 's3', drivers: { s3: { bucket: 'other-bucket' } } }]) {
      const { deps, state } = fakes({ value: { storage }, version: 1 });
      const report = await importStorageConfig(deps, ENV, { apply: true });
      expect(report.outcome).toBe('conflict');
      expect(state.calls).toEqual([]);
    }
  });

  it('never overwrites a different stored secret (conflict)', async () => {
    const { deps, state } = fakes(emptyRow, 'a-different-secret');
    const report = await importStorageConfig(deps, ENV, { apply: true });
    expect(report.outcome).toBe('conflict');
    expect(state.secret).toBe('a-different-secret');
    expect(state.calls).toEqual([]);
  });

  it('is incomplete, and writes nothing, without both access keys', async () => {
    const { deps, state } = fakes(emptyRow);
    const report = await importStorageConfig(deps, { ...ENV, AWS_SECRET_ACCESS_KEY: '' }, { apply: true });
    expect(report.outcome).toBe('incomplete');
    expect(state.calls).toEqual([]);
  });

  it('fails at a named stage when the settings row is missing, before storing anything', async () => {
    const { deps, state } = fakes(null);
    await expect(importStorageConfig(deps, ENV, { apply: true })).rejects.toMatchObject({ stage: 'settings-row-missing' });
    expect(state.calls).toEqual([]);
  });

  it('detects a concurrent save of the settings row', async () => {
    const { deps, state } = fakes(emptyRow);
    const original = deps.prisma.systemSettings.findUnique;
    deps.prisma.systemSettings.findUnique = async (args) => {
      const row = await original(args);
      if (state.row) state.row = { ...state.row, version: state.row.version + 1 };
      return row;
    };
    const error = await importStorageConfig(deps, ENV, { apply: true }).catch((e) => e);
    expect(error).toBeInstanceOf(StorageImportError);
    expect(error.stage).toBe('concurrent-write');
    expect(state.secret).toBe(SECRET);
  });

  it('never prints the secret access key', async () => {
    const { deps } = fakes(emptyRow);
    for (const apply of [false, true]) {
      const report = await importStorageConfig(deps, ENV, { apply });
      expect(JSON.stringify(report)).not.toContain(SECRET);
      expect(formatStorageImportReport(report).join('\n')).not.toContain(SECRET);
    }
  });
});
