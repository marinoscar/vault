import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

import { PrismaService } from '../../prisma/prisma.service';

// =============================================================================
// Doctor check: the scheduled backup (issue #76, epic #54)
// =============================================================================
//
// Reports whether the admin's backup schedule is doing its job:
//
//   skip  the schedule is off (an operator's choice, nothing to fix);
//   fail  the last scheduled run failed;
//   warn  the last run is older than two schedule periods (the API was down, or
//         the runner is stuck), a run has been "running" for hours, or the
//         schedule is on but never ran although it is overdue;
//   pass  otherwise.
//
// READ-ONLY: two `SELECT`s (`backup_schedules`, the latest `backup_runs` row of
// scope `system` and trigger `schedule`). It never starts a run, never touches
// storage and never reads the archive password. The run's `error` text is not
// echoed: the report says WHEN it failed and points at the admin page.
// =============================================================================

export const BACKUP_SCHEDULE_CHECK_ID = 'vault.backup_schedule';

const HOUR_MS = 60 * 60 * 1000;
/** A run that has been `running` this long without finishing is considered stuck. */
const STUCK_RUN_MS = 6 * HOUR_MS;
/** How late a never-run schedule may be before it is reported. */
const FIRST_RUN_GRACE_MS = HOUR_MS;

export interface BackupScheduleFacts {
  enabled: boolean;
  frequency: string;
  intervalHours: number | null;
  nextRunAt: Date | null;
}

export interface LastScheduledRun {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
}

/** One schedule period in milliseconds (a month counts as 31 days). */
export function schedulePeriodMs(schedule: Pick<BackupScheduleFacts, 'frequency' | 'intervalHours'>): number {
  switch (schedule.frequency) {
    case 'hourly':
      return Math.max(1, schedule.intervalHours ?? 1) * HOUR_MS;
    case 'weekly':
      return 7 * 24 * HOUR_MS;
    case 'monthly':
      return 31 * 24 * HOUR_MS;
    case 'daily':
    default:
      return 24 * HOUR_MS;
  }
}

/** The rule, separated from the queries so a test can drive it without a database. */
export function decideBackupSchedule(
  schedule: BackupScheduleFacts | null,
  last: LastScheduledRun | null,
  now: Date,
): DoctorCheckOutcome {
  if (!schedule || !schedule.enabled) {
    return { status: 'skip', detail: 'Scheduled backups are off', data: { enabled: false } };
  }

  const period = schedulePeriodMs(schedule);
  const base = { enabled: true, frequency: schedule.frequency };

  if (!last) {
    if (schedule.nextRunAt && now.getTime() - schedule.nextRunAt.getTime() > FIRST_RUN_GRACE_MS) {
      return {
        status: 'warn',
        detail: 'The backup schedule is on but no scheduled run has happened, and the first one is overdue',
        remedy: 'Check that the API is running, then open Admin > Backups and run a backup now',
        data: { ...base, lastRun: 'none' },
      };
    }
    return {
      status: 'pass',
      detail: 'The backup schedule is on; the first scheduled run has not been due yet',
      data: { ...base, lastRun: 'none' },
    };
  }

  if (last.status === 'failed') {
    return {
      status: 'fail',
      detail: `The last scheduled backup failed (started ${last.startedAt.toISOString()})`,
      remedy: 'Open Admin > Backups, read the failed run, fix the cause (storage, password, key) and run a backup now',
      data: { ...base, lastRun: 'failed', lastStartedAt: last.startedAt.toISOString() },
    };
  }

  if (last.status === 'running') {
    if (now.getTime() - last.startedAt.getTime() > STUCK_RUN_MS) {
      return {
        status: 'warn',
        detail: `A scheduled backup has been running since ${last.startedAt.toISOString()}`,
        remedy: 'Check the API logs; the runner marks a run with no heartbeat as failed on the next start',
        data: { ...base, lastRun: 'running', lastStartedAt: last.startedAt.toISOString() },
      };
    }
    return {
      status: 'pass',
      detail: 'A scheduled backup is running',
      data: { ...base, lastRun: 'running', lastStartedAt: last.startedAt.toISOString() },
    };
  }

  const finished = last.finishedAt ?? last.startedAt;
  if (now.getTime() - finished.getTime() > 2 * period) {
    return {
      status: 'warn',
      detail: `The last scheduled backup is older than two schedule periods (finished ${finished.toISOString()})`,
      remedy: 'Check that the API has been running and that the schedule in Admin > Backups is correct',
      data: { ...base, lastRun: last.status, lastFinishedAt: finished.toISOString() },
    };
  }

  return {
    status: 'pass',
    detail: `The last scheduled backup succeeded (finished ${finished.toISOString()})`,
    data: { ...base, lastRun: last.status, lastFinishedAt: finished.toISOString() },
  };
}

@Injectable()
export class VaultBackupScheduleDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = BACKUP_SCHEDULE_CHECK_ID;
  readonly category = 'backup';
  readonly label = 'Scheduled backup';
  readonly dependsOn = ['db.connection'] as const;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const schedule = await this.prisma.backupSchedule.findUnique({
      where: { id: 'default' },
      select: { enabled: true, frequency: true, intervalHours: true, nextRunAt: true },
    });
    if (!schedule?.enabled) {
      return decideBackupSchedule(null, null, new Date());
    }

    const last = await this.prisma.backupRun.findFirst({
      where: { scope: 'system', trigger: 'schedule', deletedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { status: true, startedAt: true, finishedAt: true },
    });

    return decideBackupSchedule(schedule, last, new Date());
  }
}
