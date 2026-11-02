import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import type { Job, JobHandler } from '@marinoscar/platform-api/jobs';

import { BackupRunnerService } from '../backup-runner.service';
import { BACKUP_JOB_PROFILE, BACKUP_RUN_JOB_TYPE } from './backup-job-types';

/**
 * `vault.backup.run`: one scheduled or manual system backup (system job, `orgId` null).
 *
 * Server-only on purpose (no `nodeResultSchema` / `persistNodeResult`): the scheduled archive
 * password and the secrets it protects never leave this process. Fails the job when the run
 * fails, with the run's static message as `lastError`.
 */
@Injectable()
export class BackupRunHandler implements JobHandler, OnModuleInit {
  readonly type = BACKUP_RUN_JOB_TYPE;
  readonly label = 'Secrets backup';
  readonly profile = BACKUP_JOB_PROFILE;
  private readonly logger = new Logger(BackupRunHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: BackupRunnerService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const run = await this.runner.runForSystemJob(job);
    if (run.status !== 'running') {
      // The job ran before (a reclaimed lease) and its run already settled: never write twice.
      this.logger.warn(`Backup run ${run.id} already ${run.status}; job ${job.id} has nothing to do`);
      return;
    }
    const outcome = await this.runner.execute(run);
    if (outcome.status === 'failed') {
      throw new Error(outcome.error);
    }
  }
}
