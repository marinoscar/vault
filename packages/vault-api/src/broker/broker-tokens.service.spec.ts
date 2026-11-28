import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createBrokerTokenSchema, isBrokerTokenShape } from '@marinoscar/vault-contract/broker';

import { InMemoryAudit } from '../testing';
import { BrokerTokensController } from './broker-tokens.controller';
import { BrokerTokensService } from './broker-tokens.service';
import { hashBrokerToken } from './broker-token';

const OWNER = 'user-aaa';
const S1 = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const S2 = '4a3c9f1f-7d2e-4a5c-8b66-2d3e4f5a6b7c';

function setup() {
  const rows: any[] = [];
  const prisma = {
    secret: { count: jest.fn().mockResolvedValue(0) },
    brokerToken: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `tok-${rows.length + 1}`, lastUsedAt: null, revokedAt: null, createdAt: new Date('2026-11-28T00:00:00Z'), user: { isActive: true }, ...data };
        rows.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.userId === where.userId)),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.userId === where.userId) ?? null),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    },
  };
  const audit = new InMemoryAudit();
  const service = new BrokerTokensService(prisma as never, audit);
  let now = Date.parse('2026-11-28T00:00:00Z');
  service.now = () => now;
  return { service, prisma, audit, rows, advance: (ms: number) => { now += ms; } };
}

const body = (over: Record<string, unknown> = {}) => createBrokerTokenSchema.parse({ name: 'Sandbox A', ...over });

