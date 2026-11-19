// =============================================================================
// The agent release rules, through BOTH paths (ADR-0003, issue #195)
// =============================================================================
//
// One table of cases runs twice: through `AgentReleaseService` as an embedded host calls it (no
// HTTP, no OAuth: `{ userId, clientLabel }`), and through the HTTP controllers (`AgentCardsController`,
// `AgentController`) with an `oat_` credential. Both reach the same implementation; this file is
// the proof that they enforce the same rules. Card numbers are the well-known test PAN; people and
// shops are invented.
// =============================================================================

import { HttpException, NotFoundException } from '@nestjs/common';
import { responseHeadersOf } from '@marinoscar/platform-api/core';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import type {
  AgentCardFillRequest,
  AgentCardSummary,
  AgentCredentialSummary,
  AgentIdentityFillRequest,
  AgentIdentitySummary,
} from '@marinoscar/vault-contract/agent';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { FakeSettings, InMemoryAudit, InMemoryCardGrantStore, RecordingNotify } from '../testing';
import type { SecretsService } from '../secrets/secrets.service';
import { AgentCardsController } from './agent-cards.controller';
import { AgentCardsService, merchantSiteOf } from './agent-cards.service';
import { AgentCredentialsService } from './agent-credentials.service';
import { AgentIdentityService } from './agent-identity.service';
import { AgentNotifier } from './agent-notifier.service';
import { AgentCallPipeline } from './agent-pipeline';
import { InMemoryAgentRateLimiter } from './agent-rate-limiter';
import { AgentReleaseService } from './agent-release.service';
import { AgentController } from './agent.controller';

const USER = 'user-aaa';
const OTHER = 'user-bbb';
const SHOP = 'https://shop.example.test';
const CHECKOUT = 'https://checkout.shop.example.test';
const PAY_FRAME = 'https://pay.example.test';
const ELSEWHERE = 'https://other-shop.test';
const FORM = 'https://form.example.test';

const CARD = '11111111-1111-4111-8111-111111111111';
const CARD_CLOSED = '22222222-2222-4222-8222-222222222222';
const CARD_FOREIGN = '33333333-3333-4333-8333-333333333333';
const CARD_NO_GRANT = '44444444-4444-4444-8444-444444444444';
const CARD_ELSEWHERE = '55555555-5555-4555-8555-555555555555';
const CARD_EXPIRED = '66666666-6666-4666-8666-666666666666';
const IDENTITY = '77777777-7777-4777-8777-777777777777';
const LOGIN = '88888888-8888-4888-8888-888888888888';
const MISSING = '99999999-9999-4999-8999-999999999999';

