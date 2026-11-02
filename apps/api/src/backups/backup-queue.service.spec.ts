import { ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';

import { CryptoService } from '../common/services/crypto.service';
import { BackupQueueService } from './backup-queue.service';
import { decryptBackupPassword } from './backup-password';
import {
  RUN_ALREADY_RUNNING_MESSAGE,
  USER_RUN_ALREADY_RUNNING_MESSAGE,
} from './backup-runner.service';
import { BACKUP_RUN_JOB_TYPE, USER_BACKUP_RUN_JOB_TYPE } from './jobs/backup-job-types';

const PASSWORD = 'Queue-Pass-0xD4E5';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SELECTION = { includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: false };

const crypto = new CryptoService({ get: () => 'a'.repeat(64) } as never);
beforeAll(() => {
  Logger.overrideLogger(false);
  crypto.onModuleInit();
});
afterEach(() => jest.restoreAllMocks());

/** The unique violation the queue's active-dedup index raises (driver-adapter shape). */
function dedupConflict() {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { driverAdapterError: { cause: { constraint: { index: 'jobs_active_dedup_uniq_idx' } } } },
  });
}

function setup(opts: { conflict?: boolean } = {}) {
  const tx = {
    backupRun: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'run-1', ...data })) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const jobs = {
    enqueueWithin: jest.fn(async () => {
      if (opts.conflict) throw dedupConflict();
      return { id: 'job-1' };
    }),
  };
  return { service: new BackupQueueService(prisma as never, crypto, jobs as never), tx, prisma, jobs };
}

describe('BackupQueueService.queueSystemRun', () => {
  it('writes the job and the running row in one transaction, linked by job_id', async () => {
    const { service, tx, jobs, prisma } = setup();
    const run = await service.queueSystemRun(ADMIN);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueWithin).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: BACKUP_RUN_JOB_TYPE, orgId: null, payload: { trigger: 'manual', triggeredById: ADMIN } }),
    );
    expect(tx.backupRun.create.mock.calls[0][0].data).toMatchObject({
      scope: 'system',
      status: 'running',
      trigger: 'manual',
      triggeredById: ADMIN,
      jobId: 'job-1',
    });
    expect(run.id).toBe('run-1');
  });

  it('is a 409 when the queue already holds an active system backup, and writes no row', async () => {
    const { service, tx } = setup({ conflict: true });
    const error = await service.queueSystemRun(ADMIN).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().message).toBe(RUN_ALREADY_RUNNING_MESSAGE);
    expect(tx.backupRun.create).not.toHaveBeenCalled();
  });

  it('does not turn another failure into a 409', async () => {
    const { service, jobs } = setup();
    jobs.enqueueWithin.mockRejectedValue(new Error('connection lost'));
    await expect(service.queueSystemRun(ADMIN)).rejects.toThrow('connection lost');
  });
});

describe('BackupQueueService.queueUserRun', () => {
  it('queues a user-subject job whose payload carries the password only as ciphertext', async () => {
    const { service, tx, jobs } = setup();
    await service.queueUserRun(OWNER, SELECTION, PASSWORD);

    const input = (jobs.enqueueWithin.mock.calls[0] as unknown[])[1] as Record<string, any>;
    expect(input).toMatchObject({
      type: USER_BACKUP_RUN_JOB_TYPE,
      orgId: null,
      subjectType: 'user',
      subjectId: OWNER,
    });
    expect(input.payload).toMatchObject({ ownerId: OWNER, selection: SELECTION });
    expect(JSON.stringify(input)).not.toContain(PASSWORD);
    // The ciphertext is real: the handler can get the password back, nothing else can.
    expect(decryptBackupPassword(crypto, input.payload.passwordEncrypted)).toBe(PASSWORD);

    const row = tx.backupRun.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ scope: 'user', ownerId: OWNER, jobId: 'job-1', contents: ['secrets', 'attachments'] });
    expect(JSON.stringify(tx.backupRun.create.mock.calls)).not.toContain(PASSWORD);
  });

  it("is a 409 with the user's message when that user already has an active backup job", async () => {
    const { service } = setup({ conflict: true });
    const error = await service.queueUserRun(OWNER, SELECTION, PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().message).toBe(USER_RUN_ALREADY_RUNNING_MESSAGE);
  });

  it('is a 503 and queues nothing when the password cannot be encrypted', async () => {
    const { service, jobs, prisma } = setup();
    jest.spyOn(crypto, 'encrypt').mockImplementation(() => {
      throw new Error('no key');
    });
    await expect(service.queueUserRun(OWNER, SELECTION, PASSWORD)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(jobs.enqueueWithin).not.toHaveBeenCalled();
  });
});
