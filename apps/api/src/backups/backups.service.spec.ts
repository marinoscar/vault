import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CryptoService } from '../common/services/crypto.service';
import {
  BACKUP_DOWNLOAD_URL_TTL_SECONDS,
  BACKUPS_AUDIT_ACTIONS,
  BackupsService,
  DEFAULT_BACKUP_SCHEDULE,
  ENABLE_WITHOUT_PASSWORD_MESSAGE,
  ENABLE_WITHOUT_STORAGE_MESSAGE,
} from './backups.service';
import { decryptBackupPassword } from './backup-password';
import { UpdateBackupScheduleInput } from './dto/update-backup-schedule.dto';

const PASSWORD = 'Sup3r-Secret-Backup-Pass';
const ACTOR = 'admin-1';

const crypto = new CryptoService({ get: () => 'a'.repeat(64) } as never);
crypto.onModuleInit();

const input = (over: Partial<UpdateBackupScheduleInput> = {}): UpdateBackupScheduleInput => ({
  enabled: false,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'UTC',
  keepCount: 7,
  includeAttachments: true,
  includeVersions: false,
  includeSecrets: true,
  includeMedia: false,
  includeSystem: false,
  ...over,
});

function makeService(opts: { schedule?: Record<string, unknown> | null; storage?: boolean } = {}) {
  let stored: Record<string, unknown> | null = opts.schedule ?? null;
  const prisma = {
    backupSchedule: {
      findUnique: jest.fn(async () => stored),
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        stored = { ...(stored ?? create), ...(stored ? update : {}), updatedAt: new Date('2026-05-01T12:00:00Z') };
        return stored;
      }),
    },
    backupRun: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const storageProvider = {
    getSignedDownloadUrl: jest.fn(async () => 'https://storage.example.test/signed'),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const runner = {
    isStorageConfigured: jest.fn(() => opts.storage ?? true),
    startRun: jest.fn(),
    launch: jest.fn(),
  };
  const service = new BackupsService(prisma as never, crypto, storageProvider as never, runner as never);
  return { service, prisma, storageProvider, runner, getStored: () => stored };
}

const succeededRun = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  status: 'succeeded',
  storageKey: 'system-backups/vault-backup-2026-05-01_030000.zip',
  deletedAt: null,
  ...over,
});

