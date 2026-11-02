import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isActiveDedupConflict, JobsService } from '@marinoscar/platform-api/jobs';
import type { JobsTx } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { selectedContentKeys, UserContentSelection } from '../secrets/export/backup-contents';
import { systemBackupStorageKey, userBackupStorageKey } from './backup-archive';
import { encryptBackupPassword } from './backup-password';
import {
  RUN_ALREADY_RUNNING_MESSAGE,
  SYSTEM_SCOPE,
  USER_RUN_ALREADY_RUNNING_MESSAGE,
  USER_SCOPE,
} from './backup-runner.service';
import { BACKUP_RUN_INCLUDE, BackupRunRow } from './dto/backup-responses';
import {
  BACKUP_RUN_JOB_TYPE,
  USER_BACKUP_RUN_JOB_TYPE,
  USER_BACKUP_SUBJECT_TYPE,
} from './jobs/backup-job-types';

/**
 * Queues backup runs for the routes (a scheduled run is queued by `BackupScheduleTask`).
 *
 * The `jobs` row and the `backup_runs` row are written in ONE transaction, so a run row never
 * exists for a job that was not created. The active-dedup index of the queue is the only
 * "is a backup already running" check: it answers a second system run (or a second run of the
 * same user) with a conflict, which rolls the whole transaction back and is reported as 409.
 */
@Injectable()
export class BackupQueueService {
  private readonly logger = new Logger(BackupQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Queue a manual system backup and return its `running` row (the job is pending until a
   * worker claims it).
   *
   * @throws ConflictException when a system backup is already queued or running.
   */
  async queueSystemRun(triggeredById: string): Promise<BackupRunRow> {
    const startedAt = new Date();
    try {
      return (await this.prisma.$transaction(async (tx) => {
        const job = await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
          type: BACKUP_RUN_JOB_TYPE,
          // `backfill`: the built-in reason closest to "work nobody uploaded"; the run row's
          // `trigger` says manual or schedule.
          reason: 'backfill',
          orgId: null,
          payload: { trigger: 'manual', triggeredById },
        });
        const runId = randomUUID();
        return tx.backupRun.create({
          data: {
            id: runId,
            scope: SYSTEM_SCOPE,
            status: 'running',
            trigger: 'manual',
            triggeredById,
            storageKey: systemBackupStorageKey(startedAt, runId),
            startedAt,
            jobId: job.id,
          },
          include: BACKUP_RUN_INCLUDE,
        });
      })) as unknown as BackupRunRow;
    } catch (error) {
      if (isActiveDedupConflict(error)) {
        throw new ConflictException({ message: RUN_ALREADY_RUNNING_MESSAGE });
      }
      throw error;
    }
  }

  /**
   * Queue a user-saved backup for `ownerId`. The archive password goes into the job payload
   * ONLY as `CryptoService` ciphertext; the handler decrypts it in memory and removes it from
   * the row when the run settles.
   *
   * @throws ConflictException when this user already has a backup queued or running.
   * @throws ServiceUnavailableException when the password cannot be encrypted (no key).
   */
  async queueUserRun(
    ownerId: string,
    selection: UserContentSelection,
    password: string,
  ): Promise<BackupRunRow> {
    let passwordEncrypted: string;
    try {
      passwordEncrypted = encryptBackupPassword(this.crypto, password);
    } catch (error) {
      this.logger.error(`Failed to encrypt the backup password: ${(error as Error)?.message}`);
      throw new ServiceUnavailableException({
        code: 'ENCRYPTION_UNAVAILABLE',
        message:
          'Encryption is not available, so the backup could not be started. Check that VAULT_ENCRYPTION_KEY is configured.',
      });
    }

    const startedAt = new Date();
    try {
      return (await this.prisma.$transaction(async (tx) => {
        const job = await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
          type: USER_BACKUP_RUN_JOB_TYPE,
          reason: 'backfill',
          orgId: null,
          subjectType: USER_BACKUP_SUBJECT_TYPE,
          subjectId: ownerId,
          payload: { ownerId, selection: { ...selection }, passwordEncrypted },
        });
        const runId = randomUUID();
        return tx.backupRun.create({
          data: {
            id: runId,
            scope: USER_SCOPE,
            ownerId,
            status: 'running',
            trigger: 'manual',
            triggeredById: ownerId,
            storageKey: userBackupStorageKey(ownerId, startedAt, runId),
            startedAt,
            contents: selectedContentKeys(selection),
            jobId: job.id,
          },
          include: BACKUP_RUN_INCLUDE,
        });
      })) as unknown as BackupRunRow;
    } catch (error) {
      if (isActiveDedupConflict(error)) {
        throw new ConflictException({ message: USER_RUN_ALREADY_RUNNING_MESSAGE });
      }
      throw error;
    }
  }
}
