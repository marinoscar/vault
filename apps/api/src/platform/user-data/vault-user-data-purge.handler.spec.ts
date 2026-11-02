// The `vault.user_data.purge` delegate (issue #91, E9.3): bytes before rows, a provider failure keeps
// the row for the retry, a live run is never deleted under its runner, system types are never touched.

import { VaultUserDataPurgeHandler } from './vault-user-data-purge.handler';
import { VAULT_USER_DATA_PURGE_JOB_TYPE } from './user-data.constants';

const USER = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';

type Run = { id: string; status: string; storageKey: string | null; deletedAt: Date | null; job: { status: string } | null };

function build(runs: Run[], deleteArchive: (key: string) => Promise<void> = async () => undefined) {
  const prisma = {
    backupRun: {
      findMany: jest.fn().mockResolvedValue(runs),
      deleteMany: jest.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length })),
    },
    secretType: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const storage = { delete: jest.fn(deleteArchive) };
  const registry = { register: jest.fn() };
  const handler = new VaultUserDataPurgeHandler(registry as never, prisma as never, storage as never);
  return { handler, prisma, storage, registry };
}

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id,
  status: 'succeeded',
  storageKey: `user-backups/${USER}/${id}.zip`,
  deletedAt: null,
  job: { status: 'succeeded' },
  ...over,
});

describe('VaultUserDataPurgeHandler', () => {
  it('is a server-only handler registered under its permanent type', () => {
    const { handler, registry } = build([]);
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
    expect(handler.type).toBe('vault.user_data.purge');
    expect(handler.type).toBe(VAULT_USER_DATA_PURGE_JOB_TYPE);
    expect(handler).not.toHaveProperty('nodeResultSchema');
    expect(handler).not.toHaveProperty('persistNodeResult');
    expect(handler.profile).toEqual({ maxRuntimeMs: 15 * 60_000, maxAttempts: 3 });
  });

  it('deletes the archive first, then the rows, for the user\'s runs only', async () => {
    const order: string[] = [];
    const { handler, prisma } = build([run('r1'), run('r2')], async (key) => void order.push(`bytes:${key}`));
    prisma.backupRun.deleteMany.mockImplementation(async ({ where }: any) => (order.push('rows'), { count: where.id.in.length }));

    await expect(handler.purge(USER)).resolves.toEqual({
      backupRunsDeleted: 2,
      backupArchivesDeleted: 2,
      backupArchivesFailed: 0,
      backupRunsInFlight: 0,
      secretTypesDeleted: 2,
    });
    expect(order).toEqual([`bytes:user-backups/${USER}/r1.zip`, `bytes:user-backups/${USER}/r2.zip`, 'rows']);
    expect(prisma.backupRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scope: 'user', ownerId: USER } }));
  });

  it('does not touch the provider for a soft-deleted run (its archive is already gone) but removes its row', async () => {
    const { handler, storage, prisma } = build([run('r1', { deletedAt: new Date() }), run('r2', { storageKey: null })]);
    await handler.purge(USER);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.backupRun.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['r1', 'r2'] } } });
  });

  it('keeps the row of an archive the provider refused, and fails the job so the queue retries', async () => {
    const { handler, prisma } = build([run('ok'), run('bad')], async (key) => {
      if (key.endsWith('bad.zip')) throw new Error('S3 exploded');
    });
    await expect(handler.process({ id: 'job-1', payload: { userId: USER } } as never)).rejects.toThrow(/could not be deleted/);
    expect(prisma.backupRun.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ok'] } } });
  });

  it('never deletes a run whose job is still alive, and retries', async () => {
    const { handler, storage, prisma } = build([run('live', { status: 'running', job: { status: 'running' } })]);
    await expect(handler.process({ id: 'job-1', payload: { userId: USER } } as never)).rejects.toThrow(/still running/);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.backupRun.deleteMany).not.toHaveBeenCalled();
  });

  it('treats a run left `running` by a dead job as stale and deletes it', async () => {
    const { handler, prisma } = build([run('stale', { status: 'running', storageKey: null, job: { status: 'failed' } })]);
    await handler.purge(USER);
    expect(prisma.backupRun.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['stale'] } } });
  });

  it('deletes only the user\'s custom, unused secret types', async () => {
    const { handler, prisma } = build([]);
    await handler.purge(USER);
    expect(prisma.secretType.deleteMany).toHaveBeenCalledWith({
      where: { createdById: USER, isSystem: false, secrets: { none: {} } },
    });
  });

  it('refuses a payload without a user id', async () => {
    const { handler } = build([]);
    await expect(handler.process({ id: 'job-1', payload: {} } as never)).rejects.toThrow(/userId/);
  });
});
