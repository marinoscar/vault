// =============================================================================
// The agent credential API over real Postgres (issue #178, E14.6, epic #172)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, the OAuth server and the
// agent kill switch switched on, and a REAL authorization-code + PKCE flow (platform test kit) that
// yields an `oat_` token for the `agent` resource. Proves, end to end:
//
//   - the kill switch: off by default, every agent route answers 403 AGENT_ACCESS_DISABLED;
//   - lookup (username decrypted, no sensitive value, exact before site), fill (one field per call),
//     totp, create with a generated password (returned once) and rotate (a new version);
//   - 404 for a missing, foreign, closed or non-Credential secret; 403 ORIGIN_MISMATCH; 403
//     insufficient_scope for a token without the scope; a browser session refused; a PAT accepted;
//   - 429 RATE_LIMITED with Retry-After; Cache-Control: no-store on every response;
//   - route confinement: the same token is refused on /api/secrets/:id;
//   - SECRET EGRESS: a canary password and a generated password appear in no log or console line,
//     no audit row and no error body.
//
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
  mintOAuthTestToken,
  runOAuthAuthorizationCodeFlow,
} from '@marinoscar/platform-api/identity/testing';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

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

describeWithDb('Vault agent credential API (real Postgres, E14.6)', () => {
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
  let closedId = '';
  let foreignId = '';
  let noteId = '';

  it('is OFF by default: every route answers 403 AGENT_ACCESS_DISABLED with no-store, and nothing is read', async () => {
    const responses = [
      await agent('get', '/whoami', oat),
      await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, oat),
      await agent('post', '/credentials/3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b/fill', oat, { field: 'password', origin: ORIGIN, purpose: 'login' }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AGENT_ACCESS_DISABLED');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.pragma).toBe('no-cache');
    }
    const row = await prisma.auditEvent.findFirst({ where: { action: 'agent.credential.lookup' } });
    expect(row?.meta).toMatchObject({ result: 'denied:disabled', credential: 'oauth' });

    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
    expect((await agent('get', '/whoami', oat)).status).toBe(200);
  });

  it('seeds the credentials through the session routes', async () => {
    shopId = await createSecret(session, credTypeId, 'Shop', {
      username: CANARY_USERNAME, password: CANARY_PASSWORD, url: ORIGIN, totp: SEED,
    });
    await openToAgents(session, shopId);
    closedId = await createSecret(session, credTypeId, 'Closed', { username: 'u', password: 'p', url: ORIGIN });
    foreignId = await createSecret(otherSession, credTypeId, 'Theirs', { username: 'u', password: 'p', url: ORIGIN });
    await openToAgents(otherSession, foreignId);
    noteId = await createSecret(session, noteTypeId, 'A note', { body: 'x' });
  });

  it('lookup: returns the opened login for the origin with the username, hasTotp and no sensitive value', async () => {
    const res = await agent('get', `/credentials?origin=${encodeURIComponent(`${ORIGIN}/login?next=/`)}`, oat);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual([
      {
        id: shopId, name: 'Shop', username: CANARY_USERNAME, origins: [ORIGIN], matchKind: 'exact',
        hasTotp: true, updatedAt: expect.any(String),
      },
    ]);
    const text = JSON.stringify(res.body);
    for (const leak of [CANARY_PASSWORD, SEED, closedId, foreignId]) expect(text).not.toContain(leak);
  });

  it('lookup: a sibling subdomain is a "site" match only, and an invalid origin is a 400', async () => {
    const site = await agent('get', `/credentials?origin=${encodeURIComponent('https://login.shop.example.test')}`, oat);
    expect(site.body.data.map((d: { matchKind: string }) => d.matchKind)).toEqual(['site']);
    expect((await agent('get', '/credentials?origin=not%20a%20url', oat)).status).toBe(400);
    expect((await agent('get', '/credentials', oat)).status).toBe(400);
    expect((await agent('get', `/credentials?origin=${encodeURIComponent('https://other.example.org')}`, oat)).body.data).toEqual([]);
  });

  it('fill: returns exactly one field per call', async () => {
    const user = await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'username', origin: ORIGIN, purpose: 'login' });
    expect(user.status).toBe(200);
    expect(user.body.data).toEqual({ value: CANARY_USERNAME });
    expect(user.headers['cache-control']).toBe('no-store');
    const pass = await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' });
    expect(pass.status).toBe(200);
    expect(pass.body.data).toEqual({ value: CANARY_PASSWORD });
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'totp', origin: ORIGIN, purpose: 'login' })).status).toBe(400);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN })).status).toBe(400);
  });

  it('fill: 403 ORIGIN_MISMATCH for another origin, a subdomain and a different port', async () => {
    for (const origin of ['https://evil.example.test', 'https://login.shop.example.test', `${ORIGIN}:8443`]) {
      const res = await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin, purpose: 'login' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ORIGIN_MISMATCH');
      expect(JSON.stringify(res.body)).not.toContain(CANARY_PASSWORD);
    }
  });

  it('404 for a closed secret, another user\'s secret, a non-Credential and a missing id (the same answer)', async () => {
    const missing = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
    const answers = [];
    for (const id of [closedId, foreignId, noteId, missing]) {
      const res = await agent('post', `/credentials/${id}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' });
      expect(res.status).toBe(404);
      answers.push(res.body.message);
    }
    expect(new Set(answers).size).toBe(1);
    expect((await agent('post', `/credentials/${closedId}/totp`, oat, { origin: ORIGIN, purpose: 'mfa' })).status).toBe(404);
    expect((await agent('post', `/credentials/${foreignId}/password`, oat, { origin: ORIGIN, generate: {}, purpose: 'password_change' })).status).toBe(404);
  });

  it('totp: a 6-digit code and its expiry; the seed never appears; 404 without a seed', async () => {
    const res = await agent('post', `/credentials/${shopId}/totp`, oat, { origin: ORIGIN, purpose: 'mfa' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toMatch(/^\d{6}$/);
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toContain(SEED);
    expect((await agent('post', `/credentials/${shopId}/totp`, oat, { origin: 'https://evil.example.test', purpose: 'mfa' })).body.code).toBe('ORIGIN_MISMATCH');

    const noSeed = await createSecret(session, credTypeId, 'No seed', { username: 'u', password: 'p', url: 'https://noseed.example.org' });
    await openToAgents(session, noSeed);
    expect((await agent('post', `/credentials/${noSeed}/totp`, oat, { origin: 'https://noseed.example.org', purpose: 'mfa' })).status).toBe(404);
  });

  it('scopes: a token without the scope gets 403 insufficient_scope with a challenge, per route', async () => {
    const mint = async (scopes: string[]) =>
      (await mintOAuthTestToken(prisma as never, { userId, resourceId: 'agent', scopes, appUrl, orgId })).token;
    const readOnly = await mint(['vault:items_read']);
    const fillOnly = await mint(['vault:items_fill']);

    expect((await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, readOnly)).status).toBe(200);
    for (const [token, path, body] of [
      [readOnly, `/credentials/${shopId}/fill`, { field: 'password', origin: ORIGIN, purpose: 'login' }],
      [readOnly, `/credentials/${shopId}/totp`, { origin: ORIGIN, purpose: 'mfa' }],
      [readOnly, '/credentials', { name: 'x', username: 'u', origin: ORIGIN, generate: {}, purpose: 'signup' }],
      [fillOnly, '/credentials', { name: 'x', username: 'u', origin: ORIGIN, generate: {}, purpose: 'signup' }],
      [fillOnly, `/credentials/${shopId}/password`, { origin: ORIGIN, generate: {}, purpose: 'password_change' }],
    ] as const) {
      const res = await agent('post', path, token, body);
      expect([path, res.status]).toEqual([path, 403]);
      expect(String(res.headers['www-authenticate'])).toContain('insufficient_scope');
    }
    expect((await agent('post', `/credentials/${shopId}/fill`, fillOnly, { field: 'username', origin: ORIGIN, purpose: 'login' })).status).toBe(200);
  });

  it('credentials: a browser session is refused (403), a personal access token is accepted', async () => {
    const refused = await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, session);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('AGENT_CREDENTIAL_REQUIRED');
    expect((await agent('post', `/credentials/${shopId}/fill`, session, { field: 'password', origin: ORIGIN, purpose: 'login' })).status).toBe(403);

    const pat = await createPat(userId, 'agent pat');
    const found = (await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, pat)).body.data;
    expect(found.map((d: { id: string; matchKind: string }) => [d.id, d.matchKind])).toEqual([[shopId, 'exact']]);
    const fill = await agent('post', `/credentials/${shopId}/fill`, pat, { field: 'username', origin: ORIGIN, purpose: 'login' });
    expect(fill.body.data.value).toBe(CANARY_USERNAME);
    const row = await prisma.auditEvent.findFirst({ where: { action: 'agent.credential.fill', actorUserId: userId }, orderBy: { createdAt: 'desc' } });
    expect(row?.meta).toMatchObject({ credential: 'pat', tokenId: expect.any(String), result: 'ok' });
  });

  let createdId = '';
  let generated = '';

  it('create: a generated password is returned once, stored, and usable through fill', async () => {
    const res = await agent('post', '/credentials', oat, {
      name: 'New site', username: 'person-b@example.test', origin: 'new.example.test',
      additionalUrls: ['https://accounts.new.example.test/x'], generate: { length: 32, symbols: true }, purpose: 'signup',
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    createdId = res.body.data.id;
    generated = res.body.data.generatedPassword;
    expect(generated).toHaveLength(32);
    expect(/[a-z]/.test(generated) && /[A-Z]/.test(generated) && /[0-9]/.test(generated) && /[^A-Za-z0-9]/.test(generated)).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'New site', username: 'person-b@example.test',
      origins: ['https://accounts.new.example.test', 'https://new.example.test'],
    });

    const row = await prisma.secret.findUniqueOrThrow({ where: { id: createdId } });
    expect(row).toMatchObject({ createdById: userId, agentAccess: 'fill' });
    expect(row.agentAccessChangedAt).toBeInstanceOf(Date);

    const fill = await agent('post', `/credentials/${createdId}/fill`, oat, { field: 'password', origin: 'https://new.example.test', purpose: 'login' });
    expect(fill.body.data.value).toBe(generated);

    // Once only: no other agent response and no UI route returns it unasked.
    const list = await http().get('/api/secrets').set(bearer(session)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(generated);
    const again = await agent('get', `/credentials?origin=${encodeURIComponent('https://new.example.test')}`, oat);
    expect(JSON.stringify(again.body)).not.toContain(generated);
  });

  it('create: a supplied password is not echoed; both or neither of password/generate is 400; a name clash is 409', async () => {
    const ok = await agent('post', '/credentials', oat, { name: 'Supplied', username: 'u', origin: 'https://supplied.example.test', password: ROTATED_PASSWORD, purpose: 'signup' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).not.toHaveProperty('generatedPassword');
    expect(JSON.stringify(ok.body)).not.toContain(ROTATED_PASSWORD);
    const both = await agent('post', '/credentials', oat, { name: 'B', username: 'u', origin: ORIGIN, password: 'x', generate: {}, purpose: 'signup' });
    expect(both.status).toBe(400);
    expect(JSON.stringify(both.body)).not.toContain('"x"');
    expect((await agent('post', '/credentials', oat, { name: 'B', username: 'u', origin: ORIGIN, purpose: 'signup' })).status).toBe(400);
    expect((await agent('post', '/credentials', oat, { name: 'Shop', username: 'u', origin: ORIGIN, generate: {}, purpose: 'signup' })).status).toBe(409);
    expect((await agent('post', '/credentials', oat, { name: 'Bad', username: 'u', origin: 'ftp://x', generate: {}, purpose: 'signup' })).status).toBe(400);
  });

  it('rotate: adds a version (rollback possible), fill returns the new password, the generated one is returned once', async () => {
    const res = await agent('post', `/credentials/${shopId}/password`, oat, { origin: ORIGIN, password: ROTATED_PASSWORD, purpose: 'password_change' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: shopId, version: 2 });
    expect(await prisma.secretVersion.count({ where: { secretId: shopId } })).toBe(2);
    expect(await prisma.secretVersion.count({ where: { secretId: shopId, isCurrent: true } })).toBe(1);
    const fill = await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' });
    expect(fill.body.data.value).toBe(ROTATED_PASSWORD);
    // The other fields survive the rotation (the seed still produces a code).
    expect((await agent('post', `/credentials/${shopId}/totp`, oat, { origin: ORIGIN, purpose: 'mfa' })).status).toBe(200);

    const gen = await agent('post', `/credentials/${shopId}/password`, oat, { origin: ORIGIN, generate: { length: 20, symbols: false }, purpose: 'password_change' });
    expect(gen.body.data.version).toBe(3);
    expect(gen.body.data.generatedPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect((await agent('post', `/credentials/${shopId}/password`, oat, { origin: 'https://evil.example.test', generate: {}, purpose: 'password_change' })).body.code).toBe('ORIGIN_MISMATCH');
    generated += `|${gen.body.data.generatedPassword}`;
  });

  it('route confinement: the same oat_ token is refused on /api/secrets/:id and the UI routes', async () => {
    for (const path of [`/api/secrets/${shopId}`, '/api/secrets', '/api/auth/me']) {
      const res = await http().get(path).set(bearer(oat));
      // The platform confines an oat_ token to its resource with 401/403 (403 for a route that exists).
      expect([path, [401, 403].includes(res.status)]).toEqual([path, true]);
      expect(res.headers['www-authenticate'] ?? '').not.toContain('insufficient_scope');
    }
  });

  it('rate limit: fill is capped per token, with Retry-After, and the setting is honoured', async () => {
    await settings().patchSettings({ agentAccess: { fillPerMinute: 2 } } as never, userId);
    const pat = await createPat(userId, 'limited pat');
    const call = () => agent('post', `/credentials/${shopId}/fill`, pat, { field: 'username', origin: ORIGIN, purpose: 'login' });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(limited.headers['cache-control']).toBe('no-store');
    // Another token of the same user has its own bucket; so has another route.
    expect((await agent('post', `/credentials/${shopId}/fill`, await createPat(userId, 'second pat'), { field: 'username', origin: ORIGIN, purpose: 'login' })).status).toBe(200);
    expect((await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, pat)).status).toBe(200);
    await settings().patchSettings({ agentAccess: { fillPerMinute: 30 } } as never, userId);
  });

  it('audit: one row per call with the action, actor, client, secret, field, origin, purpose and result; no value', async () => {
    const rows = await prisma.auditEvent.findMany({ where: { action: { startsWith: 'agent.credential.' } }, orderBy: { createdAt: 'asc' } });
    const actions = new Set(rows.map((r) => r.action));
    expect([...actions].sort()).toEqual(
      ['agent.credential.create', 'agent.credential.fill', 'agent.credential.lookup', 'agent.credential.rotate', 'agent.credential.totp'],
    );
    const results = new Set(rows.map((r) => (r.meta as { result: string }).result));
    for (const expected of ['ok', 'denied:origin_mismatch', 'denied:not_found', 'denied:disabled', 'denied:rate_limited', 'denied:credential_kind', 'denied:invalid', 'denied:conflict']) {
      expect(results).toContain(expected);
    }
    const fill = rows.find((r) => r.action === 'agent.credential.fill' && r.targetId === shopId && (r.meta as { result: string }).result === 'ok')!;
    expect(fill.actorUserId).toBe(userId);
    expect(fill.meta).toMatchObject({
      credential: 'oauth', clientId: expect.any(String), grantId: expect.any(String), secretId: shopId,
      field: expect.stringMatching(/^(username|password)$/), origin: ORIGIN, purpose: 'login',
    });
    const created = rows.find((r) => r.action === 'agent.credential.create' && (r.meta as { result: string }).result === 'ok')!;
    expect(created.targetId).toBe(createdId);
    expect(created.meta).toMatchObject({ generated: true, purpose: 'signup' });
  });

  it('SECRET EGRESS: no canary or generated password in any log line, console line, audit row or response body of a denied call', async () => {
    const needles = [CANARY_PASSWORD, ROTATED_PASSWORD, SEED, ...generated.split('|')];
    const auditRows = await prisma.auditEvent.findMany();
    const haystacks: Array<[string, string]> = [
      ['audit', JSON.stringify(auditRows)],
      ['logs', lines.join('\n')],
      // Every response of the run except the ones that are SUPPOSED to carry a value once: the
      // successful fills, creates and rotates. Denials and lookups never do.
      ['denials', bodies.filter((b) => !/"status":(200|201),/.test(b) || /"path":"(\/credentials\?origin|\/whoami)/.test(b)).join('\n')],
    ];
    for (const [where, text] of haystacks) {
      for (const needle of needles) expect([where, text.includes(needle)]).toEqual([where, false]);
    }
    // The username is a non-sensitive field but still not log material.
    expect(lines.join('\n')).not.toContain(CANARY_USERNAME);
    // And the generated value really did exist and was returned once in its own response.
    expect(bodies.filter((b) => b.includes(generated.split('|')[0]!))).toHaveLength(2); // the create response and the fill that typed it
    expect(otherUserId).not.toBe(userId);
  });
});