// Canaries: the well-known test PAN, a security code and an id number that must never leave except as `{ value }`.
const CANARY_NUMBER = '4242424242424242';
const CANARY_CODE = 'cvc-canary-7319';
const CANARY_ID_NUMBER = 'id-canary-X5521';
const CANARY_PASSWORD = 'pw-canary-Qz9!';

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Card ${id.slice(0, 4)}`,
  createdById: USER,
  agentAccess: 'fill',
  agentOrigins: [] as string[],
  type: { name: 'Card', isSystem: true, fields: SYSTEM_SECRET_TYPES.find((t) => t.name === 'Card')!.fields },
  values: {
    card_network: 'Visa', cardholder_name: 'Person A', number: CANARY_NUMBER, exp_month: '04', exp_year: '2031',
    cvv: CANARY_CODE, billing_postal_code: '00000',
  } as Record<string, unknown>,
  ...over,
});

function world(settingsOver: Record<string, unknown> = {}) {
  const rows = new Map<string, ReturnType<typeof card>>([
    [CARD, card(CARD, { name: 'Card A' })],
    [CARD_CLOSED, card(CARD_CLOSED, { agentAccess: 'none' })],
    [CARD_FOREIGN, card(CARD_FOREIGN, { createdById: OTHER })],
    [CARD_NO_GRANT, card(CARD_NO_GRANT)],
    [CARD_ELSEWHERE, card(CARD_ELSEWHERE)],
    [CARD_EXPIRED, card(CARD_EXPIRED)],
    [IDENTITY, card(IDENTITY, {
      name: 'Identity A',
      agentOrigins: [FORM],
      type: { name: 'Identity', isSystem: true, fields: SYSTEM_SECRET_TYPES.find((t) => t.name === 'Identity')!.fields },
      values: { full_name: 'Person A', id_number: CANARY_ID_NUMBER, city: 'Town B', notes: 'private note' },
    })],
    [LOGIN, card(LOGIN, {
      name: 'Shop login', origins: [SHOP],
      type: { name: 'Credential', isSystem: true, fields: [] },
      values: { username: 'person-a', password: CANARY_PASSWORD },
    } as never)],
  ]);
  const opened = (userId: string, id: string, typeName: string) => {
    const row = rows.get(id);
    return row && row.createdById === userId && row.agentAccess === 'fill' && row.type.name === typeName && row.type.isSystem ? row : null;
  };
  const secrets = {
    findAgentOpenedSecret: jest.fn(async (userId: string, id: string, typeName: string) => opened(userId, id, typeName)),
    listAgentOpenedSecrets: jest.fn(async (userId: string, typeName: string) =>
      [...rows.values()].filter((row) => opened(userId, row.id, typeName)).sort((a, b) => a.name.localeCompare(b.name))),
    readCurrentValues: jest.fn(async (id: string) => {
      const row = rows.get(id);
      if (!row) throw new NotFoundException('Secret not found');
      return { ...row.values };
    }),
    findAgentAccessibleSecret: jest.fn(async (userId: string, id: string) => opened(userId, id, 'Credential')),
    assertAgentAccessible: jest.fn((s: unknown) => { if (!s) throw new NotFoundException('Secret not found'); }),
    findCredentialsByOrigin: jest.fn(async (userId: string) =>
      opened(userId, LOGIN, 'Credential') ? [{ id: LOGIN, name: 'Shop login', username: null, origins: [SHOP], matchKind: 'exact' }] : []),
    describeAgentCredentials: jest.fn(async () => new Map([[LOGIN, { username: 'person-a', hasTotp: false, updatedAt: '2030-01-01T00:00:00.000Z' }]])),
    generateTotpForSecret: jest.fn(async () => ({ code: '123456', expiresAt: '2030-01-01T00:00:30.000Z', period: 30 })),
  };

  const store = new InMemoryCardGrantStore();
  const day = 24 * 3600 * 1000;
  store.seedGrant({ secretId: CARD, userId: USER, merchantOrigin: SHOP, merchantSite: merchantSiteOf(SHOP), frameOrigins: [PAY_FRAME], maxAmountMinor: 10_000, currency: 'USD' });
  store.seedGrant({ secretId: CARD_ELSEWHERE, userId: USER, merchantOrigin: ELSEWHERE, merchantSite: merchantSiteOf(ELSEWHERE) });
  store.seedGrant({ secretId: CARD_EXPIRED, userId: USER, merchantOrigin: SHOP, merchantSite: merchantSiteOf(SHOP), expiresAt: new Date(Date.now() - day) });
  // A revoked grant does not count.
  store.seedGrant({ secretId: CARD_NO_GRANT, userId: USER, merchantOrigin: SHOP, merchantSite: merchantSiteOf(SHOP), revokedAt: new Date() });

  const audit = new InMemoryAudit();
  const notify = new RecordingNotify();
  const limiter = new InMemoryAgentRateLimiter();
  const settings = new FakeSettings({
    agentAccess: { enabled: true, cards: { enabled: true }, identity: { enabled: true }, ...settingsOver },
  });
  const prisma = {
    auditEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    oAuthClient: { findUnique: jest.fn().mockResolvedValue({ name: 'Agent App A' }) },
  };
  const notifier = new AgentNotifier(prisma as never, notify as never);
  const pipeline = new AgentCallPipeline(limiter, settings, audit);
  const svc = secrets as unknown as SecretsService;
  const credentials = new AgentCredentialsService(svc, pipeline, notifier);
  const cards = new AgentCardsService(svc, pipeline, notifier, store);
  const identity = new AgentIdentityService(svc, pipeline);
  const release = new AgentReleaseService(credentials, cards, identity);
  return {
    rows, store, audit, notify, limiter, secrets, release,
    cardsController: new AgentCardsController(release),
    agentController: new AgentController(credentials, release),
  };
}

type World = ReturnType<typeof world>;

/** One way in: what a test calls, whichever path. */
interface Driver {
  cardsLookup(origin: string): Promise<AgentCardSummary[]>;
  cardFill(id: string, body: Omit<AgentCardFillRequest, 'purpose'> & { purpose?: 'purchase' }): Promise<{ value: string }>;
  grantRequest(id: string, body: { origin: string; amount: number; currency: string; reason: string }): Promise<{ id: string; status: string }>;
  identityLookup(origin: string): Promise<AgentIdentitySummary[]>;
  identityFill(id: string, body: Omit<AgentIdentityFillRequest, 'purpose'>): Promise<{ value: string }>;
  lookup(origin: string): Promise<AgentCredentialSummary[]>;
  fill(id: string, body: { field: 'username' | 'password'; origin: string }): Promise<{ value: string }>;
}

const oauth: AuthCredentialInfo = {
  kind: 'oauth', tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', resourceId: 'agent',
  scopes: ['vault:cards_read', 'vault:cards_fill', 'vault:identity_read', 'vault:identity_fill', 'vault:items_fill'],
};

const drivers: Array<[string, (w: World) => Driver]> = [
  [
    'in process (AgentReleasePort)',
    (w) => {
      const ctx = { userId: USER, clientLabel: 'Host A' };
      return {
        cardsLookup: (origin) => w.release.cardsLookup({ ...ctx, origin }),
        cardFill: (id, body) => w.release.cardFill({ ...ctx, cardId: id, purpose: 'purchase', ...body }),
        grantRequest: (id, body) => w.release.cardGrantRequest({ ...ctx, cardId: id, ...body }),
        identityLookup: (origin) => w.release.identityLookup({ ...ctx, origin }),
        identityFill: (id, body) => w.release.identityFill({ ...ctx, identityId: id, purpose: 'form', ...body }),
        lookup: (origin) => w.release.lookup({ ...ctx, origin }),
        fill: (id, body) => w.release.fill({ ...ctx, secretId: id, purpose: 'login', ...body }),
      };
    },
  ],
  [
    'HTTP (controllers, oat_ token)',
    (w) => {
      const user = { id: USER } as never;
      const unwrap = async <T>(p: Promise<{ data: T }>) => (await p).data;
      return {
        cardsLookup: (origin) => unwrap(w.cardsController.cards({ origin }, user, oauth)),
        cardFill: (id, body) => unwrap(w.cardsController.cardFill(id, { purpose: 'purchase', ...body } as never, user, oauth)),
        grantRequest: (id, body) => unwrap(w.cardsController.grantRequest(id, body as never, user, oauth)),
        identityLookup: (origin) => unwrap(w.cardsController.identity({ origin }, user, oauth)),
        identityFill: (id, body) => unwrap(w.cardsController.identityFill(id, { purpose: 'form', ...body } as never, user, oauth)),
        lookup: (origin) => unwrap(w.agentController.lookup({ origin }, user, oauth)),
        fill: (id, body) => unwrap(w.agentController.fill(id, { purpose: 'login', ...body } as never, user, oauth)),
      };
    },
  ],
];

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code?: string; body: string; headers: Record<string, string> }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string };
      return { status: error.getStatus(), code: body.code, body: JSON.stringify(body), headers: { ...responseHeadersOf(error, {}) } };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

const buy = (over: Record<string, unknown> = {}) =>
  ({ field: 'number', origin: SHOP, amount: 25, currency: 'USD', ...over }) as Omit<AgentCardFillRequest, 'purpose'>;

describe.each(drivers)('agent release rules, %s', (_name, makeDriver) => {
  let w: World;
  let d: Driver;
  const use = (settings: Record<string, unknown> = {}) => {
    w = world(settings);
    d = makeDriver(w);
  };
  beforeEach(() => use());

  describe('card lookup', () => {
    it('lists only opened cards with a live grant for the merchant site, never the number or the code', async () => {
      const list = await d.cardsLookup(`${CHECKOUT}/cart?x=1`);
      expect(list).toEqual([
        {
          id: CARD, name: 'Card A', brand: 'Visa', last4: '4242', expMonth: '04', expYear: '2031',
          grant: { maxAmount: 100, currency: 'USD', includesSecurityCode: false, expiresAt: null },
        },
      ]);
      expect(JSON.stringify(list)).not.toContain(CANARY_NUMBER);
      expect(JSON.stringify(list)).not.toContain(CANARY_CODE);
    });

    it('lists nothing for a merchant without a grant', async () => {
      await expect(d.cardsLookup('https://unknown-shop.test')).resolves.toEqual([]);
    });
  });

  describe('card fill', () => {
    it('returns exactly one field per call, under the grant, on a subdomain of the merchant', async () => {
      await expect(d.cardFill(CARD, buy({ origin: CHECKOUT }))).resolves.toEqual({ value: CANARY_NUMBER });
      await expect(d.cardFill(CARD, buy({ field: 'expMonth' }))).resolves.toEqual({ value: '04' });
      await expect(d.cardFill(CARD, buy({ field: 'expYear' }))).resolves.toEqual({ value: '2031' });
      await expect(d.cardFill(CARD, buy({ field: 'holderName' }))).resolves.toEqual({ value: 'Person A' });
      await expect(d.cardFill(CARD, buy({ field: 'postalCode' }))).resolves.toEqual({ value: '00000' });
    });

    it('accepts an embedded payment frame on the grant list and records the amount in the audit row', async () => {
      await d.cardFill(CARD, buy({ frameOrigin: PAY_FRAME, amount: 42.5 }));
      const row = w.audit.events.at(-1)!;
      expect(row.action).toBe('agent.card.fill');
      expect(row.meta).toMatchObject({ result: 'ok', field: 'number', origin: SHOP, frameOrigin: PAY_FRAME, amount: '42.50', currency: 'USD' });
    });

    it.each([
      ['a missing card', MISSING],
      ['a foreign card', CARD_FOREIGN],
      ['a card not opened to agents', CARD_CLOSED],
      ['a card with no live grant at all (its only grant revoked)', CARD_NO_GRANT],
      ['a login, not a card', LOGIN],
    ])('answers the same 404 for %s', async (_label, id) => {
      const res = await refusal(d.cardFill(id, buy()));
      expect(res.status).toBe(404);
      expect(res.body).toBe((await refusal(d.cardFill(MISSING, buy()))).body);
    });

    it('the 404s are identical, body for body', async () => {
      const bodies = await Promise.all([MISSING, CARD_FOREIGN, CARD_CLOSED, CARD_NO_GRANT].map(async (id) => (await refusal(d.cardFill(id, buy()))).body));
      expect(new Set(bodies).size).toBe(1);
    });

    it.each([
      ['an amount over the grant', buy({ amount: 100.01 }), 'CARD_AMOUNT_EXCEEDED'],
      ['the wrong currency', buy({ currency: 'EUR' }), 'CARD_CURRENCY_MISMATCH'],
      ['another merchant (a look-alike site)', buy({ origin: 'https://shop-example.test' }), 'ORIGIN_MISMATCH'],
      ['a payment frame not on the list', buy({ frameOrigin: 'https://evil-pay.example.test' }), 'ORIGIN_MISMATCH'],
      ['the security code without the grant flag', buy({ field: 'securityCode' }), 'SECURITY_CODE_NOT_GRANTED'],
    ])('refuses %s with 403 %s and releases nothing', async (_label, body, code) => {
      const res = await refusal(d.cardFill(CARD, body as never));
      expect(res).toMatchObject({ status: 403, code });
      expect(res.body).not.toContain(CANARY_NUMBER);
      expect(w.store.releases).toHaveLength(0);
      expect(w.audit.events.at(-1)!.meta).toMatchObject({ result: expect.stringMatching(/^denied:/), secretId: CARD });
    });

    it('refuses an expired grant with 403 CARD_GRANT_EXPIRED', async () => {
      expect(await refusal(d.cardFill(CARD_EXPIRED, buy()))).toMatchObject({ status: 403, code: 'CARD_GRANT_EXPIRED' });
    });

    it('releases the security code when the grant includes it', async () => {
      w.store.grants.find((g) => g.secretId === CARD)!.includeSecurityCode = true;
      await expect(d.cardFill(CARD, buy({ field: 'securityCode' }))).resolves.toEqual({ value: CANARY_CODE });
    });

    it('counts a number fill against the period limit (releases and total amount)', async () => {
      const grant = w.store.grants.find((g) => g.secretId === CARD)!;
      Object.assign(grant, { period: 'day', periodMaxReleases: 2, periodMaxAmountMinor: null });
      await d.cardFill(CARD, buy());
      await d.cardFill(CARD, buy({ field: 'expMonth' })); // not a release
      await d.cardFill(CARD, buy());
      expect(await refusal(d.cardFill(CARD, buy()))).toMatchObject({ status: 403, code: 'CARD_PERIOD_LIMIT_REACHED' });

      use();
      Object.assign(w.store.grants.find((g) => g.secretId === CARD)!, { period: 'month', periodMaxReleases: null, periodMaxAmountMinor: 5_000 });
      await d.cardFill(CARD, buy({ amount: 30 }));
      // Splitting the purchase does not get around the total.
      expect(await refusal(d.cardFill(CARD, buy({ amount: 20.01 })))).toMatchObject({ status: 403, code: 'CARD_PERIOD_LIMIT_REACHED' });
      await expect(d.cardFill(CARD, buy({ amount: 20 }))).resolves.toEqual({ value: CANARY_NUMBER });
    });

    it('applies the per-card daily cap of releases across grants', async () => {
      use({ cards: { enabled: true, releasesPerCardPerDay: 2 } });
      await d.cardFill(CARD, buy());
      await d.cardFill(CARD, buy());
      expect(await refusal(d.cardFill(CARD, buy()))).toMatchObject({ status: 403, code: 'CARD_DAILY_CAP_REACHED' });
      expect(w.store.releases).toHaveLength(2);
    });

    it('has its own card_fill bucket, stricter than fill', async () => {
      use({ cards: { enabled: true, fillPerMinute: 2 } });
      await d.cardFill(CARD, buy({ field: 'expMonth' }));
      await d.cardFill(CARD, buy({ field: 'expYear' }));
      const res = await refusal(d.cardFill(CARD, buy({ field: 'expYear' })));
      expect(res).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
      expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
      // The login fill bucket is separate.
      await expect(d.fill(LOGIN, { field: 'username', origin: SHOP })).resolves.toEqual({ value: 'person-a' });
    });

    it('notifies the owner of the first release under a grant, once, and of a declined fill, throttled', async () => {
      await d.cardFill(CARD, buy());
      await d.cardFill(CARD, buy());
      const first = w.notify.sent.filter((n) => n.event === 'vault.agent_card_first_release');
      expect(first).toHaveLength(1);
      expect(first[0]!.data).toMatchObject({ secretId: CARD, secretName: 'Card A', origin: SHOP, amount: '25.00', currency: 'USD' });
      await refusal(d.cardFill(CARD, buy({ amount: 500 })));
      await refusal(d.cardFill(CARD, buy({ amount: 600 })));
      const declined = w.notify.sent.filter((n) => n.event === 'vault.agent_card_declined');
      expect(declined).toHaveLength(1);
      expect(declined[0]!.data).toMatchObject({ reason: 'amount_exceeded', secretName: 'Card A' });
      expect(JSON.stringify(w.notify.sent)).not.toContain(CANARY_NUMBER);
    });
  });

  describe('kill switches', () => {
    it.each([
      [{ enabled: false }, 'AGENT_ACCESS_DISABLED'],
      [{ cards: { enabled: false } }, 'CARD_ACCESS_DISABLED'],
    ])('%p closes every card route with %s', async (settings, code) => {
      use(settings);
      for (const call of [
        () => d.cardsLookup(SHOP),
        () => d.cardFill(CARD, buy()),
        () => d.grantRequest(CARD, { origin: SHOP, amount: 5, currency: 'USD', reason: 'Order 1' }),
      ]) {
        expect(await refusal(call())).toMatchObject({ status: 403, code });
      }
      expect(w.secrets.readCurrentValues).not.toHaveBeenCalled();
    });

    it.each([
      [{ enabled: false }, 'AGENT_ACCESS_DISABLED'],
      [{ identity: { enabled: false } }, 'IDENTITY_ACCESS_DISABLED'],
    ])('%p closes every identity route with %s', async (settings, code) => {
      use(settings);
      expect(await refusal(d.identityLookup(FORM))).toMatchObject({ status: 403, code });
      expect(await refusal(d.identityFill(IDENTITY, { field: 'full_name', origin: FORM }))).toMatchObject({ status: 403, code });
    });

    it('the card switch leaves logins alone', async () => {
      use({ cards: { enabled: false } });
      await expect(d.lookup(SHOP)).resolves.toHaveLength(1);
    });
  });

  describe('grant requests', () => {
    it('creates a pending request, notifies the owner, returns no card data, and dedupes a second ask', async () => {
      const first = await d.grantRequest(CARD_NO_GRANT, { origin: `${SHOP}/checkout`, amount: 80, currency: 'usd', reason: 'Order for Person A' });
      expect(first).toEqual({ id: expect.any(String), status: 'pending' });
      expect(JSON.stringify(first)).not.toContain('4242');
      expect(w.store.requests).toHaveLength(1);
      expect(w.store.requests[0]).toMatchObject({ origin: SHOP, merchantSite: merchantSiteOf(SHOP), amountMinor: 8_000, currency: 'USD' });
      const sent = w.notify.sent.filter((n) => n.event === 'vault.agent_card_grant_requested');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.data).toMatchObject({ secretId: CARD_NO_GRANT, amount: '80.00', currency: 'USD', reason: 'Order for Person A' });
      await expect(d.grantRequest(CARD_NO_GRANT, { origin: CHECKOUT, amount: 90, currency: 'USD', reason: 'Again' })).resolves.toEqual(first);
      expect(w.store.requests).toHaveLength(1);
      expect(w.notify.sent.filter((n) => n.event === 'vault.agent_card_grant_requested')).toHaveLength(1);
    });

    it('answers 404 for a card that is not opened, and creates nothing', async () => {
      expect((await refusal(d.grantRequest(CARD_CLOSED, { origin: SHOP, amount: 5, currency: 'USD', reason: 'x' }))).status).toBe(404);
      expect(w.store.requests).toHaveLength(0);
    });
  });

  describe('identity', () => {
    it('lists opened items with labels and what is fillable on the origin, never a value', async () => {
      const [item] = await d.identityLookup('https://elsewhere.example.test');
      expect(item).toMatchObject({ id: IDENTITY, name: 'Identity A', originAllowed: false });
      expect(item!.fields.find((f) => f.field === 'id_number')).toEqual({ field: 'id_number', label: 'ID Number', sensitive: true, fillable: false });
      expect(item!.fields.find((f) => f.field === 'full_name')).toMatchObject({ sensitive: false, fillable: true });
      expect(item!.fields.map((f) => f.field)).not.toContain('notes');
      expect(JSON.stringify(item)).not.toContain(CANARY_ID_NUMBER);
      const [allowed] = await d.identityLookup(FORM);
      expect(allowed!.originAllowed).toBe(true);
    });

    it('fills a non-sensitive field anywhere and a sensitive one only on an allowed origin', async () => {
      await expect(d.identityFill(IDENTITY, { field: 'full_name', origin: 'https://any.example.test' })).resolves.toEqual({ value: 'Person A' });
      expect(await refusal(d.identityFill(IDENTITY, { field: 'id_number', origin: 'https://any.example.test' }))).toMatchObject({
        status: 403, code: 'ORIGIN_MISMATCH',
      });
      await expect(d.identityFill(IDENTITY, { field: 'id_number', origin: `${FORM}/apply` })).resolves.toEqual({ value: CANARY_ID_NUMBER });
    });

    it('answers 404 for an empty field, a closed item and a card', async () => {
      expect((await refusal(d.identityFill(IDENTITY, { field: 'phone', origin: FORM }))).status).toBe(404);
      w.rows.get(IDENTITY)!.agentAccess = 'none';
      expect((await refusal(d.identityFill(IDENTITY, { field: 'full_name', origin: FORM }))).status).toBe(404);
      expect((await refusal(d.identityFill(CARD, { field: 'full_name', origin: FORM }))).status).toBe(404);
    });

    it('has its own identity_fill bucket', async () => {
      use({ identity: { enabled: true, fillPerMinute: 1 } });
      await d.identityFill(IDENTITY, { field: 'full_name', origin: FORM });
      expect(await refusal(d.identityFill(IDENTITY, { field: 'city', origin: FORM }))).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    });
  });

  describe('logins through the same port', () => {
    it('looks up and fills a login', async () => {
      await expect(d.lookup(SHOP)).resolves.toMatchObject([{ id: LOGIN, username: 'person-a' }]);
      await expect(d.fill(LOGIN, { field: 'password', origin: SHOP })).resolves.toEqual({ value: CANARY_PASSWORD });
    });
  });

  it('CANARY: no card number, security code, id number or password in any audit row, notification or refusal body', async () => {
    const bodies: string[] = [];
    const attempt = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (error) {
        bodies.push(JSON.stringify(error instanceof HttpException ? error.getResponse() : String(error)));
      }
    };
    w.store.grants.find((g) => g.secretId === CARD)!.includeSecurityCode = true;
    await attempt(d.cardFill(CARD, buy()));
    await attempt(d.cardFill(CARD, buy({ field: 'securityCode' })));
    await attempt(d.cardFill(CARD, buy({ amount: 1_000 })));
    await attempt(d.cardFill(CARD, buy({ origin: ELSEWHERE })));
    await attempt(d.cardFill(CARD_EXPIRED, buy()));
    await attempt(d.cardsLookup(SHOP));
    await attempt(d.grantRequest(CARD_ELSEWHERE, { origin: SHOP, amount: 9, currency: 'USD', reason: 'Order 7' }));
    await attempt(d.identityFill(IDENTITY, { field: 'id_number', origin: FORM }));
    await attempt(d.identityFill(IDENTITY, { field: 'id_number', origin: ELSEWHERE }));
    await attempt(d.fill(LOGIN, { field: 'password', origin: SHOP }));
    const trail = JSON.stringify([w.audit.events, w.notify.sent, bodies]);
    for (const canary of [CANARY_NUMBER, CANARY_CODE, CANARY_ID_NUMBER, CANARY_PASSWORD]) expect(trail).not.toContain(canary);
    expect(w.audit.events.length).toBeGreaterThanOrEqual(10);
  });
});

describe('agent release caller kinds', () => {
  it('refuses an in-process call without a client label and an HTTP call with a browser session', async () => {
    const w = world();
    expect(await refusal(w.release.cardsLookup({ userId: USER, clientLabel: '  ', origin: SHOP }))).toMatchObject({
      status: 403, code: 'AGENT_CREDENTIAL_REQUIRED',
    });
    expect(await refusal(w.cardsController.cards({ origin: SHOP }, { id: USER } as never, { kind: 'jwt' }))).toMatchObject({
      status: 403, code: 'AGENT_CREDENTIAL_REQUIRED',
    });
    expect(await refusal(w.cardsController.cards({ origin: SHOP }, { id: USER } as never, null))).toMatchObject({
      status: 403, code: 'AGENT_CREDENTIAL_REQUIRED',
    });
  });

  it('audits an in-process call as embedded with its label, and an HTTP call with its OAuth client', async () => {
    const w = world();
    await w.release.cardsLookup({ userId: USER, clientLabel: 'Host A', origin: SHOP });
    expect(w.audit.events.at(-1)!.meta).toMatchObject({ credential: 'embedded', clientLabel: 'Host A', result: 'ok' });
    await w.cardsController.cards({ origin: SHOP }, { id: USER } as never, oauth);
    expect(w.audit.events.at(-1)!.meta).toMatchObject({ credential: 'oauth', clientId: 'client-1', result: 'ok' });
  });

  it('rate-limits an in-process host by its label and user', async () => {
    const w = world({ cards: { enabled: true, fillPerMinute: 1 } });
    await w.release.cardFill({ userId: USER, clientLabel: 'Host A', cardId: CARD, purpose: 'purchase', ...buy({ field: 'expMonth' }) });
    expect(await refusal(w.release.cardFill({ userId: USER, clientLabel: 'Host A', cardId: CARD, purpose: 'purchase', ...buy({ field: 'expMonth' }) }))).toMatchObject({ status: 429 });
    await expect(w.release.cardFill({ userId: USER, clientLabel: 'Host B', cardId: CARD, purpose: 'purchase', ...buy({ field: 'expMonth' }) })).resolves.toEqual({ value: '04' });
  });

  it('validates an in-process body with the route schema (400), never echoing the value', async () => {
    const w = world();
    const res = await refusal(w.release.cardFill({ userId: USER, clientLabel: 'Host A', cardId: CARD, field: 'cvv' as never, origin: SHOP, amount: 1, currency: 'USD', purpose: 'purchase' }));
    expect(res.status).toBe(400);
    const res2 = await refusal(w.release.cardFill({ userId: USER, clientLabel: 'Host A', cardId: CARD, field: 'number', origin: SHOP, amount: -5, currency: CANARY_NUMBER, purpose: 'purchase' }));
    expect(res2.status).toBe(400);
    expect(res2.body).not.toContain(CANARY_NUMBER);
  });
});
