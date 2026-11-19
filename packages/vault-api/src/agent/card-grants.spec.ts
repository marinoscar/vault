import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import { createCardGrantSchema } from '@marinoscar/vault-contract/agent';

import { InMemoryAudit, InMemoryCardGrantStore } from '../testing';
import { CardGrantsController } from './card-grants.controller';
import { CardGrantsService } from './card-grants.service';

const USER = 'user-aaa';
const OTHER = 'user-bbb';
const CARD = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const SHOP = 'https://shop.example.test';

function build() {
  const cards = new Map([
    [CARD, { id: CARD, name: 'Card A', createdById: USER }],
    [FOREIGN, { id: FOREIGN, name: 'Card B', createdById: OTHER }],
  ]);
  const prisma = {
    secret: {
      findFirst: jest.fn(async (args: { where: { id: string; createdById: string } }) => {
        const card = cards.get(args.where.id);
        return card && card.createdById === args.where.createdById ? { id: card.id, name: card.name } : null;
      }),
    },
    oAuthClient: { findMany: jest.fn().mockResolvedValue([{ id: 'client-1', name: 'Agent App A' }]) },
  };
  const store = new InMemoryCardGrantStore();
  const audit = new InMemoryAudit();
  const service = new CardGrantsService(prisma as never, audit, store);
  return { service, store, audit, prisma, controller: new CardGrantsController(service) };
}

const body = (over: Record<string, unknown> = {}) =>
  createCardGrantSchema.parse({ merchantOrigin: `${SHOP}/checkout`, maxAmount: 100, currency: 'usd', ...over });