describe('BrokerTokensService', () => {
  it('creates a vbk_ token shown once, stores only its hash and prefix, and audits without the token', async () => {
    const t = setup();
    const created = await t.service.create(OWNER, body());
    expect(isBrokerTokenShape(created.token)).toBe(true);
    expect(created.tokenPrefix).toBe(created.token.slice(0, 12));
    expect(created.expiresAt).toBe(new Date(Date.parse('2026-11-28T00:00:00Z') + 90 * 86_400_000).toISOString());
    expect(created.secretIds).toEqual([]);

    const stored = t.prisma.brokerToken.create.mock.calls[0]![0].data;
    expect(stored.tokenHash).toBe(hashBrokerToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(t.audit.events[0]).toMatchObject({ actorUserId: OWNER, action: 'broker.token.create', targetType: 'broker_token' });
    expect(JSON.stringify(t.audit.events)).not.toContain(created.token);
    expect(JSON.stringify(t.audit.events)).not.toContain(hashBrokerToken(created.token));
  });

  it('honours expiresInDays and always expires', async () => {
    const t = setup();
    const created = await t.service.create(OWNER, body({ expiresInDays: 1 }));
    expect(Date.parse(created.expiresAt!) - Date.parse('2026-11-28T00:00:00Z')).toBe(86_400_000);
  });

  it('restricts to the caller\'s own broker-enabled secrets only', async () => {
    const t = setup();
    t.prisma.secret.count.mockResolvedValue(1);
    const error = await t.service.create(OWNER, body({ secretIds: [S1, S2] })).catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse().code).toBe('BROKER_TOKEN_SECRET_INVALID');
    expect(t.prisma.secret.count).toHaveBeenCalledWith({ where: { id: { in: [S1, S2] }, createdById: OWNER, brokerAccess: true } });
    expect(t.rows).toHaveLength(0);

    t.prisma.secret.count.mockResolvedValue(2);
    const created = await t.service.create(OWNER, body({ secretIds: [S1, S2, S1] }));
    expect(created.secretIds).toEqual([S1, S2]);
  });

  it('lists only the caller\'s tokens, never the token or hash', async () => {
    const t = setup();
    await t.service.create(OWNER, body());
    await t.service.create('user-bbb', body({ name: 'Other' }));
    const list = await t.service.list(OWNER);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'revokedAt', 'secretIds', 'tokenPrefix']);
    expect(JSON.stringify(list)).not.toContain('tokenHash');
  });

  it('revokes the owner\'s token, audited, idempotently; foreign and missing are 404', async () => {
    const t = setup();
    const created = await t.service.create(OWNER, body());
    await expect(t.service.revoke('user-bbb', created.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.service.revoke(OWNER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await t.service.revoke(OWNER, created.id);
    await t.service.revoke(OWNER, created.id);
    expect(t.audit.events.filter((e) => e.action === 'broker.token.revoke')).toHaveLength(1);
    expect(t.prisma.brokerToken.update).toHaveBeenCalledTimes(1);
  });

  describe('resolve', () => {
    it('resolves a live token and stamps last use at most once a minute', async () => {
      const t = setup();
      const created = await t.service.create(OWNER, body({ secretIds: undefined }));
      const first = await t.service.resolve(created.token);
      expect(first).toEqual({ tokenId: created.id, userId: OWNER, secretIds: [] });
      await t.service.resolve(created.token);
      expect(t.prisma.brokerToken.update).toHaveBeenCalledTimes(1);
      t.advance(61_000);
      await t.service.resolve(created.token);
      expect(t.prisma.brokerToken.update).toHaveBeenCalledTimes(2);
    });

    it('answers null for unknown, wrong-prefix, revoked, expired and inactive-owner tokens', async () => {
      const t = setup();
      const live = await t.service.create(OWNER, body());
      expect(await t.service.resolve('vbk_' + 'x'.repeat(40))).toBeNull();
      expect(await t.service.resolve('pat_' + 'x'.repeat(40))).toBeNull();
      expect(await t.service.resolve('')).toBeNull();

      const revoked = await t.service.create(OWNER, body({ name: 'r' }));
      await t.service.revoke(OWNER, revoked.id);
      expect(await t.service.resolve(revoked.token)).toBeNull();

      const inactive = await t.service.create(OWNER, body({ name: 'i' }));
      t.rows.find((r) => r.id === inactive.id).user = { isActive: false };
      expect(await t.service.resolve(inactive.token)).toBeNull();

      t.advance(91 * 86_400_000);
      expect(await t.service.resolve(live.token)).toBeNull();
    });

    it('a failing last-used stamp never fails the request', async () => {
      const t = setup();
      const created = await t.service.create(OWNER, body());
      t.prisma.brokerToken.update.mockRejectedValue(new Error('db'));
      expect(await t.service.resolve(created.token)).not.toBeNull();
    });
  });
});

describe('BrokerTokensController', () => {
  const tokens = { create: jest.fn().mockResolvedValue({ id: 't' }), list: jest.fn().mockResolvedValue([]), revoke: jest.fn().mockResolvedValue(undefined) };
  const controller = new BrokerTokensController(tokens as never);
  const user = { id: OWNER } as never;
  const oauth = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'mcp', scopes: [] } as never;
  const session = { kind: 'jwt' } as never;
  const pat = { kind: 'pat', tokenId: 'p' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('refuses an OAuth credential on every route and never reaches the service', async () => {
    await expect(controller.create({ name: 'x', expiresInDays: 1 } as never, user, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.list(user, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove(S1, user, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.revoke(S1, user, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokens.create).not.toHaveBeenCalled();
    expect(tokens.list).not.toHaveBeenCalled();
    expect(tokens.revoke).not.toHaveBeenCalled();
  });

  it('serves a session and a personal access token, scoped to the caller', async () => {
    await controller.create({ name: 'x', expiresInDays: 1 } as never, user, session);
    await controller.list(user, pat);
    await controller.remove(S1, user, session);
    await controller.revoke(S1, user, pat);
    expect(tokens.create).toHaveBeenCalledWith(OWNER, expect.anything());
    expect(tokens.list).toHaveBeenCalledWith(OWNER);
    expect(tokens.revoke).toHaveBeenCalledTimes(2);
    expect(tokens.revoke).toHaveBeenCalledWith(OWNER, S1);
  });
});
