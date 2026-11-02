import { Logger } from '@nestjs/common';

import { BACKUP_SCHEDULE_ID } from './backup-runner.service';
import { BackupScheduleTask } from './backup-schedule.task';
import { BACKUP_RUN_JOB_TYPE } from './jobs/backup-job-types';

const NOW = new Date('2026-05-01T12:00:00Z');
const SLOT = new Date('2026-05-01T03:00:00Z');

beforeAll(() => Logger.overrideLogger(false));
afterEach(() => jest.restoreAllMocks());

function setup(opts: { schedule?: Record<string, unknown> | null; claimCount?: number; enqueueError?: Error } = {}) {
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
          nextRunAt: SLOT,
        }
      : opts.schedule;
  const prisma = {
    backupSchedule: {
      findUnique: jest.fn(async () => schedule),
      updateMany: jest.fn(async (_args: unknown) => ({ count: opts.claimCount ?? 1 })),
    },
    // The tick must never touch run rows: the handler owns them.
    backupRun: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const jobs = {
    enqueue: jest.fn(async (_input: unknown) => {
      if (opts.enqueueError) throw opts.enqueueError;
      return { id: 'job-1' };
    }),
  };
  const task = new BackupScheduleTask(prisma as never, jobs as never);
  return { task, prisma, jobs };
}

describe('BackupScheduleTask (enqueue-only tick)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('claims a due slot with a compare-and-set past now and queues exactly one system job', async () => {
    const { task, prisma, jobs } = setup();
    await task.handleTick();

    expect(prisma.backupSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: BACKUP_SCHEDULE_ID, enabled: true, nextRunAt: SLOT },
      data: { nextRunAt: new Date('2026-05-02T03:00:00Z') },
    });
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue.mock.calls[0][0]).toMatchObject({
      type: BACKUP_RUN_JOB_TYPE,
      orgId: null,
      payload: { trigger: 'schedule' },
    });
    expect(prisma.backupRun.create).not.toHaveBeenCalled();
  });

  it('queues nothing when the compare-and-set updates 0 rows (another instance won)', async () => {
    const { task, jobs } = setup({ claimCount: 0 });
    await task.handleTick();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('lets exactly one of two instances racing the same slot queue a job', async () => {
    let shared: Date = SLOT;
    const mk = () => {
      const ctx = setup();
      ctx.prisma.backupSchedule.updateMany.mockImplementation((async ({ where, data }: any) => {
        if (where.nextRunAt && shared.getTime() === where.nextRunAt.getTime()) {
          shared = data.nextRunAt;
          return { count: 1 };
        }
        return { count: 0 };
      }) as never);
      return ctx;
    };
    const a = mk();
    const b = mk();
    await Promise.all([a.task.handleTick(), b.task.handleTick()]);
    expect(a.jobs.enqueue.mock.calls.length + b.jobs.enqueue.mock.calls.length).toBe(1);
  });

  it.each([
    ['no schedule row', null],
    ['a disabled schedule', { enabled: false, nextRunAt: SLOT }],
    ['a schedule not yet due', { enabled: true, nextRunAt: new Date('2026-05-01T13:00:00Z') }],
    ['an enabled schedule without nextRunAt', { enabled: true, nextRunAt: null }],
  ])('does not even try to claim for %s', async (_label, schedule) => {
    const { task, prisma, jobs } = setup({ schedule });
    await task.handleTick();
    expect(prisma.backupSchedule.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('puts the slot back when the job cannot be queued, and never throws', async () => {
    const { task, prisma } = setup({ enqueueError: new Error('database down') });
    await expect(task.handleTick()).resolves.toBeUndefined();

    expect(prisma.backupSchedule.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.backupSchedule.updateMany.mock.calls[1][0]).toEqual({
      where: { id: BACKUP_SCHEDULE_ID, nextRunAt: new Date('2026-05-02T03:00:00Z') },
      data: { nextRunAt: SLOT },
    });
  });

  it('never throws out of the cron when the schedule read fails', async () => {
    const { task, prisma, jobs } = setup();
    prisma.backupSchedule.findUnique.mockRejectedValue(new Error('boom'));
    await expect(task.handleTick()).resolves.toBeUndefined();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
