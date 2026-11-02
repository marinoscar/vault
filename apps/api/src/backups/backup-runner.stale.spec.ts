import { Logger } from '@nestjs/common';

import {
  BACKUP_HEARTBEAT_INTERVAL_MS,
  BACKUP_HEARTBEAT_STALE_MS,
  BackupRunnerService,
  isRunStale,
  STALE_RUN_ERROR,
  staleRunsWhere,
} from './backup-runner.service';

const NOW = new Date('2026-05-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60 * 1000;

interface Row {
  id: string;
  status: string;
  startedAt: Date;
  heartbeatAt: Date | null;
  error?: string | null;
}

/**
 * Evaluates the subset of a Prisma `where` the runner uses (equality, `lt`,
 * `null`, `OR`) so the tests exercise the real filter object, not a copy of it.
 */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') {
      return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    }
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date || typeof cond !== 'object') {
      return value instanceof Date && cond instanceof Date
        ? value.getTime() === cond.getTime()
        : value === cond;
    }
    const ops = cond as { lt?: Date };
    if (ops.lt !== undefined) {
      return value instanceof Date && value.getTime() < ops.lt.getTime();
    }
    return true;
  });
}

function makeRunner(rows: Row[]) {
  const updateMany = jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
    let count = 0;
    for (const row of rows) {
      if (matches(row as unknown as Record<string, unknown>, where)) {
        Object.assign(row, data);
        count += 1;
      }
    }
    return { count };
  });
  const prisma = { backupRun: { updateMany } };
  const runner = new BackupRunnerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { runner, updateMany, rows };
}

beforeAll(() => Logger.overrideLogger(false));

describe('isRunStale', () => {
  it('is stale only when the last heartbeat is more than 3 minutes old', () => {
    expect(BACKUP_HEARTBEAT_STALE_MS).toBe(3 * MIN);
    const run = (heartbeatAt: Date | null, startedAt = ago(60 * MIN)) => ({
      status: 'running',
      startedAt,
      heartbeatAt,
    });
    expect(isRunStale(run(ago(30 * 1000)), NOW)).toBe(false);
    expect(isRunStale(run(ago(3 * MIN)), NOW)).toBe(false);
    expect(isRunStale(run(ago(3 * MIN + 1)), NOW)).toBe(true);
  });

  it('falls back to startedAt when the run never beat', () => {
    expect(isRunStale({ status: 'running', startedAt: ago(MIN), heartbeatAt: null }, NOW)).toBe(false);
    expect(isRunStale({ status: 'running', startedAt: ago(4 * MIN), heartbeatAt: null }, NOW)).toBe(true);
  });

  it('a long-running run with a fresh heartbeat is not stale', () => {
    expect(isRunStale({ status: 'running', startedAt: ago(10 * 60 * MIN), heartbeatAt: ago(10 * 1000) }, NOW)).toBe(false);
  });

  it('never treats a finished run as stale', () => {
    expect(isRunStale({ status: 'succeeded', startedAt: ago(60 * MIN), heartbeatAt: null }, NOW)).toBe(false);
    expect(isRunStale({ status: 'failed', startedAt: ago(60 * MIN), heartbeatAt: ago(60 * MIN) }, NOW)).toBe(false);
  });
});

describe('staleRunsWhere', () => {
  it('selects exactly the rows isRunStale calls stale', () => {
    const rows: Row[] = [
      { id: 'fresh', status: 'running', startedAt: ago(9 * 60 * MIN), heartbeatAt: ago(20 * 1000) },
      { id: 'deadBeat', status: 'running', startedAt: ago(30 * MIN), heartbeatAt: ago(5 * MIN) },
      { id: 'neverBeatNew', status: 'running', startedAt: ago(MIN), heartbeatAt: null },
      { id: 'neverBeatOld', status: 'running', startedAt: ago(10 * MIN), heartbeatAt: null },
      { id: 'done', status: 'succeeded', startedAt: ago(60 * MIN), heartbeatAt: ago(60 * MIN) },
    ];
    const where = staleRunsWhere(NOW);
    const selected = rows.filter((r) => matches(r as unknown as Record<string, unknown>, where)).map((r) => r.id);
    expect(selected).toEqual(['deadBeat', 'neverBeatOld']);
    expect(selected).toEqual(rows.filter((r) => isRunStale(r, NOW)).map((r) => r.id));
  });
});

