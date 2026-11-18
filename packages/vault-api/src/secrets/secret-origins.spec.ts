import { computeSecretOrigins } from './secrets.service';
import { OriginsBackfillBootstrap, OriginsBackfillHandler } from './jobs/origins-backfill.handler';
import { SECRETS_ORIGINS_BACKFILL_JOB_TYPE } from './jobs/origins-backfill-job-types';
import { InMemoryAudit, TestCrypto } from '../testing';

const credential = { name: 'Credential', isSystem: true };

describe('computeSecretOrigins', () => {
  it('derives origins for the Credential system type, empty when the URLs are gone', () => {
    expect(computeSecretOrigins(credential, { url: 'https://a.example.test/x', additional_urls: 'b.example.test' })).toEqual([
      'https://a.example.test',
      'https://b.example.test',
    ]);
    expect(computeSecretOrigins(credential, { username: 'u' })).toEqual([]);
  });

  it.each([
    [{ name: 'Note', isSystem: true }],
    [{ name: 'Credential', isSystem: false }],
    [null],
  ])('leaves other types alone (%j)', (type) => {
    expect(computeSecretOrigins(type, { url: 'https://a.example.test' })).toBeUndefined();
  });
});

describe('OriginsBackfillHandler', () => {
  const crypto = new TestCrypto();
  const row = (id: string, data: unknown, origins: string[] = []) => {
    const e = crypto.encrypt(JSON.stringify(data));
    return { id, origins, versions: [{ encryptedData: e.ciphertext, iv: e.iv, authTag: e.authTag }] };
  };

  function build(rows: ReturnType<typeof row>[]) {
    const updates: Array<{ id: string; origins: string[] }> = [];
    const prisma: any = {
      secretType: { findFirst: jest.fn().mockResolvedValue({ id: 't' }) },
      secret: {
        findMany: jest.fn(async ({ take, cursor }: any) => {
          const start = cursor ? rows.findIndex((r) => r.id === cursor.id) + 1 : 0;
          return rows.slice(start, start + take);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          updates.push({ id: where.id, origins: data.origins });
          rows.find((r) => r.id === where.id)!.origins = data.origins;
        }),
      },
    };
    const jobs: any = { registerHandler: jest.fn(), enqueue: jest.fn() };
    const audit = new InMemoryAudit();
    return { handler: new OriginsBackfillHandler(jobs, prisma, crypto, audit), updates, audit, jobs };
  }

  it('is registered under its permanent, server-only type', () => {
    const { handler, jobs } = build([]);
    handler.onModuleInit();
    expect(jobs.registerHandler).toHaveBeenCalledWith(handler);
    expect(handler.type).toBe(SECRETS_ORIGINS_BACKFILL_JOB_TYPE);
    expect((handler as any).nodeResultSchema).toBeUndefined();
    expect((handler as any).persistNodeResult).toBeUndefined();
    expect(handler.profile.maxRuntimeMs).toBeGreaterThan(0);
  });

  it('fills origins, skips unreadable rows, and a re-run changes nothing', async () => {
    const rows = [
      row('a', { url: 'https://a.example.test/p', password: 'x' }),
      row('b', { username: 'u' }),
      { ...row('c', {}), versions: [{ encryptedData: 'AAAA', iv: 'AAAA', authTag: 'AAAA' }] },
    ];
    const { handler, updates } = build(rows);
    expect(await handler.run()).toEqual({ scanned: 3, updated: 1, unreadable: 1 });
    expect(updates).toEqual([{ id: 'a', origins: ['https://a.example.test'] }]);
    expect(await handler.run()).toEqual({ scanned: 3, updated: 0, unreadable: 1 });
  });

  it('batches by keyset over more than one page', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => row(`s${String(i).padStart(3, '0')}`, { url: `h${i}.example.test` }));
    const { handler } = build(rows);
    expect((await handler.run()).updated).toBe(450);
  });

  it('fails the job when no Credential can be read, and records completion otherwise', async () => {
    const bad = build([{ ...row('c', {}), versions: [{ encryptedData: 'AAAA', iv: 'AAAA', authTag: 'AAAA' }] }]);
    await expect(bad.handler.process({} as never)).rejects.toThrow(/encryption key/);
    const ok = build([row('a', { url: 'a.example.test' })]);
    await ok.handler.process({} as never);
    expect(ok.audit.events[0]).toMatchObject({ action: 'vault.secrets.origins_backfilled' });
    expect(JSON.stringify(ok.audit.events)).not.toMatch(/example/);
  });
});

describe('OriginsBackfillBootstrap', () => {
  it('queues nothing when a backfill is recorded or there is no Credential', async () => {
    const jobs: any = { enqueue: jest.fn() };
    const prisma: any = {
      auditEvent: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
      secret: { findFirst: jest.fn().mockResolvedValue({ id: 's' }) },
    };
    await new OriginsBackfillBootstrap(jobs, prisma).onApplicationBootstrap();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    prisma.auditEvent.findFirst.mockResolvedValue(null);
    prisma.secret.findFirst.mockResolvedValue(null);
    await new OriginsBackfillBootstrap(jobs, prisma).onApplicationBootstrap();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
