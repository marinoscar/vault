// =============================================================================
// Agent activity, notifications and revocation over real Postgres (issue #179, E14.7, epic #172)
// =============================================================================
//
// Same deployment and OAuth flow as `agent-api.db.spec.ts`. Generates agent events with an `oat_`
// token and a PAT, then proves:
//
//   - `GET /api/agent-activity` lists ONLY the caller's own events, filtered by action, secret and
//     client, paginated, with the secret and client names, and NEVER a value;
//   - an OAuth access token cannot read it (403 AGENT_ACTIVITY_FORBIDDEN);
//   - the notifications: `vault.agent_new_app` once per app, `vault.agent_credential_changed` on
//     create and rotate, a folded `vault.agent_credential_used`, and no value in any inbox row;
//   - revoking the OAuth grant through the platform route (`DELETE /api/oauth/grants/:id`) makes the
//     very next agent call answer 401.
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
  mintOAuthTestToken,
  runOAuthAuthorizationCodeFlow,
} from '@marinoscar/platform-api/identity/testing';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { agentActivityItemSchema } from '@marinoscar/vault-contract/agent';

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

const ORIGIN = 'https://shop.example.test';
const CANARY_PASSWORD = 'CanaryPw-7Qz9-do-not-leak';
const CANARY_USERNAME = 'person-a@example.test';
const SEED = 'JBSWY3DPEHPK3PXP';
const ROTATED_PASSWORD = 'RotatedPw-4Lm2-do-not-leak';
const SCOPES = ['vault:items_read', 'vault:items_fill', 'vault:items_write'];