describe('BackupRunnerService stale sweeps', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('startup recovery leaves a run with a fresh heartbeat alone and fails a dead one', async () => {
    const { runner, rows } = makeRunner([
      { id: 'live', status: 'running', startedAt: ago(2 * 60 * MIN), heartbeatAt: ago(15 * 1000) },
      { id: 'dead', status: 'running', startedAt: ago(2 * 60 * MIN), heartbeatAt: ago(10 * MIN) },
    ]);

    await runner.onApplicationBootstrap();

    expect(rows.find((r) => r.id === 'live')).toMatchObject({ status: 'running' });
    expect(rows.find((r) => r.id === 'dead')).toMatchObject({ status: 'failed', error: STALE_RUN_ERROR });
  });

  it('startup recovery never throws', async () => {
    const prisma = { backupRun: { updateMany: jest.fn().mockRejectedValue(new Error('db down')) } };
    const runner = new BackupRunnerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(runner.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('the cron sweep uses the same rule', async () => {
    const { runner, rows } = makeRunner([
      { id: 'live', status: 'running', startedAt: ago(7 * 60 * MIN), heartbeatAt: ago(MIN) },
      { id: 'dead', status: 'running', startedAt: ago(5 * MIN), heartbeatAt: null },
    ]);
    await expect(runner.failStaleRuns(NOW)).resolves.toBe(1);
    expect(rows.map((r) => r.status)).toEqual(['running', 'failed']);
  });

  it('startRun sweeps with the heartbeat rule under the lock and sets heartbeatAt on insert', async () => {
    const rows: Row[] = [
      { id: 'live', status: 'running', startedAt: ago(7 * 60 * MIN), heartbeatAt: ago(MIN) },
    ];
    const { updateMany } = makeRunner(rows);
    const create = jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => ({ ...data, id: 'new' }));
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      backupRun: {
        updateMany,
        count: jest.fn(async () => rows.filter((r) => r.status === 'running').length),
        create,
      },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const runner = new BackupRunnerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    // The live run (old start, fresh heartbeat) is not swept, so this is a conflict.
    await expect(runner.startRun('manual', 'admin')).rejects.toMatchObject({ status: 409 });
    expect(rows[0].status).toBe('running');

    // Once its heartbeat is old, it is swept and a new run is inserted with a heartbeat.
    rows[0].heartbeatAt = ago(4 * MIN);
    await runner.startRun('manual', 'admin');
    expect(rows[0]).toMatchObject({ status: 'failed', error: STALE_RUN_ERROR });
    const inserted = create.mock.calls[0][0].data;
    expect(inserted.status).toBe('running');
    expect(inserted.heartbeatAt).toEqual(inserted.startedAt);
  });
});

describe('BackupRunnerService heartbeat', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('refreshes heartbeatAt every 30 s by id while running, with an unref timer', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const runner = new BackupRunnerService(
      { backupRun: { updateMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const timer = (runner as unknown as { startHeartbeat(id: string): NodeJS.Timeout }).startHeartbeat('run-1');
    try {
      expect(BACKUP_HEARTBEAT_INTERVAL_MS).toBe(30 * 1000);
      expect(timer.hasRef()).toBe(false);
      await jest.advanceTimersByTimeAsync(BACKUP_HEARTBEAT_INTERVAL_MS);
      await jest.advanceTimersByTimeAsync(BACKUP_HEARTBEAT_INTERVAL_MS);
      expect(updateMany).toHaveBeenCalledTimes(2);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'run-1', status: 'running' },
        data: { heartbeatAt: expect.any(Date) },
      });
    } finally {
      clearInterval(timer);
    }
  });

  it('execute stops the heartbeat when the run ends', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      backupRun: { updateMany, update: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    // No bucket: the run fails immediately, which still has to clear the timer.
    const storage = { getBucket: () => '' };
    const runner = new BackupRunnerService(prisma as never, {} as never, storage as never, {} as never, {} as never, {} as never);
    const clearSpy = jest.spyOn(global, 'clearInterval');

    await runner.execute({
      id: 'run-2',
      status: 'running',
      trigger: 'manual',
      triggeredById: null,
      storageKey: 'system-backups/x.zip',
      sizeBytes: null,
      userCount: 0,
      secretCount: 0,
      attachmentCount: 0,
      warningCount: 0,
      error: null,
      startedAt: NOW,
      finishedAt: null,
      deletedAt: null,
    });

    expect(clearSpy).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5 * BACKUP_HEARTBEAT_INTERVAL_MS);
    expect(updateMany).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
