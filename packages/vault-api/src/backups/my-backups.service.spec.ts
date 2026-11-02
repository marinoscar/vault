import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';

import { MY_BACKUPS_AUDIT_ACTIONS, MyBackupsService, USER_STORAGE_NOT_CONFIGURED_MESSAGE } from './my-backups.service';
import { auditOverPrisma } from '../testing';

const A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'person.a@example.test' };
const B = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'person.b@example.test' };
const PASSWORD = 'never-store-me-123';

const row = (id: string, over: Record<string, unknown>) => ({
  id,
  scope: 'user',
  ownerId: A.id,
  status: 'succeeded',
  trigger: 'manual',
  triggeredById: A.id,
  storageKey: `user-backups/${A.id}/${id}.zip`,
  sizeBytes: 10n,
  userCount: 1,
  secretCount: 1,
  attachmentCount: 0,
  mediaFileCount: 0,
  warningCount: 0,
  contents: ['secrets'],
  error: null,
  startedAt: new Date('2026-07-01T00:00:00Z'),
  finishedAt: null,
  deletedAt: null,
  ...over,
});

/** A tiny in-memory table: findFirst/findMany honour the where clause like Postgres would. */
const ROWS = [
  row('a-run', {}),
  row('b-run', { ownerId: B.id, triggeredById: B.id, storageKey: `user-backups/${B.id}/b-run.zip` }),
  row('sys-run', { scope: 'system', ownerId: null, storageKey: 'system-backups/s.zip' }),
];
const matches = (r: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => r[k] === v);

function makeService(opts: { storage?: boolean } = {}) {
  const prisma = {
    backupRun: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ROWS.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ROWS.filter((r) => matches(r, where))),
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ROWS.filter((r) => matches(r, where)).length),
      update: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const storage = {
    getSignedDownloadUrl: jest.fn(async () => 'https://storage.example.test/signed'),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const archive = { isStorageConfigured: jest.fn(() => opts.storage ?? true) };
  const queue = {
    queueUserRun: jest.fn(async (ownerId: string) => row('new-run', { ownerId, status: 'running', storageKey: 'k' })),
  };
  const service = new MyBackupsService(prisma as never, storage as never, archive as never, queue as never, auditOverPrisma(prisma));
  return { service, prisma, storage, runner: queue };
}

let logs: jest.SpyInstance[];
beforeEach(() => {
  logs = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
    jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
  );
});
afterEach(() => jest.restoreAllMocks());

describe('MyBackupsService ownership isolation', () => {
  it("lists only the caller's own user-saved runs", async () => {
    const { service, prisma } = makeService();
    const result = await service.listRuns(A.id, { page: 1, pageSize: 20 });
    expect(result.items.map((r) => r.id)).toEqual(['a-run']);
    expect(result.total).toBe(1);
    expect(prisma.backupRun.findMany.mock.calls[0][0].where).toEqual({ scope: 'user', ownerId: A.id });
  });

  it("answers 404 for another user's backup on download and delete, touching nothing", async () => {
    const { service, storage, prisma } = makeService();
    await expect(service.getDownload('b-run', A.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteRun('b-run', A.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.backupRun.update).not.toHaveBeenCalled();
  });

  it('answers 404 for a system backup id', async () => {
    const { service } = makeService();
    await expect(service.getDownload('sys-run', A.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteRun('sys-run', A.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('downloads and deletes the caller\'s own backup', async () => {
    const { service, storage, prisma } = makeService();
    const link = await service.getDownload('a-run', A.id);
    expect(link.fileName).toBe('a-run.zip');
    expect(storage.getSignedDownloadUrl.mock.calls[0]).toEqual([
      `user-backups/${A.id}/a-run.zip`,
      expect.objectContaining({ responseContentDisposition: 'attachment; filename="a-run.zip"' }),
    ]);
    await service.deleteRun('a-run', A.id);
    expect(storage.delete).toHaveBeenCalledWith(`user-backups/${A.id}/a-run.zip`);
    expect(prisma.auditEvent.create.mock.calls.map((c) => c[0].data.action)).toEqual([
      MY_BACKUPS_AUDIT_ACTIONS.download,
      MY_BACKUPS_AUDIT_ACTIONS.delete,
    ]);
  });
});

describe('MyBackupsService.runNow', () => {
  const options = {
    password: PASSWORD,
    includeSecrets: true,
    includeAttachments: true,
    includeVersions: false,
    includeMedia: true,
  };

  it('400 with the spec message when storage is not configured', async () => {
    const { service, runner } = makeService({ storage: false });
    const error = await service.runNow(A, options).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().message).toBe(
      "Saving to storage isn't set up. Ask an administrator, or download the backup instead.",
    );
    expect(error.getResponse().message).toBe(USER_STORAGE_NOT_CONFIGURED_MESSAGE);
    expect(runner.queueUserRun).not.toHaveBeenCalled();
  });

  it('propagates the per-user 409', async () => {
    const { service, runner } = makeService();
    runner.queueUserRun.mockRejectedValue(new ConflictException({ message: 'You already have a backup running' }));
    await expect(service.runNow(A, options)).rejects.toBeInstanceOf(ConflictException);
  });

  it('hands the password to the queue (which encrypts it into the job payload): not to the audit, a log or the response', async () => {
    const { service, runner, prisma } = makeService();
    const response = await service.runNow(A, options);

    expect(runner.queueUserRun).toHaveBeenCalledWith(
      A.id,
      { includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: true },
      PASSWORD,
    );
    const audit = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: MY_BACKUPS_AUDIT_ACTIONS.run, meta: { contents: ['secrets', 'attachments', 'media'] } });
    expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(PASSWORD);
    expect(JSON.stringify(response, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(PASSWORD);
  });

  it('config reports storage and keepCount 10', () => {
    expect(makeService({ storage: false }).service.getConfig()).toEqual({ storageConfigured: false, keepCount: 10 });
  });
});