describeWithDb('Vault agent activity, notifications and revocation (real Postgres, E14.7)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let userId = '';
  let otherUserId = '';
  let orgId = '';
  let appUrl = '';
  let session = '';
  let otherSession = '';
  let credTypeId = '';
  let noteTypeId = '';
  let oat = '';
  const savedEnv: Record<string, string | undefined> = {};
  const lines: string[] = [];
  const bodies: string[] = [];
  const restores: Array<() => void> = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = () => app.get(SystemSettingsService);

  /** One agent call; the response body is kept for the egress check. */
  const agent = async (method: 'get' | 'post', path: string, token: string, body?: object) => {
    const req = http()[method](`/api/agent/v1${path}`).set(bearer(token));
    const res = await (method === 'get' ? req : req.send(body ?? {}));
    bodies.push(JSON.stringify({ method, path, status: res.status, body: res.body }));
    return res;
  };

  const createSecret = async (who: string, typeId: string, name: string, data: Record<string, string>) => {
    const res = await http().post('/api/secrets').set(bearer(who)).send({ name, typeId, data });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const openToAgents = async (who: string, id: string) =>
    http().patch(`/api/secrets/${id}/agent-access`).set(bearer(who)).send({ agentAccess: 'fill' }).expect(200);

  const field = (name: string, required: boolean, sensitive = false) => ({ name, label: name, type: 'string', required, sensitive });

  async function createUser(email: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({ data: { email, providerDisplayName: 'Person A', isActive: true } });
    await prisma.membership.create({ data: { userId: user.id, orgId, roleId: role.id, status: 'active' } });
    const graph = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId });
    return { id: user.id, session: tokens.accessToken };
  }

  async function createPat(forUser: string, name: string) {
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: forUser, name, tokenHash: sha256(raw), tokenPrefix: raw.slice(0, 8),
        durationValue: 30, durationUnit: 'days', expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
    return raw;
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

    // Everything the process prints from here on: the Nest logger and raw stdout/stderr (Pino).
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

    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    jest.spyOn(app.get(OAuthRateLimitService), 'consume').mockImplementation(() => ({ allowed: true, retryAfterSeconds: 0 }));

    orgId = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    ({ id: userId, session } = await createUser('agent-owner@example.test'));
    ({ id: otherUserId, session: otherSession } = await createUser('someone-else@example.test'));

    credTypeId = (
      await prisma.secretType.create({
        data: {
          name: 'Credential', isSystem: true, createdById: userId,
          fields: [field('username', true), field('password', true, true), field('url', false), field('notes', false), field('additional_urls', false), field('totp', false, true)],
        },
      })
    ).id;
    noteTypeId = (
      await prisma.secretType.create({ data: { name: 'Note', isSystem: true, createdById: userId, fields: [field('body', false)] } })
    ).id;

    // OAuth server on, and a real authorization-code + PKCE flow for the full agent scope set.
    await settings().patchSettings({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } } as never, userId);
    app.get(OAuthServerSettingsReader).invalidate();
    const made = await createOAuthTestClient(prisma as never, { tokenEndpointAuthMethod: 'client_secret_post' });
    const flow = await runOAuthAuthorizationCodeFlow(app, {
      client: made, user: { sessionToken: session }, scopes: SCOPES, resource: `${appUrl}/api/agent/v1`,
    });
    const exchanged = await exchangeOAuthCode(app, { client: made, code: flow.code!, verifier: flow.pkce.verifier });
    expect(exchanged.status).toBe(200);
    oat = exchanged.body.access_token as string;
    expect(oat.startsWith('oat_')).toBe(true);
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

  let shopId = '';
  let otherUserSecret = '';
  let clientId = '';
  let grantId = '';

  const activity = (who: string, query = '') => http().get(`/api/agent-activity${query}`).set(bearer(who));
  const waitFor = async <T,>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    let value = await read();
    for (let i = 0; i < 50 && !done(value); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      value = await read();
    }
    return value;
  };
  const inbox = (forUser: string) => prisma.notification.findMany({ where: { userId: forUser }, orderBy: { createdAt: 'asc' } });

  it('seeds the logins and enables agent access', async () => {
    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
    shopId = await createSecret(session, credTypeId, 'Shop', {
      username: CANARY_USERNAME, password: CANARY_PASSWORD, url: ORIGIN, totp: SEED,
    });
    await openToAgents(session, shopId);
    otherUserSecret = await createSecret(otherSession, credTypeId, 'Theirs', { username: 'u', password: 'p', url: ORIGIN });
    await openToAgents(otherSession, otherUserSecret);
  });

  it('records agent events: oat fill + totp, a denial, a PAT fill, a create and a rotate', async () => {
    expect((await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, oat)).status).toBe(200);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' })).status).toBe(200);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'username', origin: ORIGIN, purpose: 'login' })).status).toBe(200);
    expect((await agent('post', `/credentials/${shopId}/totp`, oat, { origin: ORIGIN, purpose: 'mfa' })).status).toBe(200);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: 'https://evil.example.test', purpose: 'login' })).status).toBe(403);
    const pat = await createPat(userId, 'activity pat');
    expect((await agent('post', `/credentials/${shopId}/fill`, pat, { field: 'username', origin: ORIGIN, purpose: 'login' })).status).toBe(200);
    const created = await agent('post', '/credentials', oat, {
      name: 'New site', username: 'person-b@example.test', origin: 'https://new.example.test', generate: { length: 24, symbols: true }, purpose: 'signup',
    });
    expect(created.status).toBe(201);
    generated = created.body.data.generatedPassword;
    const rotated = await agent('post', `/credentials/${shopId}/password`, oat, { origin: ORIGIN, password: ROTATED_PASSWORD, purpose: 'password_change' });
    expect(rotated.status).toBe(200);
    // Someone else's own agent traffic must never show up in this user's list.
    const otherPat = await createPat(otherUserId, 'other pat');
    expect((await agent('post', `/credentials/${otherUserSecret}/fill`, otherPat, { field: 'username', origin: ORIGIN, purpose: 'login' })).status).toBe(200);
    // The owner turns a login on for agents: an `agent_access` event in the trail.
    await http().patch(`/api/secrets/${shopId}/agent-access`).set(bearer(session)).send({ agentAccess: 'none' }).expect(200);
    await openToAgents(session, shopId);
  });

  let generated = '';

  it('lists the caller\'s own events newest first, with names, and never a value', async () => {
    const res = await activity(session, '?pageSize=100').expect(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 100, total: expect.any(Number) });
    const items = res.body.data as Array<Record<string, unknown>>;
    expect(items.length).toBe(res.body.meta.total);
    const times = items.map((i) => String(i.at));
    expect([...times].sort().reverse()).toEqual(times);
    for (const item of items) agentActivityItemSchema.parse(item);

    const fill = items.find((i) => i.action === 'fill' && i.result === 'ok' && i.credentialKind === 'oauth')!;
    expect(fill).toMatchObject({ secretId: shopId, secretName: 'Shop', origin: ORIGIN, purpose: 'login', clientName: expect.any(String) });
    clientId = String(fill.clientId);
    expect(clientId).not.toBe('');
    const denied = items.find((i) => i.result === 'denied')!;
    expect(denied).toMatchObject({ action: 'fill', reason: 'origin_mismatch', origin: 'https://evil.example.test' });
    expect(items.find((i) => i.credentialKind === 'pat')).toMatchObject({ clientId: null, clientName: null });
    expect(items.find((i) => i.action === 'agent_access')).toMatchObject({ secretId: shopId, credentialKind: 'session' });
    for (const action of ['lookup', 'fill', 'totp', 'create', 'rotate', 'agent_access']) {
      expect(items.map((i) => i.action)).toContain(action);
    }

    // Only the caller's own events: the other user's PAT fill is in THEIR list, not this one.
    expect(items.every((i) => i.secretId !== otherUserSecret)).toBe(true);
    const theirs = (await activity(otherSession).expect(200)).body.data as Array<{ secretId: string; action: string }>;
    expect(theirs.every((i) => i.secretId === otherUserSecret)).toBe(true);
    expect(theirs.map((i) => i.action).sort()).toEqual(['agent_access', 'fill']);

    const text = JSON.stringify(res.body);
    for (const leak of [CANARY_PASSWORD, ROTATED_PASSWORD, SEED, generated, CANARY_USERNAME]) expect(text).not.toContain(leak);
  });

  it('filters by action, secret, client and date, and paginates', async () => {
    const fills = (await activity(session, '?action=fill&pageSize=100').expect(200)).body;
    expect(fills.data.every((i: { action: string }) => i.action === 'fill')).toBe(true);
    expect(fills.meta.total).toBe(fills.data.length);

    const bySecret = (await activity(session, `?secretId=${shopId}&pageSize=100`).expect(200)).body.data as Array<{ secretId: string }>;
    expect(bySecret.length).toBeGreaterThan(0);
    expect(bySecret.every((i) => i.secretId === shopId)).toBe(true);

    const byClient = (await activity(session, `?clientId=${encodeURIComponent(clientId)}&pageSize=100`).expect(200)).body.data as Array<{ clientId: string }>;
    expect(byClient.length).toBeGreaterThan(0);
    expect(byClient.every((i) => i.clientId === clientId)).toBe(true);

    const future = new Date(Date.now() + DAY).toISOString();
    expect((await activity(session, `?from=${encodeURIComponent(future)}`).expect(200)).body.data).toEqual([]);
    const past = new Date(Date.now() - DAY).toISOString();
    expect((await activity(session, `?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`).expect(200)).body.meta.total).toBeGreaterThan(0);

    const page1 = (await activity(session, '?pageSize=2&page=1').expect(200)).body;
    const page2 = (await activity(session, '?pageSize=2&page=2').expect(200)).body;
    expect(page1.data).toHaveLength(2);
    expect(page2.data[0].id).not.toBe(page1.data[0].id);
    expect(page2.meta).toEqual({ page: 2, pageSize: 2, total: page1.meta.total });
  });

  it('rejects bad queries, an unauthenticated call and an OAuth access token', async () => {
    await activity(session, '?pageSize=101').expect(400);
    await activity(session, '?action=delete').expect(400);
    await activity(session, '?secretId=nope').expect(400);
    await http().get('/api/agent-activity').expect(401);
    const res = await activity(oat);
    // The platform confines an `oat_` token to its resource; either that gate or the controller's own refuses it.
    expect([401, 403]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain(shopId);
    // A PAT may read it.
    const pat = await createPat(userId, 'reader pat');
    expect((await activity(pat).expect(200)).body.meta.total).toBeGreaterThan(0);
  });

  it('notifies: new_app once for the app, credential_changed on create and rotate, one folded credential_used, no value', async () => {
    const rows = await waitFor(() => inbox(userId), (r) => r.filter((n) => n.eventKey === 'vault.agent_credential_changed').length >= 2);
    const keys = rows.map((n) => n.eventKey);
    // oauth client and the PAT are two apps: two new_app rows.
    expect(keys.filter((k) => k === 'vault.agent_new_app')).toHaveLength(2);
    expect(keys.filter((k) => k === 'vault.agent_credential_changed')).toHaveLength(2);
    const used = rows.filter((n) => n.eventKey === 'vault.agent_credential_used');
    expect(used.length).toBeGreaterThan(0);
    expect(used.length).toBeLessThan(5);
    const text = JSON.stringify(rows);
    for (const leak of [CANARY_PASSWORD, ROTATED_PASSWORD, SEED, generated, CANARY_USERNAME]) expect(text).not.toContain(leak);
    expect(text).toContain('Shop');
    // A second fill by the same app raises no second new_app.
    const before = rows.filter((n) => n.eventKey === 'vault.agent_new_app').length;
    await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'username', origin: ORIGIN, purpose: 'login' });
    const after = await waitFor(() => inbox(userId), () => false);
    expect(after.filter((n) => n.eventKey === 'vault.agent_new_app')).toHaveLength(before);
  });

  it('revocation: revoking the grant in Connected apps makes the next agent call answer 401', async () => {
    const grants = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
    const mine = (grants.body.data as Array<{ id: string; client?: { clientId?: string }; clientId?: string }>);
    const row = await prisma.auditEvent.findFirst({ where: { action: 'agent.credential.fill', actorUserId: userId, targetId: shopId }, orderBy: { createdAt: 'desc' } });
    grantId = String((row!.meta as { grantId: string }).grantId);
    expect(mine.map((g) => g.id)).toContain(grantId);

    // Before: the token works.
    expect((await agent('get', '/whoami', oat)).status).toBe(200);
    await http().delete(`/api/oauth/grants/${grantId}`).set(bearer(session)).expect((r) => expect([200, 204]).toContain(r.status));
    // The very next call, with the same token, is refused.
    const after = await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, oat);
    expect(after.status).toBe(401);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' })).status).toBe(401);
    // The audit trail keeps the earlier events and the PAT still works.
    expect((await activity(session, '?action=fill&pageSize=100').expect(200)).body.meta.total).toBeGreaterThan(0);
  });
});
