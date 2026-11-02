import { defaultOrgMock } from '../../test/mocks/default-org.mock';
import { Readable } from 'stream';

import { Logger } from '@nestjs/common';
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { CryptoService } from '../common/services/crypto.service';
import { encryptBackupPassword } from './backup-password';
import {
  BACKUP_FAILURE_MESSAGES,
  BACKUP_SCHEDULE_ID,
  BackupRunnerService,
} from './backup-runner.service';
import { BackupArchiveService } from './backup-archive.service';
import type { BackupRunRow } from './dto/backup-responses';

const PASSWORD = 'Zip-Pass-0xA1B2C3';
const NOW = new Date('2026-05-01T12:00:00Z');
const KEY = 'system-backups/vault-backup-2026-05-01_120000.zip';

const USERS = [
  { id: 'user-a-id', email: 'alice.person@example.test', displayName: 'Alice Person' },
  { id: 'user-b-id', email: 'bob.empty@example.test', displayName: null },
  { id: 'user-c-id', email: 'carol.person@example.test', displayName: 'Carol Person' },
];

const crypto = new CryptoService({ get: () => 'b'.repeat(64) } as never);
beforeAll(() => {
  Logger.overrideLogger(false);
  crypto.onModuleInit();
});
afterEach(() => jest.restoreAllMocks());

const runRow = (over: Partial<BackupRunRow> = {}): BackupRunRow => ({
  id: 'run-new',
  status: 'running',
  trigger: 'manual',
  triggeredById: null,
  storageKey: KEY,
  sizeBytes: null,
  userCount: 0,
  secretCount: 0,
  attachmentCount: 0,
  warningCount: 0,
  error: null,
  startedAt: NOW,
  finishedAt: null,
  deletedAt: null,
  ...over,
});

/** An upload that fails like a real SDK: it listens on the stream (so a stream error is not unhandled), then rejects. */
const failingUpload =
  (message: string) =>
  async (_key: string, stream: Readable): Promise<never> => {
    stream.on('error', () => undefined);
    stream.resume();
    throw new Error(message);
  };

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

interface Options {
  schedule?: Record<string, unknown> | null;
  upload?: (key: string, stream: Readable) => Promise<unknown>;
  existingRuns?: Array<Record<string, unknown>>;
  storageBucket?: string | null;
}

