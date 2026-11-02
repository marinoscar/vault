import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import type { Job, JobHandler } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { decryptBackupPassword } from '../backup-password';
import {
  BACKUP_FAILURE_MESSAGES,
  BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
  BackupRunnerService,
} from '../backup-runner.service';
import {
  BACKUP_JOB_PROFILE,
  USER_BACKUP_RUN_JOB_TYPE,
  userBackupPayloadSchema,
} from './backup-job-types';

/**
 * `vault.user_backup.run`: one user's "My backups" run (`subjectType: 'user'`).
 *
 * The archive password reaches this handler only as `CryptoService` ciphertext in
 * `jobs.payload`. It is decrypted in memory for the run, never logged and never put on an
 * error, and the ciphertext is removed from the row when the run settles (success or failure).
 *
 * Server-only on purpose: no `nodeResultSchema` / `persistNodeResult`.
 */
@Injectable()
export class UserBackupRunHandler implements JobHandler, OnModuleInit {
  readonly type = USER_BACKUP_RUN_JOB_TYPE;
  readonly label = 'My backup';
  readonly profile = BACKUP_JOB_PROFILE;
  private readonly logger = new Logger(UserBackupRunHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: BackupRunnerService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    try {
      await this.run(job);
    } finally {
      await this.scrubPassword(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const payload = userBackupPayloadSchema.safeParse(job.payload);
    if (!payload.success) {
      throw new Error('The backup job payload is not valid');
    }
    const { ownerId, selection, passwordEncrypted } = payload.data;

    const run = await this.runner.runForUserJob(job);
    if (!run) {
      throw new Error('The backup run of this job does not exist');
    }
    if (run.status !== 'running') {
      this.logger.warn(`Backup run ${run.id} already ${run.status}; job ${job.id} has nothing to do`);
      return;
    }

    if (!passwordEncrypted) {
      // Only a re-run after the ciphertext was removed gets here; the run cannot be redone.
      const outcome = await this.runner.failRun(
        run,
        BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
        BACKUP_FAILURE_MESSAGES.unknown,
      );
      throw new Error(outcome.status === 'failed' ? outcome.error : BACKUP_FAILURE_MESSAGES.unknown);
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, email: true },
    });
    if (!owner) {
      const outcome = await this.runner.failRun(
        run,
        BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
        BACKUP_FAILURE_MESSAGES.unknown,
      );
      throw new Error(outcome.status === 'failed' ? outcome.error : BACKUP_FAILURE_MESSAGES.unknown);
    }

    let password: string;
    try {
      password = decryptBackupPassword(this.crypto, passwordEncrypted);
    } catch {
      await this.runner.failRun(
        run,
        BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
        BACKUP_FAILURE_MESSAGES.passwordUnreadable,
      );
      throw new Error(BACKUP_FAILURE_MESSAGES.passwordUnreadable);
    }

    const outcome = await this.runner.executeUserRun(run, owner, selection, password);
    if (outcome.status === 'failed') {
      throw new Error(outcome.error);
    }
  }

  /** Removes the password ciphertext from the job row. Best effort: never fails the job. */
  private async scrubPassword(job: Job): Promise<void> {
    try {
      const { passwordEncrypted: _removed, ...rest } = (job.payload ?? {}) as Record<string, unknown>;
      await this.prisma.job.update({ where: { id: job.id }, data: { payload: rest as never } });
    } catch (error) {
      this.logger.warn(
        `Job ${job.id}: the password ciphertext could not be removed from the payload: ${(error as Error)?.message}`,
      );
    }
  }
}