let logSpies: jest.SpyInstance[];
beforeEach(() => {
  logSpies = (['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const).map((m) =>
    jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
  );
});
afterEach(() => jest.restoreAllMocks());

describe('BackupsService.getSchedule', () => {
  it('returns the defaults when no row exists', async () => {
    const { service } = makeService();
    const result = await service.getSchedule();
    expect(result).toEqual({
      ...DEFAULT_BACKUP_SCHEDULE,
      passwordConfigured: false,
      passwordUpdatedAt: null,
      nextRunAt: null,
      lastRunAt: null,
      storageConfigured: true,
      updatedAt: null,
    });
    expect(result).toMatchObject({ enabled: false, frequency: 'daily', timeOfDay: '03:00', timezone: 'UTC', keepCount: 7 });
  });

  it('reports storageConfigured from the runner', async () => {
    const { service } = makeService({ storage: false });
    expect((await service.getSchedule()).storageConfigured).toBe(false);
  });

  it('reports passwordConfigured but never the password or its ciphertext', async () => {
    const { service } = makeService({
      schedule: {
        ...DEFAULT_BACKUP_SCHEDULE,
        passwordEncrypted: '{"ciphertext":"CIPHERTEXT-MARKER","iv":"x","authTag":"y"}',
        passwordUpdatedAt: new Date('2026-05-01T00:00:00Z'),
        nextRunAt: null,
        lastRunAt: null,
        updatedAt: null,
      },
    });
    const result = await service.getSchedule();
    expect(result.passwordConfigured).toBe(true);
    expect(result.passwordUpdatedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(JSON.stringify(result)).not.toContain('CIPHERTEXT-MARKER');
    expect(Object.keys(result)).not.toContain('passwordEncrypted');
    expect(Object.keys(result)).not.toContain('password');
  });
});

describe('BackupsService.updateSchedule', () => {
  it('never exposes the password in the response, logger calls or audit meta', async () => {
    const { service, prisma, getStored } = makeService();
    const response = await service.updateSchedule(input({ enabled: true, password: PASSWORD }), ACTOR);

    const ciphertext = (getStored()?.passwordEncrypted as string) ?? '';
    expect(ciphertext).not.toBe('');
    expect(ciphertext).not.toContain(PASSWORD);

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(ciphertext);
    expect(response.passwordConfigured).toBe(true);

    const auditMeta = JSON.stringify(prisma.auditEvent.create.mock.calls);
    expect(auditMeta).not.toContain(PASSWORD);
    expect(auditMeta).not.toContain(ciphertext);

    const logged = JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(ciphertext);
  });

  it('stores the password encrypted so the runner can decrypt it', async () => {
    const { service, getStored } = makeService();
    await service.updateSchedule(input({ enabled: true, password: PASSWORD }), ACTOR);
    expect(decryptBackupPassword(crypto, getStored()?.passwordEncrypted as string)).toBe(PASSWORD);
    expect(getStored()?.passwordUpdatedAt).toBeInstanceOf(Date);
  });

  it('audits the changed field names and passwordChanged only', async () => {
    const { service, prisma } = makeService();
    await service.updateSchedule(input({ keepCount: 14, password: PASSWORD }), ACTOR);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    const data = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actorUserId: ACTOR,
      action: BACKUPS_AUDIT_ACTIONS.scheduleUpdate,
      meta: { changedFields: ['keepCount'], passwordChanged: true },
    });
  });

  it('returns 400 when enabling without a password', async () => {
    const { service, prisma } = makeService();
    await expect(service.updateSchedule(input({ enabled: true }), ACTOR)).rejects.toThrow(
      new BadRequestException({ message: ENABLE_WITHOUT_PASSWORD_MESSAGE }),
    );
    expect(prisma.backupSchedule.upsert).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns 400 when enabling without configured storage', async () => {
    const { service, prisma } = makeService({ storage: false });
    let error: unknown;
    try {
      await service.updateSchedule(input({ enabled: true, password: PASSWORD }), ACTOR);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).toContain(ENABLE_WITHOUT_STORAGE_MESSAGE);
    expect(prisma.backupSchedule.upsert).not.toHaveBeenCalled();
  });

  it('allows saving a disabled schedule without a password or storage', async () => {
    const { service } = makeService({ storage: false });
    const response = await service.updateSchedule(input({ enabled: false }), ACTOR);
    expect(response.enabled).toBe(false);
    expect(response.nextRunAt).toBeNull();
  });

  it('allows enabling with a previously stored password when none is sent', async () => {
    const { service } = makeService({
      schedule: { ...DEFAULT_BACKUP_SCHEDULE, passwordEncrypted: 'stored', passwordUpdatedAt: new Date(0) },
    });
    const response = await service.updateSchedule(input({ enabled: true }), ACTOR);
    expect(response.enabled).toBe(true);
  });

  it('keeps the stored password when the password is omitted', async () => {
    const stored = JSON.stringify({ ciphertext: 'c', iv: 'i', authTag: 't' });
    const when = new Date('2026-01-01T00:00:00Z');
    const { service, prisma, getStored } = makeService({
      schedule: { ...DEFAULT_BACKUP_SCHEDULE, passwordEncrypted: stored, passwordUpdatedAt: when },
    });
    await service.updateSchedule(input({ enabled: true, keepCount: 3 }), ACTOR);

    const call = prisma.backupSchedule.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('passwordEncrypted');
    expect(call.update).not.toHaveProperty('passwordUpdatedAt');
    expect(getStored()?.passwordEncrypted).toBe(stored);
    expect(getStored()?.passwordUpdatedAt).toBe(when);
    expect(prisma.auditEvent.create.mock.calls[0][0].data.meta.passwordChanged).toBe(false);
  });

  it('replaces the stored password when a new one is sent', async () => {
    const { service, getStored } = makeService({
      schedule: { ...DEFAULT_BACKUP_SCHEDULE, passwordEncrypted: 'old', passwordUpdatedAt: new Date(0) },
    });
    await service.updateSchedule(input({ password: 'brand-new-pass' }), ACTOR);
    expect(decryptBackupPassword(crypto, getStored()?.passwordEncrypted as string)).toBe('brand-new-pass');
  });

  it('recomputes nextRunAt when enabled and clears it when disabled', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T10:00:00Z'));
    try {
      const { service, prisma } = makeService();
      const enabled = await service.updateSchedule(
        input({ enabled: true, frequency: 'daily', timeOfDay: '12:30', password: PASSWORD }),
        ACTOR,
      );
      expect(enabled.nextRunAt).toBe('2026-05-01T12:30:00.000Z');

      const moved = await service.updateSchedule(input({ enabled: true, frequency: 'daily', timeOfDay: '09:00' }), ACTOR);
      expect(moved.nextRunAt).toBe('2026-05-02T09:00:00.000Z');
      expect(prisma.backupSchedule.upsert.mock.calls[1][0].update.nextRunAt).toEqual(new Date('2026-05-02T09:00:00Z'));

      const disabled = await service.updateSchedule(input({ enabled: false }), ACTOR);
      expect(disabled.nextRunAt).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stores null for the day fields the frequency does not use', async () => {
    const { service, getStored } = makeService();
    await service.updateSchedule(
      input({ frequency: 'weekly', dayOfWeek: 2, intervalHours: 6, dayOfMonth: 9 }),
      ACTOR,
    );
    expect(getStored()).toMatchObject({ frequency: 'weekly', dayOfWeek: 2, intervalHours: null, dayOfMonth: null });
  });

  it('returns 503 with a static message when encryption is unavailable, without leaking the password', async () => {
    const { service } = makeService();
    jest.spyOn(crypto, 'encrypt').mockImplementationOnce(() => {
      throw new Error('Encryption key not configured');
    });
    let error: unknown;
    try {
      await service.updateSchedule(input({ password: PASSWORD }), ACTOR);
    } catch (e) {
      error = e;
    }
    expect((error as { getStatus(): number }).getStatus()).toBe(503);
    expect(JSON.stringify((error as { getResponse(): unknown }).getResponse())).not.toContain(PASSWORD);
    expect(JSON.stringify(logSpies.flatMap((s) => s.mock.calls))).not.toContain(PASSWORD);
  });
});

