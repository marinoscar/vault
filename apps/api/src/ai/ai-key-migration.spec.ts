import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { decryptSecret } from '@marinoscar/platform-api/core';

import '../platform/credentials/credentials.config';
import { CryptoService } from '../common/services/crypto.service';
import {
  AI_KEY_MIGRATION_AUDIT_ACTION,
  AiKeyMigrationError,
  AiKeyMigrationPrisma,
  formatAiKeyMigrationReport,
  migrateAiKey,
} from './ai-key-migration';

const PLAINTEXT = 'sk-test-0123456789abcdefghijklmnop';
const OTHER = 'sk-test-ZZZZZZZZZZZZZZZZZZZZZZZZZZ';
const VAULT_KEY_HEX = '00'.repeat(16) + '11'.repeat(16);

function vaultCrypto(): CryptoService {
  const crypto = new CryptoService({ get: () => VAULT_KEY_HEX } as never);
  crypto.onModuleInit();
  return crypto;
}

/** In-memory `system_settings` + `credentials` + `audit_events`, enough for the command. */
function harness(options: { legacyKey?: string | null; version?: number } = {}) {
  const crypto = vaultCrypto();
  const legacy =
    options.legacyKey === null
      ? null
      : (() => {
          const enc = crypto.encrypt(options.legacyKey ?? PLAINTEXT);
          return { ...enc, last4: (options.legacyKey ?? PLAINTEXT).slice(-4), updatedAt: '2026-01-01T00:00:00.000Z' };
        })();

  const state = {
    row: {
      id: 'settings-1',
      value: {
        ui: { allowUserThemeOverride: true },
        features: {},
        maintenance: { enabled: false },
        ai: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', maxCallsPerUserPerDay: 50, apiKey: legacy },
      } as Record<string, any>,
      version: options.version ?? 3,
    },
    credential: null as null | { secret: string; hint: string | null; label: string | null; updatedAt: Date },
    audit: [] as any[],
    updateManyCount: 1,
  };

  const credentialDelegate = {
    findUnique: jest.fn(async (args: any) => {
      if (!state.credential) return null;
      return args.select?.secret
        ? { secret: state.credential.secret }
        : { purpose: 'ai', name: 'openai', createdAt: new Date(), updatedByUserId: null, ...state.credential };
    }),
    upsert: jest.fn(async (args: any) => {
      state.credential = {
        secret: args.create.secret,
        hint: args.create.hint,
        label: args.create.label,
        updatedAt: new Date(),
      };
    }),
  };

  const prisma: AiKeyMigrationPrisma = {
    systemSettings: {
      findUnique: jest.fn(async () => state.row),
      updateMany: jest.fn(async (args: any) => {
        if (state.updateManyCount === 1) {
          state.row = { ...state.row, value: args.data.value, version: state.row.version + 1 };
        }
        return { count: state.updateManyCount };
      }),
    },
    auditEvent: {
      create: jest.fn(async (args: any) => {
        state.audit.push(args.data);
        return {};
      }),
    },
  };

  const credentials = new CredentialsService({ credential: credentialDelegate } as never);
  return { state, prisma, crypto, credentials, credentialDelegate };
}