function setup(opts: Options = {}) {
  const uploads: Record<string, Buffer> = {};
  const schedule =
    opts.schedule === undefined
      ? {
          id: BACKUP_SCHEDULE_ID,
          enabled: true,
          frequency: 'daily',
          intervalHours: null,
          timeOfDay: '03:00',
          dayOfWeek: null,
          dayOfMonth: null,
          timezone: 'UTC',
          keepCount: 7,
          includeAttachments: true,
          includeVersions: false,
          passwordEncrypted: encryptBackupPassword(crypto, PASSWORD),
          nextRunAt: new Date('2026-05-01T03:00:00Z'),
        }
      : opts.schedule;

  const prisma = {
    ...defaultOrgMock(),
    backupSchedule: {
      findUnique: jest.fn(async () => schedule),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    backupRun: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn(async () => opts.existingRuns ?? []),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'run-new', ...data })),
    },
    user: { findMany: jest.fn().mockResolvedValue(USERS) },
    secret: { count: jest.fn().mockResolvedValue(0) },
    storageObject: { aggregate: jest.fn().mockResolvedValue({ _sum: { size: 0 } }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

  const storage = {
    getBucket: jest.fn(() => (opts.storageBucket === undefined ? 'bucket' : opts.storageBucket)),
    upload: jest.fn(async (key: string, stream: Readable) => {
      if (opts.upload) return opts.upload(key, stream);
      uploads[key] = await drain(stream);
      return { key };
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  // Stand-in for SecretsExportService: user A and C own secrets, B owns none.
  const exportService = {
    prepareUserPlan: jest.fn(async (owner: { id: string; email: string }) => ({
      owner,
      exportedAt: NOW,
      selection: { includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: false },
      secrets: {
        manifest: {
          counts: { secrets: owner.id === 'user-b-id' ? 0 : 2, attachments: owner.id === 'user-b-id' ? 0 : 1 },
          warnings: [],
        },
        files: [],
      },
      media: null,
    })),
    writeUserEntries: jest.fn(
      async (_plan: unknown, zipWriter: { add: (n: string, r: unknown) => Promise<unknown> }, userId: string, o: { prefix: string }) => {
        await zipWriter.add(`${o.prefix}secrets.json`, new TextReader(JSON.stringify({ owner: userId, note: 'vault data' })));
      },
    ),
  };

  // AiConfigService: whether an AI key is stored.
  const aiConfig = { isKeyConfigured: jest.fn(async () => false) };
  const systemSettings = {
    getSettings: jest.fn(async () => ({
      ui: { allowUserThemeOverride: true },
      features: {},
      ai: null,
      updatedAt: NOW,
      updatedBy: null,
      version: 1,
    })),
  };

  const archive = new BackupArchiveService(
    prisma as never,
    storage as never,
    exportService as never,
    systemSettings as never,
    aiConfig as never,
  );
  const runner = new BackupRunnerService(prisma as never, crypto, storage as never, archive, exportService as never);
  return { runner, prisma, storage, exportService, systemSettings, uploads };
}

describe('BackupRunnerService.execute (archive)', () => {
  async function runAndOpen() {
    const ctx = setup();
    await ctx.runner.execute(runRow());
    const bytes = ctx.uploads[KEY];
    expect(bytes).toBeDefined();
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)));
    const entries = await reader.getEntries();
    return { ...ctx, bytes, reader, entries };
  }

  it('uploads a zip, records success and the stats', async () => {
    const { prisma, storage } = await runAndOpen();
    expect(storage.upload).toHaveBeenCalledWith(KEY, expect.anything(), { mimeType: 'application/zip' });
    const update = prisma.backupRun.update.mock.calls.at(-1)![0];
    expect(update.where).toEqual({ id: 'run-new' });
    expect(update.data).toMatchObject({
      status: 'succeeded',
      userCount: 3,
      secretCount: 4,
      attachmentCount: 2,
      warningCount: 0,
      error: null,
    });
    expect(Number(update.data.sizeBytes)).toBeGreaterThan(0);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('writes every entry with AES-256 (never ZipCrypto)', async () => {
    const { entries, reader } = await runAndOpen();
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of entries) {
      if (entry.directory) continue;
      expect(entry.encrypted).toBe(true);
      expect(entry.zipCrypto).toBe(false);
      const aes = (entry as any).extraField?.get(0x9901);
      expect(aes).toBeDefined();
      // WinZip AE extra field: version(2) vendor(2) strength(1) method(2); 3 = AES-256.
      expect(Array.from(aes.data as Uint8Array)[4]).toBe(3);
    }
    await reader.close();
  });

  it('opens with the password and not with a wrong one', async () => {
    const { entries, reader } = await runAndOpen();
    const index = entries.find((e) => e.filename === 'index.json')!;
    const bytes = await (index as any).getData(new Uint8ArrayWriter(), { password: PASSWORD });
    expect(JSON.parse(Buffer.from(bytes).toString('utf8')).kind).toBe('system-backup');
    await expect(
      (index as any).getData(new Uint8ArrayWriter(), { password: 'not-the-password' }),
    ).rejects.toThrow();
    await expect(
      (index as any).getData(new Uint8ArrayWriter()),
    ).rejects.toThrow();
    await reader.close();
  });

  it('contains index.json, README.txt and users/NNNN/ folders with opaque names', async () => {
    const { entries, reader } = await runAndOpen();
    const names = entries.map((e) => e.filename).sort();
    expect(names).toEqual(['README.txt', 'index.json', 'users/0001/secrets.json', 'users/0002/secrets.json']);

    // Names are readable without the password: none may identify anyone.
    for (const name of names) {
      for (const user of USERS) {
        expect(name).not.toContain(user.id);
        expect(name.toLowerCase()).not.toContain(user.email.split('@')[0]);
      }
    }

    const index = entries.find((e) => e.filename === 'index.json')!;
    const parsed = JSON.parse(
      Buffer.from(await (index as any).getData(new Uint8ArrayWriter(), { password: PASSWORD })).toString('utf8'),
    );
    expect(parsed).toMatchObject({
      formatVersion: 1,
      kind: 'system-backup',
      counts: { users: 3, usersWithSecrets: 2, secrets: 4, attachments: 2 },
    });
    expect(parsed.users.map((u: any) => [u.email, u.folder])).toEqual([
      ['alice.person@example.test', 'users/0001'],
      ['bob.empty@example.test', null],
      ['carol.person@example.test', 'users/0002'],
    ]);
    await reader.close();
  });

  it('leaves no email, display name or password in the raw bytes', async () => {
    const { bytes, reader } = await runAndOpen();
    const raw = bytes.toString('latin1');
    for (const needle of [PASSWORD, ...USERS.map((u) => u.email), 'Alice Person', 'Carol Person', 'vault data', 'system-backup"']) {
      expect(raw).not.toContain(needle);
    }
    await reader.close();
  });

  it('never puts the password in logs, audit meta or the run row', async () => {
    const logs = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
    const { runner, prisma } = setup();
    await runner.execute(runRow());
    const everything = JSON.stringify(
      [
        logs.flatMap((s) => s.mock.calls),
        prisma.auditEvent.create.mock.calls,
        prisma.backupRun.update.mock.calls.map((c) => c[0].data),
      ],
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    );
    expect(everything).not.toContain(PASSWORD);
  });

  it('decrypts the password only inside the run and never stores it on the runner', async () => {
    const { runner } = setup();
    await runner.execute(runRow());
    expect(JSON.stringify(Object.values(runner as unknown as Record<string, unknown>).map(String))).not.toContain(PASSWORD);
  });
});

describe('BackupRunnerService.execute (failures)', () => {
  it('marks the run failed and deletes the partial object when the upload fails', async () => {
    const { runner, prisma, storage } = setup({
      upload: failingUpload('S3 exploded with sk-secret-token'),
    });
    await runner.execute(runRow());

    expect(storage.delete).toHaveBeenCalledWith(KEY);
    const update = prisma.backupRun.update.mock.calls.at(-1)![0];
    expect(update.data).toMatchObject({ status: 'failed', error: BACKUP_FAILURE_MESSAGES.upload });
    // The stored message is static: nothing from the storage SDK leaks into it.
    expect(update.data.error).not.toContain('sk-secret-token');
    expect(prisma.backupSchedule.updateMany).not.toHaveBeenCalled(); // lastRunAt untouched
    expect(prisma.auditEvent.create.mock.calls.at(-1)![0].data.meta).toMatchObject({ status: 'failed' });
  });

  it('does not apply retention after a failed run', async () => {
    const { runner, prisma, storage } = setup({
      upload: failingUpload('nope'),
      existingRuns: [
        { id: 'old', status: 'succeeded', startedAt: new Date('2026-01-01'), deletedAt: null, storageKey: 'system-backups/old.zip' },
      ],
    });
    await runner.execute(runRow());
    expect(prisma.backupRun.findMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalledWith('system-backups/old.zip');
  });

  it('still marks the run failed when the partial object cannot be deleted', async () => {
    const { runner, prisma, storage } = setup({
      upload: failingUpload('nope'),
    });
    storage.delete.mockRejectedValue(new Error('delete failed'));
    await runner.execute(runRow());
    expect(prisma.backupRun.update.mock.calls.at(-1)![0].data.status).toBe('failed');
  });

  it('fails without uploading when storage is not configured', async () => {
    const { runner, prisma, storage } = setup({ storageBucket: null });
    await runner.execute(runRow());
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.backupRun.update.mock.calls.at(-1)![0].data).toMatchObject({
      status: 'failed',
      error: BACKUP_FAILURE_MESSAGES.storageNotConfigured,
    });
  });

  it('fails without uploading when no password is stored', async () => {
    const { runner, prisma, storage } = setup({
      schedule: { id: BACKUP_SCHEDULE_ID, passwordEncrypted: null, includeAttachments: true, includeVersions: false },
    });
    await runner.execute(runRow());
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.backupRun.update.mock.calls.at(-1)![0].data.error).toBe(BACKUP_FAILURE_MESSAGES.noPassword);
  });

  it('fails with a static message when the stored password cannot be decrypted', async () => {
    const { runner, prisma, storage } = setup({
      schedule: { id: BACKUP_SCHEDULE_ID, passwordEncrypted: '{"ciphertext":"x","iv":"y","authTag":"z"}', includeAttachments: true, includeVersions: false },
    });
    await runner.execute(runRow());
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.backupRun.update.mock.calls.at(-1)![0].data.error).toBe(BACKUP_FAILURE_MESSAGES.passwordUnreadable);
  });

  it('marks the run failed and deletes the partial object when writing the archive fails', async () => {
    const ctx = setup();
    ctx.exportService.writeUserEntries.mockRejectedValue(new Error('decrypt blew up for alice.person@example.test'));
    await ctx.runner.execute(runRow());
    expect(ctx.storage.delete).toHaveBeenCalledWith(KEY);
    const data = ctx.prisma.backupRun.update.mock.calls.at(-1)![0].data;
    expect(data).toMatchObject({ status: 'failed', error: BACKUP_FAILURE_MESSAGES.archive });
    expect(data.error).not.toContain('alice');
  });
});