describe('BackupsService.runNow', () => {
  it('starts, audits and launches a manual run', async () => {
    const { service, runner, prisma } = makeService();
    const row = {
      id: 'run-9',
      status: 'running',
      trigger: 'manual',
      triggeredBy: null,
      startedAt: new Date('2026-05-01T00:00:00Z'),
      finishedAt: null,
      deletedAt: null,
      sizeBytes: null,
      userCount: 0,
      secretCount: 0,
      attachmentCount: 0,
      warningCount: 0,
      error: null,
    };
    runner.startRun.mockResolvedValue(row);
    const result = await service.runNow(ACTOR);
    expect(runner.startRun).toHaveBeenCalledWith('manual', ACTOR);
    expect(runner.launch).toHaveBeenCalledWith(row);
    expect(result).toMatchObject({ id: 'run-9', status: 'running', downloadable: false });
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: BACKUPS_AUDIT_ACTIONS.run });
  });

  it('propagates the 409 while a run is in progress and launches nothing', async () => {
    const { service, runner, prisma } = makeService();
    runner.startRun.mockRejectedValue(new ConflictException({ message: 'A backup is already running' }));
    await expect(service.runNow(ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(runner.launch).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('BackupsService.getDownload', () => {
  it('signs an attachment URL with an application/zip type', async () => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(succeededRun());
    const result = await service.getDownload('run-1', ACTOR);

    expect(storageProvider.getSignedDownloadUrl).toHaveBeenCalledWith(
      'system-backups/vault-backup-2026-05-01_030000.zip',
      {
        expiresIn: BACKUP_DOWNLOAD_URL_TTL_SECONDS,
        responseContentDisposition: 'attachment; filename="vault-backup-2026-05-01_030000.zip"',
        responseContentType: 'application/zip',
      },
    );
    expect(result.url).toBe('https://storage.example.test/signed');
    expect(result.fileName).toBe('vault-backup-2026-05-01_030000.zip');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      action: BACKUPS_AUDIT_ACTIONS.download,
      targetId: 'run-1',
    });
  });

  it.each([
    ['unknown', null],
    ['failed', succeededRun({ status: 'failed' })],
    ['running', succeededRun({ status: 'running' })],
    ['deleted', succeededRun({ deletedAt: new Date() })],
    ['without a storage key', succeededRun({ storageKey: null })],
  ])('returns 404 for a %s run and signs nothing', async (_label, row) => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(row);
    await expect(service.getDownload('run-1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(storageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('BackupsService.deleteRun', () => {
  it('returns 404 for an unknown run', async () => {
    const { service, prisma } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(null);
    await expect(service.deleteRun('x', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 409 while the run is running and touches nothing', async () => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(succeededRun({ status: 'running' }));
    await expect(service.deleteRun('run-1', ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(storageProvider.delete).not.toHaveBeenCalled();
    expect(prisma.backupRun.update).not.toHaveBeenCalled();
  });

  it('deletes the object, sets deletedAt and audits', async () => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(succeededRun());
    await service.deleteRun('run-1', ACTOR);
    expect(storageProvider.delete).toHaveBeenCalledWith('system-backups/vault-backup-2026-05-01_030000.zip');
    expect(prisma.backupRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: BACKUPS_AUDIT_ACTIONS.delete });
  });

  it('is a no-op the second time', async () => {
    const { service, prisma, storageProvider } = makeService();
    let row: Record<string, unknown> = succeededRun();
    prisma.backupRun.findUnique.mockImplementation(async () => row);
    prisma.backupRun.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      row = { ...row, ...data };
      return row;
    });

    await service.deleteRun('run-1', ACTOR);
    await expect(service.deleteRun('run-1', ACTOR)).resolves.toBeUndefined();

    expect(storageProvider.delete).toHaveBeenCalledTimes(1);
    expect(prisma.backupRun.update).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('also deletes a failed run that has no object without calling storage', async () => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(succeededRun({ status: 'failed', storageKey: null }));
    await service.deleteRun('run-1', ACTOR);
    expect(storageProvider.delete).not.toHaveBeenCalled();
    expect(prisma.backupRun.update).toHaveBeenCalled();
  });

  it('returns 502 and keeps the row when storage deletion fails', async () => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(succeededRun());
    storageProvider.delete.mockRejectedValue(new Error('bucket down'));
    await expect(service.deleteRun('run-1', ACTOR)).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.backupRun.update).not.toHaveBeenCalled();
  });
});

describe('BackupsService.listRuns', () => {
  it('pages newest first and reports totals', async () => {
    const { service, prisma } = makeService();
    prisma.backupRun.count.mockResolvedValue(45);
    const result = await service.listRuns({ page: 3, pageSize: 20 });
    expect(prisma.backupRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
    );
    expect(result).toMatchObject({ total: 45, page: 3, pageSize: 20, totalPages: 3, items: [] });
  });
});

describe('BackupsService content selection', () => {
  it('stores and returns includeSecrets / includeMedia / includeSystem and audits them as changed', async () => {
    const { service, prisma, getStored } = makeService();
    const response = await service.updateSchedule(
      input({ includeSecrets: false, includeAttachments: false, includeMedia: true, includeSystem: true }),
      ACTOR,
    );
    expect(getStored()).toMatchObject({ includeSecrets: false, includeMedia: true, includeSystem: true });
    expect(response).toMatchObject({
      includeSecrets: false,
      includeAttachments: false,
      includeMedia: true,
      includeSystem: true,
    });
    const meta = prisma.auditEvent.create.mock.calls[0][0].data.meta;
    expect(meta.changedFields).toEqual(
      expect.arrayContaining(['includeAttachments', 'includeSecrets', 'includeMedia', 'includeSystem']),
    );
  });

  it('defaults the new fields for a row saved before they existed', async () => {
    const { service } = makeService({
      schedule: {
        enabled: false,
        frequency: 'daily',
        intervalHours: null,
        timeOfDay: '03:00',
        dayOfWeek: null,
        dayOfMonth: null,
        timezone: 'UTC',
        keepCount: 7,
        includeAttachments: true,
        includeVersions: false,
        passwordEncrypted: null,
      },
    });
    expect(await service.getSchedule()).toMatchObject({ includeSecrets: true, includeMedia: false, includeSystem: false });
  });

  it('lists runs with mediaFileCount and contents (known keys, fixed order)', async () => {
    const { service, prisma } = makeService();
    prisma.backupRun.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: 'succeeded',
        trigger: 'manual',
        triggeredById: null,
        storageKey: 'system-backups/x.zip',
        sizeBytes: 10n,
        userCount: 1,
        secretCount: 0,
        attachmentCount: 0,
        mediaFileCount: 3,
        warningCount: 0,
        contents: ['system', 'media', 'bogus'],
        error: null,
        startedAt: new Date('2026-05-01T00:00:00Z'),
        finishedAt: null,
        deletedAt: null,
      },
    ]);
    prisma.backupRun.count.mockResolvedValue(1);
    const result = await service.listRuns({ page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ mediaFileCount: 3, contents: ['media', 'system'] });
  });
});

