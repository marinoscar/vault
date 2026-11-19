// =============================================================================
// Agent release of cards and identity over real Postgres (ADR-0003, issue #195)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, the OAuth server and a
// REAL authorization-code + PKCE flow that yields `oat_` tokens for the `agent` resource. Proves,
// end to end over HTTP:
//
//   - scopes: vault:items_* reaches no card or identity route (403 insufficient_scope); the card
//     and identity scopes do;
//   - the switches: agentAccess.cards.enabled and agentAccess.identity.enabled default OFF;
//   - opening a card or an identity item, and every grant and request write, refuse oat_ and pat_
//     (OWNER_SESSION_REQUIRED, or route confinement for oat_);
//   - a grant request is pending, notifies the owner, returns no card data; approval creates exactly
//     the requested grant; a fill then works within it and is refused above it;
//   - the release ledger in Postgres: period limit and the per-card daily cap;
//   - CANARY: a card number, a security code and an identity number appear in no log line, console
//     line, audit row, notification row or error body.
//
// Test cards are the well-known test PAN; people and shops are invented.
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import {
  AuthService,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PRINCIPAL_USER_INCLUDE,
} from '@marinoscar/platform-api/identity';
import {
  createOAuthTestClient,
  exchangeOAuthCode,
  runOAuthAuthorizationCodeFlow,
} from '@marinoscar/platform-api/identity/testing';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const DAY = 24 * 3600 * 1000;

const SHOP = 'https://shop.example.test';
const CHECKOUT = 'https://checkout.shop.example.test';
const FORM = 'https://form.example.test';
const CANARY_NUMBER = '4242424242424242';
const CANARY_CODE = 'cvc-canary-7319';
const CANARY_ID_NUMBER = 'id-canary-X5521';
const CARD_SCOPES = ['vault:cards_read', 'vault:cards_fill', 'vault:identity_read', 'vault:identity_fill'];