async function code(promise: Promise<unknown>): Promise<{ status: number; code?: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return { status: error.getStatus(), code: (error.getResponse() as { code?: string }).code };
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('CardGrantsService (owner)', () => {
  it('creates a grant with the merchant normalized, matched by registrable domain, and audits it without a card value', async () => {
    const { service, audit } = build();
    const grant = await service.create(USER, CARD, body({
      frameOrigins: ['https://pay.example.test/frame'], periodLimit: { period: 'month', maxReleases: 3, maxAmount: 250 },
      includeSecurityCode: true,
    }));
    expect(grant).toMatchObject({
      secretId: CARD, merchantOrigin: SHOP, merchantSite: 'example.test', frameOrigins: ['https://pay.example.test'],
      maxAmount: 100, currency: 'USD', periodLimit: { period: 'month', maxReleases: 3, maxAmount: 250 },
      includeSecurityCode: true, status: 'active', revokedAt: null,
      usage: { periodReleases: 0, periodAmount: 0, totalReleases: 0, lastReleasedAt: null },
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ action: 'secret.card_grant.create', targetId: CARD });
    expect(audit.events[0]!.meta).toMatchObject({ grantId: grant.id, origin: SHOP, amount: '100.00', currency: 'USD', credential: 'session' });
  });

  it('refuses a second live grant for the same merchant site (409 CARD_GRANT_EXISTS), allows it after a revoke', async () => {
    const { service } = build();
    const first = await service.create(USER, CARD, body());
    expect(await code(service.create(USER, CARD, body({ merchantOrigin: 'https://checkout.shop.example.test' })))).toEqual({
      status: 409, code: 'CARD_GRANT_EXISTS',
    });
    const revoked = await service.revoke(USER, CARD, first.id);
    expect(revoked.status).toBe('revoked');
    await expect(service.create(USER, CARD, body())).resolves.toMatchObject({ status: 'active' });
    const list = await service.list(USER, CARD);
    expect(list.map((g) => g.status)).toEqual(['active', 'revoked']);
  });

  it('refuses an invalid merchant, frame or a past expiry with 400', async () => {
    const { service } = build();
    await expect(service.create(USER, CARD, body({ merchantOrigin: 'http://shop.example.test' }))).rejects.toThrow('merchantOrigin');
    await expect(service.create(USER, CARD, body({ frameOrigins: ['ftp://x.example.test'] }))).rejects.toThrow('frameOrigins');
    await expect(service.create(USER, CARD, body({ expiresAt: '2001-01-01T00:00:00Z' }))).rejects.toThrow('future');
  });

  it('answers 404 for a card that is not the caller\'s, on every route', async () => {
    const { service } = build();
    await expect(service.list(USER, FOREIGN)).rejects.toThrow(NotFoundException);
    await expect(service.create(USER, FOREIGN, body())).rejects.toThrow(NotFoundException);
    await expect(service.listRequests(USER, FOREIGN)).rejects.toThrow(NotFoundException);
  });

  it('approval creates exactly the requested grant and marks the request approved', async () => {
    const { service, store, audit } = build();
    const request = await store.createRequest({
      secretId: CARD, userId: USER, origin: SHOP, merchantSite: 'example.test', amountMinor: 4_250, currency: 'EUR',
      reason: 'Order for Person A', clientId: 'client-1', clientLabel: null,
    });
    const [pending] = await service.listRequests(USER, CARD, 'pending');
    expect(pending).toMatchObject({ id: request.id, amount: 42.5, currency: 'EUR', clientName: 'Agent App A', status: 'pending' });

    const { request: approved, grant } = await service.approve(USER, CARD, request.id);
    expect(approved).toMatchObject({ status: 'approved', grantId: grant.id });
    expect(grant).toMatchObject({
      merchantOrigin: SHOP, merchantSite: 'example.test', frameOrigins: [], maxAmount: 42.5, currency: 'EUR',
      periodLimit: null, expiresAt: null, includeSecurityCode: false, status: 'active',
    });
    expect(store.grants).toHaveLength(1);
    expect(audit.events.at(-1)).toMatchObject({ action: 'secret.card_grant_request.approve' });
    expect(await code(service.approve(USER, CARD, request.id))).toEqual({ status: 409, code: 'CARD_GRANT_REQUEST_NOT_PENDING' });
    expect(await code(service.decline(USER, CARD, request.id))).toEqual({ status: 409, code: 'CARD_GRANT_REQUEST_NOT_PENDING' });
  });

  it('declining creates no grant', async () => {
    const { service, store } = build();
    const request = await store.createRequest({
      secretId: CARD, userId: USER, origin: SHOP, merchantSite: 'example.test', amountMinor: 100, currency: 'USD',
      reason: 'x', clientId: null, clientLabel: 'Host A',
    });
    await expect(service.decline(USER, CARD, request.id)).resolves.toMatchObject({ status: 'declined', clientName: 'Host A' });
    expect(store.grants).toHaveLength(0);
  });

  it('approval of a request whose merchant already has a live grant is 409 CARD_GRANT_EXISTS and stays pending', async () => {
    const { service, store } = build();
    await service.create(USER, CARD, body());
    const request = await store.createRequest({
      secretId: CARD, userId: USER, origin: SHOP, merchantSite: 'example.test', amountMinor: 100, currency: 'USD',
      reason: 'x', clientId: null, clientLabel: null,
    });
    await expect(service.approve(USER, CARD, request.id)).rejects.toThrow(ConflictException);
    expect((await store.getRequest(request.id))!.status).toBe('pending');
  });
});

describe('CardGrantsController: no token creates, changes or widens a grant', () => {
  const oauth: AuthCredentialInfo = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'agent', scopes: [] };
  const pat: AuthCredentialInfo = { kind: 'pat', tokenId: 'p' };
  const user = { id: USER } as never;
  const REQ = '33333333-3333-4333-8333-333333333333';

  it.each([['oat_', oauth], ['pat_', pat], ['no credential', null]])('refuses every write route for %s with 403 OWNER_SESSION_REQUIRED', async (_label, credential) => {
    const { controller, store } = build();
    const writes = [
      () => controller.create(CARD, body() as never, user, credential),
      () => controller.revoke(CARD, REQ, user, credential),
      () => controller.approve(CARD, REQ, user, credential),
      () => controller.decline(CARD, REQ, user, credential),
    ];
    for (const write of writes) {
      expect(await code(write())).toEqual({ status: 403, code: 'OWNER_SESSION_REQUIRED' });
    }
    expect(store.grants).toHaveLength(0);
  });

  it('admits the owner\'s browser session', async () => {
    const { controller } = build();
    await expect(controller.create(CARD, body() as never, user, { kind: 'jwt' })).resolves.toMatchObject({ data: { status: 'active' } });
  });
});
