import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HOUSEKEEPING_PRIORITY } from '@marinoscar/platform-api/jobs';


import { BACKUP_SCHEDULE_ID } from './backup-runner.service';
import { computeNextRunAt } from './backup-schedule';
import { describeError } from './backup-archive.service';
import { BACKUP_RUN_JOB_TYPE } from './jobs/backup-job-types';
import { VAULT_JOBS, VAULT_PRISMA, type VaultJobsPort, type VaultPrismaClient } from '../ports';

/** A claimed schedule slot: what to restore if the job cannot be queued. */
export interface ClaimedSlot {
  previous: Date;
  following: Date | null;
}

/**
 * The minute tick of the scheduled system backup. ENQUEUE-ONLY (queue rule 1): it decides
 * whether the schedule is due, claims the slot and queues a `vault.backup.run` job; the
 * work is the handler's.
 *
 * Multi-instance safety: the slot is claimed with a compare-and-set on `next_run_at`
 * (`updateMany where next_run_at = <value read>`), so exactly one instance moves it to the
 * following slot; the others update 0 rows and stop. The claim moves `next_run_at` past
 * `now` (not past the old value), so an API that was down for days runs once and resumes.
 * A run already queued or running collapses a second enqueue (the active-dedup key), so a
 * scheduled run never overlaps a manual one.
 */
@Injectable()
export class BackupScheduleTask {
  private readonly logger = new Logger(BackupScheduleTask.name);

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_JOBS) private readonly jobs: VaultJobsPort,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick(): Promise<void> {
    let slot: ClaimedSlot | null = null;
    try {
      slot = await this.claimDueSlot(new Date());
      if (!slot) {
        return;
      }
      await this.jobs.enqueue({
        type: BACKUP_RUN_JOB_TYPE,
        reason: 'backfill',
        orgId: null,
        priority: HOUSEKEEPING_PRIORITY,
        payload: { trigger: 'schedule' },
      });
    } catch (error) {
      this.logger.error(`Backup schedule check failed: ${describeError(error)}`);
      await this.releaseSlot(slot);
    }
  }

  /**
   * If the schedule is enabled and due, move `next_run_at` to the following slot.
   *
   * @returns the claimed slot, or `null` when nothing was due or another instance won it.
   */
  async claimDueSlot(now: Date): Promise<ClaimedSlot | null> {
    const schedule = await this.prisma.backupSchedule.findUnique({
      where: { id: BACKUP_SCHEDULE_ID },
    });
    if (!schedule || !schedule.enabled || !schedule.nextRunAt || schedule.nextRunAt > now) {
      return null;
    }

    let following: Date | null = null;
    try {
      following = computeNextRunAt(schedule, now);
    } catch (error) {
      // An invalid stored schedule must not re-fire every minute: clear the
      // slot (it is recomputed on the next save) and still run this one.
      this.logger.error(`Backup schedule is invalid, next run cleared: ${describeError(error)}`);
    }

    const claim = await this.prisma.backupSchedule.updateMany({
      where: { id: BACKUP_SCHEDULE_ID, enabled: true, nextRunAt: schedule.nextRunAt },
      data: { nextRunAt: following },
    });
    return claim.count === 1 ? { previous: schedule.nextRunAt, following } : null;
  }

  /** Puts a claimed slot back when its job could not be queued, so the next tick retries it. */
  async releaseSlot(slot: ClaimedSlot | null): Promise<void> {
    if (!slot) {
      return;
    }
    try {
      await this.prisma.backupSchedule.updateMany({
        where: { id: BACKUP_SCHEDULE_ID, nextRunAt: slot.following },
        data: { nextRunAt: slot.previous },
      });
    } catch (error) {
      this.logger.error(`Backup schedule slot could not be released: ${describeError(error)}`);
    }
  }
}