describe('BackupRunnerService retention', () => {
  const succeeded = (id: string, day: number) => ({
    id,
    status: 'succeeded',
    startedAt: new Date(Date.UTC(2026, 3, day)),
    deletedAt: null,
    storageKey: `system-backups/${id}.zip`,
  });

  it('deletes the older backups beyond keepCount and marks them deleted', async () => {
    const { runner, prisma, storage } = setup({
      schedule: { id: BACKUP_SCHEDULE_ID, keepCount: 2 },
      existingRuns: [succeeded('d', 4), succeeded('c', 3), succeeded('b', 2), succeeded('a', 1)],
    });
    await runner.applyRetention('d');
    expect(storage.delete.mock.calls.map((c) => c[0]).sort()).toEqual(['system-backups/a.zip', 'system-backups/b.zip']);
    expect(prisma.backupRun.update.mock.calls.map((c) => c[0].where.id).sort()).toEqual(['a', 'b']);
    for (const call of prisma.backupRun.update.mock.calls) {
      expect(call[0].data.deletedAt).toBeInstanceOf(Date);
    }
  });

  it('never deletes the run that was just written, even when it sorts as old', async () => {
    const { runner, prisma, storage } = setup({
      schedule: { id: BACKUP_SCHEDULE_ID, keepCount: 1 },
      // The just-written run has the OLDEST startedAt (clock skew / backfill).
      existingRuns: [succeeded('newer1', 10), succeeded('newer2', 9), succeeded('just', 1)],
    });
    await runner.applyRetention('just');
    const deletedKeys = storage.delete.mock.calls.map((c) => c[0]);
    expect(deletedKeys).not.toContain('system-backups/just.zip');
    expect(prisma.backupRun.update.mock.calls.map((c) => c[0].where.id)).not.toContain('just');
  });

  it('never deletes the just-written run even with keepCount 1 and many others', async () => {
    const { runner, storage } = setup({
      schedule: { id: BACKUP_SCHEDULE_ID, keepCount: 1 },
      existingRuns: [succeeded('just', 5), succeeded('b', 4), succeeded('a', 3)],
    });
    await runner.applyRetention('just');
    expect(storage.delete.mock.calls.map((c) => c[0]).sort()).toEqual(['system-backups/a.zip', 'system-backups/b.zip']);
  });

  it('runs after a successful execute and keeps the new run', async () => {
    const { runner, prisma, storage } = setup({
      schedule: {
        id: BACKUP_SCHEDULE_ID,
        keepCount: 1,
        includeAttachments: true,
        includeVersions: false,
        passwordEncrypted: encryptBackupPassword(crypto, PASSWORD),
      },
      existingRuns: [
        { id: 'run-new', status: 'succeeded', startedAt: NOW, deletedAt: null, storageKey: KEY },
        succeeded('old', 1),
      ],
    });
    await runner.execute(runRow());
    expect(storage.delete.mock.calls.map((c) => c[0])).toEqual(['system-backups/old.zip']);
    expect(prisma.backupRun.update.mock.calls.map((c) => c[0].where.id)).toContain('old');
    expect(prisma.backupRun.update.mock.calls.filter((c) => c[0].where.id === 'run-new').every((c) => !c[0].data.deletedAt)).toBe(true);
  });

  it('keeps going and does not throw when one object cannot be deleted', async () => {
    const { runner, prisma, storage } = setup({
      schedule: { id: BACKUP_SCHEDULE_ID, keepCount: 1 },
      existingRuns: [succeeded('c', 3), succeeded('b', 2), succeeded('a', 1)],
    });
    storage.delete.mockRejectedValueOnce(new Error('boom'));
    await expect(runner.applyRetention('c')).resolves.toBeUndefined();
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(prisma.backupRun.update).toHaveBeenCalledTimes(1);
  });

  it('does not fail the run when retention itself throws', async () => {
    const { runner, prisma } = setup();
    prisma.backupRun.findMany.mockRejectedValue(new Error('db down'));
    await expect(runner.applyRetention('x')).resolves.toBeUndefined();
  });
});