describeWithDb('Agent release of cards and identity (real Postgres, ADR-0003)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let userId = '';
  let session = '';
  let pat = '';
  let cardTypeId = '';
  let identityTypeId = '';
  let oat = '';
  let itemsOat = '';
  let cardId = '';
  let identityId = '';
  const savedEnv: Record<string, string | undefined> = {};
  const lines: string[] = [];
  const bodies: string[] = [];
  const restores: Array<() => void> = [];
  let notifySpy: jest.SpyInstance;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = () => app.get(SystemSettingsService);

  const agent = async (method: 'get' | 'post', path: string, token: string, body?: object) => {
    const req = http()[method](`/api/agent/v1${path}`).set(bearer(token));
    const res = await (method === 'get' ? req : req.send(body ?? {}));
    bodies.push(JSON.stringify({ method, path, status: res.status, body: res.body }));
    return res;
  };
  const owner = async (method: 'get' | 'post' | 'delete' | 'patch', path: string, token: string, body?: object) => {
    const req = http()[method](`/api${path}`).set(bearer(token));
    const res = await (method === 'get' || method === 'delete' ? req : req.send(body ?? {}));
    bodies.push(JSON.stringify({ method, path, status: res.status, body: res.body }));
    return res;
  };

  async function createUser(email: string) {
    const orgId = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({ data: { email, providerDisplayName: 'Person A', isActive: true } });
    await prisma.membership.create({ data: { userId: user.id, orgId, roleId: role.id, status: 'active' } });
    const graph = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId });
    return { id: user.id, session: tokens.accessToken };
  }

  async function createPat(forUser: string) {
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: forUser, name: 'script', tokenHash: sha256(raw), tokenPrefix: raw.slice(0, 8),
        durationValue: 30, durationUnit: 'days', expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
    return raw;
  }

  async function oauthToken(scopes: string[], appUrl: string) {
    const made = await createOAuthTestClient(prisma as never, { tokenEndpointAuthMethod: 'client_secret_post' });
    const flow = await runOAuthAuthorizationCodeFlow(app, {
      client: made, user: { sessionToken: session }, scopes, resource: `${appUrl}/api/agent/v1`,
    });
    const exchanged = await exchangeOAuthCode(app, { client: made, code: flow.code!, verifier: flow.pkce.verifier });
    expect(exchanged.status).toBe(200);
    return exchanged.body.access_token as string;
  }

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();
    await seedPlatform(
      prisma as unknown as SeedPrisma,
      platformSeedInputFrom(
        { permissions: platformPermissionCatalog(PERMISSION_OPTIONS), settings: DEFAULT_SYSTEM_SETTINGS },
        { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' },
      ),
    );
    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'INITIAL_ADMIN_EMAIL']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env, { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' });
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const record = (level: string) => (...args: unknown[]) =>
      void lines.push(`${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    Logger.overrideLogger({ log: record('log'), error: record('error'), warn: record('warn'), debug: record('debug'), verbose: record('verbose'), fatal: record('fatal') });
    restores.push(() => Logger.overrideLogger(new ConsoleLogger()));
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        lines.push(`raw ${String(chunk)}`);
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      restores.push(() => void (stream.write = original as typeof stream.write));
    }
    notifySpy = jest.spyOn(app.get(NotificationsService), 'notify');

    const appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    jest.spyOn(app.get(OAuthRateLimitService), 'consume').mockImplementation(() => ({ allowed: true, retryAfterSeconds: 0 }));

    ({ id: userId, session } = await createUser('card-owner@example.test'));
    pat = await createPat(userId);
    for (const name of ['Card', 'Identity'] as const) {
      const def = SYSTEM_SECRET_TYPES.find((t) => t.name === name)!;
      const row = await prisma.secretType.create({
        data: { name, isSystem: true, fields: def.fields as never, allowAttachments: def.allowAttachments },
      });
      if (name === 'Card') cardTypeId = row.id;
      else identityTypeId = row.id;
    }

    await settings().patchSettings({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } } as never, userId);
    app.get(OAuthServerSettingsReader).invalidate();
    oat = await oauthToken(CARD_SCOPES, appUrl);
    itemsOat = await oauthToken(['vault:items_read', 'vault:items_fill'], appUrl);
  }, 240_000);

  afterAll(async () => {
    restores.forEach((restore) => restore());
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const buy = (over: Record<string, unknown> = {}) => ({
    field: 'number', origin: SHOP, amount: 25, currency: 'USD', purpose: 'purchase', ...over,
  });

  it('seeds a card and an identity item; opening them needs the owner\'s session, never a token', async () => {
    const card = await owner('post', '/secrets', session, {
      name: 'Card A', typeId: cardTypeId,
      data: { cardholder_name: 'Person A', number: CANARY_NUMBER, exp_month: '04', exp_year: '2031', cvv: CANARY_CODE, card_network: 'Visa' },
    });
    expect(card.status).toBe(201);
    cardId = card.body.data.id;
    const identity = await owner('post', '/secrets', session, {
      name: 'Identity A', typeId: identityTypeId, data: { full_name: 'Person A', id_number: CANARY_ID_NUMBER, city: 'Town B' },
    });
    expect(identity.status).toBe(201);
    identityId = identity.body.data.id;

    const byPat = await owner('patch', `/secrets/${cardId}/agent-access`, pat, { agentAccess: 'fill' });
    expect(byPat.status).toBe(403);
    expect(byPat.body.code).toBe('OWNER_SESSION_REQUIRED');
    expect((await owner('patch', `/secrets/${cardId}/agent-access`, oat, { agentAccess: 'fill' })).status).toBe(403);

    expect((await owner('patch', `/secrets/${cardId}/agent-access`, session, { agentAccess: 'fill' })).body.data.agentAccess).toBe('fill');
    const opened = await owner('patch', `/secrets/${identityId}/agent-access`, session, { agentAccess: 'fill', allowedOrigins: [`${FORM}/apply`] });
    expect(opened.status).toBe(200);
    expect(opened.body.data.agentOrigins).toEqual([FORM]);
  });

  it('both switches are OFF by default; scopes keep login tokens out', async () => {
    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
    const cards = await agent('get', `/cards?origin=${encodeURIComponent(SHOP)}`, oat);
    expect([cards.status, cards.body.code]).toEqual([403, 'CARD_ACCESS_DISABLED']);
    expect(cards.headers['cache-control']).toBe('no-store');
    const ident = await agent('get', `/identity?origin=${encodeURIComponent(FORM)}`, oat);
    expect([ident.status, ident.body.code]).toEqual([403, 'IDENTITY_ACCESS_DISABLED']);

    await settings().patchSettings({ agentAccess: { cards: { enabled: true }, identity: { enabled: true } } } as never, userId);
    const stored = await settings().getSettings();
    expect((stored as { agentAccess: { cards: unknown } }).agentAccess.cards).toEqual({ enabled: true, fillPerMinute: 10, releasesPerCardPerDay: 5 });
    // The rest of this file makes more card fills than the default per-minute limit; the limit itself is proven in the package spec.
    await settings().patchSettings({ agentAccess: { cards: { fillPerMinute: 600 } } } as never, userId);

    for (const [method, path, body] of [
      ['get', `/cards?origin=${encodeURIComponent(SHOP)}`, undefined],
      ['post', `/cards/${cardId}/fill`, buy()],
      ['post', `/cards/${cardId}/grant-requests`, { origin: SHOP, amount: 5, currency: 'USD', reason: 'x' }],
      ['get', `/identity?origin=${encodeURIComponent(FORM)}`, undefined],
      ['post', `/identity/${identityId}/fill`, { field: 'full_name', origin: FORM, purpose: 'form' }],
    ] as const) {
      const res = await agent(method, path, itemsOat, body);
      expect([path, res.status]).toEqual([path, 403]);
      expect(`${res.headers['www-authenticate'] ?? ''} ${JSON.stringify(res.body)}`).toMatch(/insufficient_scope|Insufficient scope/i);
    }
  });

  it('a card with no grant is not listed and not fillable (404)', async () => {
    expect((await agent('get', `/cards?origin=${encodeURIComponent(SHOP)}`, oat)).body.data).toEqual([]);
    expect((await agent('post', `/cards/${cardId}/fill`, oat, buy())).status).toBe(404);
  });

  let requestId = '';

  it('a grant request is pending, notifies the owner and returns no card data', async () => {
    const res = await agent('post', `/cards/${cardId}/grant-requests`, oat, { origin: `${CHECKOUT}/pay`, amount: 80, currency: 'usd', reason: 'Order for Person A' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: expect.any(String), status: 'pending' });
    requestId = res.body.data.id;
    expect(JSON.stringify(res.body)).not.toContain('4242');
    const notified = notifySpy.mock.calls.filter(([event]) => event === 'vault.agent_card_grant_requested');
    expect(notified).toHaveLength(1);
    expect(notified[0]![1]).toBe(userId);
    expect(notified[0]![2]).toMatchObject({ secretId: cardId, amount: '80.00', currency: 'USD', reason: 'Order for Person A' });

    const list = await owner('get', `/secrets/${cardId}/card-grant-requests?status=pending`, session);
    expect(list.body.data).toEqual([expect.objectContaining({ id: requestId, origin: CHECKOUT, amount: 80, currency: 'USD', status: 'pending' })]);
  });

  it('every grant and request write refuses an oat_ (route confinement) and a pat_ (OWNER_SESSION_REQUIRED)', async () => {
    const writes: Array<['post' | 'delete', string, object?]> = [
      ['post', `/secrets/${cardId}/card-grants`, { merchantOrigin: SHOP, maxAmount: 1_000_000, currency: 'USD', includeSecurityCode: true }],
      ['post', `/secrets/${cardId}/card-grant-requests/${requestId}/approve`],
      ['post', `/secrets/${cardId}/card-grant-requests/${requestId}/decline`],
      ['delete', `/secrets/${cardId}/card-grants/3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b`],
    ];
    for (const [method, path, body] of writes) {
      const byPat = await owner(method, path, pat, body);
      expect([path, byPat.status, byPat.body.code]).toEqual([path, 403, 'OWNER_SESSION_REQUIRED']);
      const byOat = await owner(method, path, oat, body);
      expect([path, byOat.status]).toEqual([path, 403]);
    }
    expect(await prisma.agentCardGrant.count()).toBe(0);
    expect((await prisma.agentCardGrantRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('pending');
  });

  it('approval creates exactly the requested grant; a fill then works within it and is refused above it', async () => {
    const res = await owner('post', `/secrets/${cardId}/card-grant-requests/${requestId}/approve`, session);
    expect(res.status).toBe(200);
    expect(res.body.data.grant).toMatchObject({
      merchantOrigin: CHECKOUT, merchantSite: 'example.test', frameOrigins: [], maxAmount: 80, currency: 'USD',
      periodLimit: null, expiresAt: null, includeSecurityCode: false, status: 'active',
    });
    expect(await prisma.agentCardGrant.count()).toBe(1);

    const listed = await agent('get', `/cards?origin=${encodeURIComponent(SHOP)}`, oat);
    expect(listed.body.data).toEqual([{
      id: cardId, name: 'Card A', brand: 'Visa', last4: '4242', expMonth: '04', expYear: '2031',
      grant: { maxAmount: 80, currency: 'USD', includesSecurityCode: false, expiresAt: null },
    }]);
    const fill = await agent('post', `/cards/${cardId}/fill`, oat, buy({ origin: SHOP }));
    expect(fill.status).toBe(200);
    expect(fill.body.data).toEqual({ value: CANARY_NUMBER });
    expect(fill.headers['cache-control']).toBe('no-store');
    expect(notifySpy.mock.calls.filter(([event]) => event === 'vault.agent_card_first_release')).toHaveLength(1);

    for (const [body, code] of [
      [buy({ amount: 80.01 }), 'CARD_AMOUNT_EXCEEDED'],
      [buy({ currency: 'EUR' }), 'CARD_CURRENCY_MISMATCH'],
      [buy({ field: 'securityCode' }), 'SECURITY_CODE_NOT_GRANTED'],
      [buy({ origin: 'https://shop-example.test' }), 'ORIGIN_MISMATCH'],
      [buy({ frameOrigin: 'https://pay.example.test' }), 'ORIGIN_MISMATCH'],
    ] as const) {
      const res2 = await agent('post', `/cards/${cardId}/fill`, oat, body);
      expect([code, res2.status, res2.body.code]).toEqual([code, 403, code]);
    }
    expect(notifySpy.mock.calls.filter(([event]) => event === 'vault.agent_card_declined').length).toBeGreaterThanOrEqual(1);
  });

  it('the owner\'s grant with a period limit and the per-card daily cap hold in Postgres', async () => {
    const grants = await owner('get', `/secrets/${cardId}/card-grants`, session);
    await owner('delete', `/secrets/${cardId}/card-grants/${grants.body.data[0].id}`, session);
    const created = await owner('post', `/secrets/${cardId}/card-grants`, session, {
      merchantOrigin: SHOP, frameOrigins: ['https://pay.example.test'], maxAmount: 100, currency: 'USD',
      periodLimit: { period: 'day', maxReleases: 2 }, includeSecurityCode: true,
    });
    expect(created.status).toBe(201);
    expect((await owner('post', `/secrets/${cardId}/card-grants`, session, { merchantOrigin: CHECKOUT, maxAmount: 5, currency: 'USD' })).body.code)
      .toBe('CARD_GRANT_EXISTS');

    expect((await agent('post', `/cards/${cardId}/fill`, oat, buy({ field: 'securityCode', frameOrigin: 'https://pay.example.test' }))).body.data)
      .toEqual({ value: CANARY_CODE });
    expect((await agent('post', `/cards/${cardId}/fill`, oat, buy())).status).toBe(200);
    expect((await agent('post', `/cards/${cardId}/fill`, oat, buy())).status).toBe(200);
    const limited = await agent('post', `/cards/${cardId}/fill`, oat, buy());
    expect([limited.status, limited.body.code]).toEqual([403, 'CARD_PERIOD_LIMIT_REACHED']);

    const usage = (await owner('get', `/secrets/${cardId}/card-grants`, session)).body.data[0];
    expect(usage.usage).toMatchObject({ periodReleases: 2, periodAmount: 50, totalReleases: 2 });

    // Today the card already has 3 releases (1 under the approved grant, 2 under this one): cap it at 3.
    await settings().patchSettings({ agentAccess: { cards: { releasesPerCardPerDay: 3 } } } as never, userId);
    await owner('delete', `/secrets/${cardId}/card-grants/${usage.id}`, session);
    await owner('post', `/secrets/${cardId}/card-grants`, session, { merchantOrigin: SHOP, maxAmount: 100, currency: 'USD' });
    const capped = await agent('post', `/cards/${cardId}/fill`, oat, buy());
    expect([capped.status, capped.body.code]).toEqual([403, 'CARD_DAILY_CAP_REACHED']);
    expect(await prisma.agentCardRelease.count({ where: { secretId: cardId } })).toBe(3);
  });

  it('identity: non-sensitive fields anywhere, the id number only on an allowed origin', async () => {
    const list = await agent('get', `/identity?origin=${encodeURIComponent(FORM)}`, oat);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: identityId, originAllowed: true });
    expect((await agent('post', `/identity/${identityId}/fill`, oat, { field: 'full_name', origin: 'https://any.example.test', purpose: 'form' })).body.data)
      .toEqual({ value: 'Person A' });
    const refused = await agent('post', `/identity/${identityId}/fill`, oat, { field: 'id_number', origin: 'https://any.example.test', purpose: 'form' });
    expect([refused.status, refused.body.code]).toEqual([403, 'ORIGIN_MISMATCH']);
    expect((await agent('post', `/identity/${identityId}/fill`, oat, { field: 'id_number', origin: FORM, purpose: 'form' })).body.data)
      .toEqual({ value: CANARY_ID_NUMBER });
  });

  it('activity shows card calls with the merchant, the field and the amount', async () => {
    const res = await owner('get', '/agent-activity?action=card_fill&pageSize=100', session);
    expect(res.status).toBe(200);
    const ok = res.body.data.find((item: { result: string; field: string }) => item.result === 'ok' && item.field === 'number');
    expect(ok).toMatchObject({ action: 'card_fill', origin: SHOP, amount: '25.00', currency: 'USD', credentialKind: 'oauth' });
    const denied = res.body.data.find((item: { reason?: string }) => item.reason === 'amount_exceeded');
    expect(denied).toMatchObject({ amount: '80.01' });
  });

  it('switching cards off closes every card route again', async () => {
    await settings().patchSettings({ agentAccess: { cards: { enabled: false } } } as never, userId);
    const res = await agent('post', `/cards/${cardId}/fill`, oat, buy());
    expect([res.status, res.body.code]).toEqual([403, 'CARD_ACCESS_DISABLED']);
    await settings().patchSettings({ agentAccess: { cards: { enabled: true } } } as never, userId);
  });

  it('CANARY: no card number, security code or identity number in any log line, audit row, notification or error body', async () => {
    const needles = [CANARY_NUMBER, CANARY_CODE, CANARY_ID_NUMBER];
    const audit = JSON.stringify(await prisma.auditEvent.findMany());
    const notifications = JSON.stringify(notifySpy.mock.calls);
    // Every response except the successful fills, which are SUPPOSED to carry one value, and the owner's own
    // session reads of the card itself (POST /api/secrets and a successful PATCH .../agent-access return the detail).
    const nonFill = bodies
      .filter((b) => !(/"status":200,/.test(b) && /\/fill"/.test(b)))
      .filter((b) => !/"path":"\/secrets"/.test(b))
      .filter((b) => !(/"status":200,/.test(b) && /\/agent-access"/.test(b)))
      .join('\n');
    for (const [where, text] of [['audit', audit], ['logs', lines.join('\n')], ['notifications', notifications], ['other responses', nonFill]] as const) {
      for (const needle of needles) expect([where, needle, text.includes(needle)]).toEqual([where, needle, false]);
    }
    // The number did go out, once per successful number fill, in its own response.
    expect(bodies.filter((b) => b.includes(CANARY_NUMBER)).length).toBeGreaterThanOrEqual(3);
  });
});
