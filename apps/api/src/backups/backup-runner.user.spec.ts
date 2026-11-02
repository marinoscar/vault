import { defaultOrgMock } from '../../test/mocks/default-org.mock';
import { Readable } from 'stream';
import { inspect } from 'util';

import { Logger } from '@nestjs/common';
import { FileEntry, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { CryptoService } from '../common/services/crypto.service';
import { SecretsExportService } from '../secrets/export/secrets-export.service';
import {
  BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
  BackupRunnerService,
  USER_BACKUP_KEEP_COUNT,
} from './backup-runner.service';
import { BackupArchiveService } from './backup-archive.service';
import type { BackupRunRow } from './dto/backup-responses';

const PASSWORD = 'User-Only-Pass-77';
const NOW = new Date('2026-07-01T08:09:10Z');
const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'person.a@example.test' };
const KEY = `user-backups/${OWNER.id}/vault-backup-2026-07-01_080910.zip`;
const SELECTION = { includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: false };

const crypto = new CryptoService({ get: () => 'f'.repeat(64) } as never);
beforeAll(() => crypto.onModuleInit());

let logged: unknown[][];
beforeEach(() => {
  logged = [];
  for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }
});
afterEach(() => jest.restoreAllMocks());

function setup(opts: { runs?: Array<Record<string, unknown>> } = {}) {
  const uploads: Record<string, Buffer> = {};
  const enc = crypto.encrypt(JSON.stringify({ user: 'alpha-login' }));
  const prisma = {
    ...defaultOrgMock(),
    backupSchedule: { findUnique: jest.fn(), updateMany: jest.fn() },
    backupRun: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn(async (_args: { where: unknown }) => opts.runs ?? []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'run-u1', ...data })),
    },
    secret: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 's1',
          name: 'Alpha Login',
          description: null,
          createdAt: NOW,
          updatedAt: NOW,
          type: { id: 't', name: 'Login', fields: [{ name: 'user', label: 'User', type: 'string' }] },
          versions: [
            { id: 'v1', version: 1, encryptedData: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, createdAt: NOW, isCurrent: true },
          ],
          attachments: [],
        },
      ]),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const storage = {
    getBucket: jest.fn(() => 'bucket'),
    exists: jest.fn(async () => true),
    download: jest.fn(async () => Readable.from([Buffer.from('x')])),
    upload: jest.fn(async (key: string, stream: Readable) => {
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c));
      uploads[key] = Buffer.concat(chunks);
      return { key };
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const exportService = new SecretsExportService(prisma as never, crypto, storage as never);
  const archive = new BackupArchiveService(prisma as never, storage as never, exportService, {} as never, {} as never);
  const runner = new BackupRunnerService(prisma as never, crypto, storage as never, archive, exportService);
  return { runner, prisma, storage, uploads };
}

const userRun = (): BackupRunRow =>
  ({
    id: 'run-u1',
    scope: 'user',
    ownerId: OWNER.id,
    status: 'running',
    trigger: 'manual',
    triggeredById: OWNER.id,
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
  }) as BackupRunRow;

describe('BackupRunnerService user-saved runs', () => {
  it('writes the user zip to the user key, readable with the password', async () => {
    const { runner, prisma, uploads } = setup();
    await runner.executeUserRun(userRun(), OWNER, SELECTION, PASSWORD);

    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(uploads[KEY])));
    const entries = await reader.getEntries();
    expect(entries.map((e) => e.filename).sort()).toEqual(['README.txt', 'secrets.html', 'secrets.json']);
    const json = entries.find((e) => e.filename === 'secrets.json') as FileEntry;
    const text = Buffer.from(await json.getData(new Uint8ArrayWriter(), { password: PASSWORD })).toString('utf8');
    expect(JSON.parse(text).owner.id).toBe(OWNER.id);
    await reader.close();

    const data = prisma.backupRun.update.mock.calls.at(-1)![0].data;
    expect(data).toMatchObject({ status: 'succeeded', storageKey: KEY, userCount: 1, secretCount: 1 });
    const audit = prisma.auditEvent.create.mock.calls.at(-1)![0].data;
    expect(audit.action).toBe(BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION);
    expect(prisma.backupSchedule.updateMany).not.toHaveBeenCalled(); // no lastRunAt for a user run
  });

  it('never persists, logs or audits the password', async () => {
    const { runner, prisma, uploads } = setup();
    const run = userRun();
    await runner.executeUserRun(run, OWNER, SELECTION, PASSWORD);

    const writes = JSON.stringify(
      [prisma.backupRun.create, prisma.backupRun.update, prisma.backupRun.updateMany, prisma.auditEvent.create].map(
        (m) => m.mock.calls,
      ),
      (_k, v) => (typeof v === 'bigint' ? String(v) : v),
    );
    expect(writes).not.toContain(PASSWORD);
    expect(JSON.stringify(logged)).not.toContain(PASSWORD);
    expect(uploads[run.storageKey as string].includes(Buffer.from(PASSWORD))).toBe(false);
    // Not kept on the service instance either.
    expect(inspect(runner, { depth: 1 })).not.toContain(PASSWORD);
  });

  it('a failed user run stores a static message, never the password', async () => {
    const { runner, prisma, storage } = setup();
    storage.upload.mockImplementation(async (_k: string, stream: Readable) => {
      stream.on('error', () => undefined);
      stream.resume();
      throw new Error(`upload failed with ${PASSWORD}`);
    });
    await runner.executeUserRun(userRun(), OWNER, SELECTION, PASSWORD);
    const data = prisma.backupRun.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe('failed');
    expect(JSON.stringify(data)).not.toContain(PASSWORD);
    expect(storage.delete).toHaveBeenCalledWith(KEY);
  });

  it(`retention keeps the newest ${USER_BACKUP_KEEP_COUNT} of that user only`, async () => {
    const runs = Array.from({ length: 13 }, (_, i) => ({
      id: `r${i}`,
      status: 'succeeded',
      startedAt: new Date(Date.UTC(2026, 0, 1 + i)),
      deletedAt: null,
      storageKey: `user-backups/${OWNER.id}/r${i}.zip`,
    }));
    const { runner, prisma, storage } = setup({ runs });
    await runner.applyUserRetention(OWNER.id, 'r12');

    expect(prisma.backupRun.findMany.mock.calls[0][0].where).toMatchObject({
      scope: 'user',
      ownerId: OWNER.id,
      status: 'succeeded',
      deletedAt: null,
    });
    expect(storage.delete.mock.calls.map((c) => c[0]).sort()).toEqual([
      `user-backups/${OWNER.id}/r0.zip`,
      `user-backups/${OWNER.id}/r1.zip`,
      `user-backups/${OWNER.id}/r2.zip`,
    ]);
  });

  it('system retention only considers system runs', async () => {
    const { runner, prisma } = setup();
    prisma.backupSchedule.findUnique.mockResolvedValue({ keepCount: 7 });
    await runner.applyRetention('x');
    expect(prisma.backupRun.findMany.mock.calls[0][0].where).toMatchObject({ scope: 'system' });
  });
});