describe('BackupsService scope isolation', () => {
  const userRun = { id: 'user-run', scope: 'user', ownerId: 'u1', status: 'succeeded', storageKey: 'user-backups/u1/x.zip', deletedAt: null };

  it('lists system runs only', async () => {
    const { service, prisma } = makeService();
    await service.listRuns({ page: 1, pageSize: 20 });
    expect(prisma.backupRun.findMany.mock.calls[0][0].where).toEqual({ scope: 'system' });
    expect(prisma.backupRun.count.mock.calls[0][0]).toEqual({ where: { scope: 'system' } });
  });

  it("never downloads or deletes a user's saved backup", async () => {
    const { service, prisma, storageProvider } = makeService();
    prisma.backupRun.findUnique.mockResolvedValue(userRun);
    await expect(service.getDownload('user-run', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteRun('user-run', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(storageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(storageProvider.delete).not.toHaveBeenCalled();
  });
});

describe('BackupsService.exportNow', () => {
  const selection = {
    includeSecrets: true,
    includeAttachments: true,
    includeVersions: false,
    includeMedia: false,
    includeSystem: true,
  };
  const counts = { userCount: 2, secretCount: 5, attachmentCount: 1, mediaFileCount: 0, warningCount: 0 };

  function withExport(schedule?: Record<string, unknown> | null) {
    const ctx = makeService({ schedule });
    const stream = { fake: 'stream' };
    Object.assign(ctx.runner, {
      countSystemArchive: jest.fn(async () => counts),
      streamSystemArchive: jest.fn(async () => stream),
    });
    return { ...ctx, stream, runner: ctx.runner as typeof ctx.runner & Record<string, jest.Mock> };
  }

  it('streams with the given password and audits contents and counts without it', async () => {
    const { service, runner, prisma, stream } = withExport();
    const result = await service.exportNow({ password: PASSWORD, useScheduledPassword: false, selection }, ACTOR);

    expect(result).toMatchObject({ userCount: 2, secretCount: 5, attachmentCount: 1, mediaFileCount: 0, stream });
    expect(result.fileName).toMatch(/^vault-backup-\d{4}-\d{2}-\d{2}_\d{6}\.zip$/);
    expect(runner.streamSystemArchive.mock.calls[0][0]).toEqual(selection);
    expect(runner.streamSystemArchive.mock.calls[0][1]).toBe(PASSWORD);
    const audit = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      action: BACKUPS_AUDIT_ACTIONS.export,
      meta: {
        contents: ['secrets', 'attachments', 'system'],
        passwordSource: 'provided',
        counts: { users: 2, secrets: 5, attachments: 1, mediaFiles: 0 },
      },
    });
    expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(logSpies.flatMap((s) => s.mock.calls))).not.toContain(PASSWORD);
    expect(prisma.backupSchedule.upsert).not.toHaveBeenCalled();
  });

  it('useScheduledPassword decrypts the stored password for the stream only', async () => {
    const { service: setter, getStored } = makeService();
    await setter.updateSchedule(input({ password: PASSWORD }), ACTOR);
    const { service, runner, prisma } = withExport(getStored());

    await service.exportNow({ password: null, useScheduledPassword: true, selection }, ACTOR);
    expect(runner.streamSystemArchive.mock.calls[0][1]).toBe(PASSWORD);
    expect(prisma.auditEvent.create.mock.calls[0][0].data.meta.passwordSource).toBe('scheduled');
    expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain(PASSWORD);
  });

  it('400 when the scheduled password is asked for but none is stored', async () => {
    const { service, runner } = withExport(null);
    await expect(
      service.exportNow({ password: null, useScheduledPassword: true, selection }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runner.streamSystemArchive).not.toHaveBeenCalled();
  });
});