/** Everything written to stdout, stderr and the console while `fn` runs. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; error?: unknown; output: string }> {
  const chunks: string[] = [];
  const spies = [
    jest.spyOn(console, 'log').mockImplementation((...a) => void chunks.push(a.join(' '))),
    jest.spyOn(console, 'error').mockImplementation((...a) => void chunks.push(a.join(' '))),
    jest.spyOn(console, 'warn').mockImplementation((...a) => void chunks.push(a.join(' '))),
    jest.spyOn(console, 'info').mockImplementation((...a) => void chunks.push(a.join(' '))),
    jest.spyOn(console, 'debug').mockImplementation((...a) => void chunks.push(a.join(' '))),
    jest.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => (chunks.push(String(c)), true)) as never),
    jest.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => (chunks.push(String(c)), true)) as never),
  ];
  try {
    const result = await fn();
    return { result, output: chunks.join('\n') };
  } catch (error) {
    return { result: undefined, error, output: chunks.join('\n') };
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}

describe('migrateAiKey', () => {
  it('dry run (the default) reports what it would do and writes nothing', async () => {
    const h = harness();
    const before = JSON.stringify(h.state.row);

    const { result, output } = await captureOutput(async () => {
      const report = await migrateAiKey(h, { apply: false });
      formatAiKeyMigrationReport(report).forEach((l) => console.log(l));
      return report;
    });

    expect(result).toMatchObject({
      apply: false,
      outcome: 'would-migrate',
      legacyKeyPresent: true,
      legacyKeyDecryptable: true,
      legacyLast4: 'mnop',
      credentialPresent: false,
    });
    expect(h.credentialDelegate.upsert).not.toHaveBeenCalled();
    expect(h.prisma.systemSettings.updateMany).not.toHaveBeenCalled();
    expect(h.state.audit).toHaveLength(0);
    expect(JSON.stringify(h.state.row)).toBe(before);
    expect(output).toContain('mnop');
    expect(output).not.toContain(PLAINTEXT);
  });

  it('apply round-trips: the credential decrypts to the key, the old field is blanked, nothing else in the row changes', async () => {
    const h = harness();

    const { result } = await captureOutput(() => migrateAiKey(h, { apply: true }));

    expect(result).toMatchObject({ outcome: 'migrated', credentialPresent: true });
    // The new store holds the key under the platform cipher (purpose "ai")...
    expect(decryptSecret(h.state.credential!.secret, 'ai')).toBe(PLAINTEXT);
    expect(h.state.credential!.label).toContain('OpenAI');
    // ...and the plaintext is not in the stored ciphertext or the hint.
    expect(h.state.credential!.secret).not.toContain(PLAINTEXT);
    expect(h.state.credential!.hint).toBe('••••mnop');
    // The legacy field is null; every other key (including the platform's) is untouched.
    expect(h.state.row.value.ai).toEqual({
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxCallsPerUserPerDay: 50,
      apiKey: null,
    });
    expect(h.state.row.value.maintenance).toEqual({ enabled: false });
    expect(h.state.row.value.ui).toEqual({ allowUserThemeOverride: true });
    expect(h.state.row.version).toBe(4);
    // Guarded by the version it read.
    expect(h.prisma.systemSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'global', version: 3 } }),
    );
    expect(h.state.audit).toEqual([
      expect.objectContaining({ action: AI_KEY_MIGRATION_AUDIT_ACTION, targetId: 'ai/openai' }),
    ]);
  });

  it('is idempotent: a rerun finds no legacy key and changes nothing', async () => {
    const h = harness();
    await captureOutput(() => migrateAiKey(h, { apply: true }));
    const credentialAfterFirst = JSON.stringify(h.state.credential);
    const rowAfterFirst = JSON.stringify(h.state.row);
    h.credentialDelegate.upsert.mockClear();
    (h.prisma.systemSettings.updateMany as jest.Mock).mockClear();

    const { result } = await captureOutput(() => migrateAiKey(h, { apply: true }));

    expect(result).toMatchObject({
      outcome: 'nothing-to-migrate',
      legacyKeyPresent: false,
      credentialPresent: true,
    });
    expect(h.credentialDelegate.upsert).not.toHaveBeenCalled();
    expect(h.prisma.systemSettings.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(h.state.credential)).toBe(credentialAfterFirst);
    expect(JSON.stringify(h.state.row)).toBe(rowAfterFirst);
    expect(h.state.audit).toHaveLength(1);
  });

  it('does nothing on a database that never had a key', async () => {
    const h = harness({ legacyKey: null });
    const { result } = await captureOutput(() => migrateAiKey(h, { apply: true }));
    expect(result).toMatchObject({ outcome: 'nothing-to-migrate', credentialPresent: false });
    expect(h.state.credential).toBeNull();
  });

  it('finishes a half-done run: the credential already holds the key, so only the old field is blanked', async () => {
    const h = harness();
    await h.credentials.setSecret('ai', 'openai', PLAINTEXT);
    h.credentialDelegate.upsert.mockClear();

    const dry = await migrateAiKey(h, { apply: false });
    expect(dry.outcome).toBe('would-blank-only');

    const { result } = await captureOutput(() => migrateAiKey(h, { apply: true }));
    expect(result).toMatchObject({ outcome: 'blanked-only' });
    expect(h.credentialDelegate.upsert).not.toHaveBeenCalled();
    expect(h.state.row.value.ai.apiKey).toBeNull();
  });

  it('refuses, changing nothing, when a DIFFERENT credential is already stored', async () => {
    const h = harness();
    await h.credentials.setSecret('ai', 'openai', OTHER);
    h.credentialDelegate.upsert.mockClear();
    const secretBefore = h.state.credential!.secret;

    const { result, output } = await captureOutput(async () => {
      const report = await migrateAiKey(h, { apply: true });
      formatAiKeyMigrationReport(report).forEach((l) => console.log(l));
      return report;
    });

    expect(result).toMatchObject({ outcome: 'conflict', credentialPresent: true });
    expect(h.credentialDelegate.upsert).not.toHaveBeenCalled();
    expect(h.state.credential!.secret).toBe(secretBefore);
    expect(h.state.row.value.ai.apiKey).not.toBeNull();
    expect(output).not.toContain(PLAINTEXT);
    expect(output).not.toContain(OTHER);
  });

  it('fails at "decrypt-legacy" when VAULT_ENCRYPTION_KEY cannot read the block, naming no value', async () => {
    const h = harness();
    const wrong = new CryptoService({ get: () => 'ff'.repeat(32) } as never);
    wrong.onModuleInit();

    const { error, output } = await captureOutput(() => migrateAiKey({ ...h, crypto: wrong }, { apply: true }));

    expect(error).toBeInstanceOf(AiKeyMigrationError);
    expect((error as AiKeyMigrationError).stage).toBe('decrypt-legacy');
    expect((error as Error).message).not.toContain(h.state.row.value.ai.apiKey.ciphertext);
    expect(h.state.credential).toBeNull();
    expect(h.state.row.value.ai.apiKey).not.toBeNull();
    expect(output).not.toContain(PLAINTEXT);
  });

  it('leaves the old field in place when the credential store refuses the write', async () => {
    const h = harness();
    h.credentialDelegate.upsert.mockRejectedValue(new Error(`boom ${PLAINTEXT}`));

    const { error, output } = await captureOutput(() => migrateAiKey(h, { apply: true }));

    expect((error as AiKeyMigrationError).stage).toBe('store-credential');
    // The driver's message (which could echo a parameter) does not travel.
    expect((error as Error).message).not.toContain(PLAINTEXT);
    expect(output).not.toContain(PLAINTEXT);
    expect(h.prisma.systemSettings.updateMany).not.toHaveBeenCalled();
    expect(h.state.row.value.ai.apiKey).not.toBeNull();
  });

  it('refuses to blank over a concurrent settings write', async () => {
    const h = harness();
    h.state.updateManyCount = 0;

    const { error } = await captureOutput(() => migrateAiKey(h, { apply: true }));

    expect((error as AiKeyMigrationError).stage).toBe('concurrent-write');
    expect(h.state.audit).toHaveLength(0);
  });

  it('never emits the key or its legacy ciphertext in the report, the lines or any output', async () => {
    const h = harness();
    const legacyCiphertext = h.state.row.value.ai.apiKey.ciphertext;

    const { result, output } = await captureOutput(async () => {
      const report = await migrateAiKey(h, { apply: true });
      formatAiKeyMigrationReport(report).forEach((l) => console.log(l));
      return report;
    });

    const everything = JSON.stringify(result) + output;
    expect(everything).not.toContain(PLAINTEXT);
    expect(everything).not.toContain(legacyCiphertext);
    expect(JSON.stringify(h.state.audit)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(h.state.audit)).not.toContain('mnop');
  });
});
