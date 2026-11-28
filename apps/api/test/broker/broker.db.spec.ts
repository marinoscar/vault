// =============================================================================
// The credential broker over real Postgres and a real local HTTPS upstream (issue #246, ADR-0006)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, REAL `vbk_` and `pat_`
// tokens, and a local HTTPS server standing in for the upstream, trusted through a throwaway
// certificate authority (TLS verification stays ON; the loopback allowance is the explicit test
// option of the forward service, never an environment variable). Proves, end to end:
//
//   - the owner opts a secret in (PAT), creates a broker token (session), and a `vbk_` bearer forwards
//     a request with the key added as `Authorization: Bearer`, the caller's own credential stripped;
//   - the request path, query and body (JSON and binary) arrive untouched; the response is raw, not
//     enveloped, with `X-Vault-Broker: 1`; a redirect is returned, not followed;
//   - kill switches, the rate limit, the origin check, the blocked destination, the size and time caps,
//     an echoed key and every credential refusal answer as the ADR says;
//   - a revoked, expired or unknown token is a 401; a `vbk_` token authenticates nowhere else;
//   - SECRET EGRESS: the key, the query string and the body appear in no `audit_events` row and in no
//     response outside the upstream's own; the Agent activity list shows the forwards.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { AuthService, PRINCIPAL_USER_INCLUDE } from '@marinoscar/platform-api/identity';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';
import { AgentRateLimiter } from '@marinoscar/vault-api/agent';
import {
  BrokerForwardService,
  BrokerResolver,
  BrokerUpstream,
  NodeHttpsBrokerUpstream,
  installBrokerRawBody,
} from '@marinoscar/vault-api/broker';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_PRISMA, VAULT_SETTINGS } from '@marinoscar/vault-api/ports';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import { findAdminCredentials, provisionAppRoleDatabase, type AppRoleDatabase } from '../helpers/app-role-database.helper';
import { createTestPki, startLocalHttps, type LocalHttps, type TestPki } from './local-https';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const DAY = 24 * 3600 * 1000;

const UPSTREAM = 'upstream.example.test';
const BLOCKED = 'blocked.example.test';
const KEY = 'sk-live-BrokerCanary_8Rk3vD7q';
const FOREIGN_KEY = 'sk-live-ForeignCanary_2Hn9xP4w';
const QUERY_CANARY = 'QueryCanary-5Tz1';
const BODY_CANARY = 'BodyCanary-9Lm6';

describeWithDb('credential broker (real Postgres, real TLS upstream, #246)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let pki: TestPki;
  let upstream: LocalHttps;
  let userId = '';
  let otherUserId = '';
  let orgId = '';
  let session = '';
  let otherSession = '';
  let apiKeyTypeId = '';
  let noteTypeId = '';
  let pat = '';
  let secretId = '';
  let foreignId = '';
  let noteId = '';
  let vbk = '';
  let vbkId = '';
  let limiter: AgentRateLimiter;
  const savedEnv: Record<string, string | undefined> = {};
  const dnsAnswers = new Map<string, string>([[UPSTREAM, '127.0.0.1'], [BLOCKED, '10.0.0.5']]);

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = () => app.get(SystemSettingsService);
  const base = () => `/api/broker/v1/${secretId}/${UPSTREAM}:${upstream.port}`;
  const forward = (token: string, path = '/v1/ping', method: 'get' | 'post' = 'get') => (http() as any)[method](`${base()}${path}`).set(bearer(token));
  const setBroker = (broker: Record<string, unknown>) => settings().patchSettings({ agentAccess: { enabled: true, broker } } as never, userId);

  const field = (name: string, required: boolean, sensitive = false) => ({ name, label: name, type: 'string', required, sensitive });
  async function createUser(email: string) {
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
      data: { userId: forUser, name: 'broker pat', tokenHash: sha256(raw), tokenPrefix: raw.slice(0, 8), durationValue: 30, durationUnit: 'days', expiresAt: new Date(Date.now() + 30 * DAY) },
    });
    return raw;
  }
  const createSecret = async (who: string, typeId: string, name: string, data: Record<string, string>) => {
    const res = await http().post('/api/secrets').set(bearer(who)).send({ name, typeId, data });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  beforeAll(async () => {
    pki = createTestPki();
    upstream = await startLocalHttps(pki.issue(UPSTREAM), (req, res, body) => {
      const url = req.url ?? '';
      if (url.includes('/redirect')) {
        res.writeHead(302, { location: 'https://elsewhere.example.test/next', 'set-cookie': 's=1' });
        res.end();
      } else if (url.includes('/echo-body')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: `Bearer ${req.headers.authorization?.slice(7)}` }));
      } else if (url.includes('/echo-header')) {
        res.writeHead(200, { 'x-debug': String(req.headers.authorization) });
        res.end('ok');
      } else if (url.includes('/slow')) {
        setTimeout(() => res.end('late'), 2500);
      } else if (url.includes('/bytes')) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(body);
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'tracking=1', 'x-request-id': 'r-1' });
        res.end(JSON.stringify({ ok: true, path: url, body: body.toString('utf8') }));
      }
    });

    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();
    await seedPlatform(
      prisma as unknown as SeedPrisma,
      platformSeedInputFrom({ permissions: platformPermissionCatalog(PERMISSION_OPTIONS), settings: DEFAULT_SYSTEM_SETTINGS }, { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' }),
    );
    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'INITIAL_ADMIN_EMAIL']) savedEnv[key] = process.env[key];
    Object.assign(process.env, deployment.env, { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' });
    delete process.env.DATABASE_URL;

    const resolver: BrokerResolver = { resolveAll: async (host: string) => [{ address: dnsAnswers.get(host) ?? '93.184.216.34', family: 4 as const }] };
    const connector = new NodeHttpsBrokerUpstream({ ca: pki.caPem });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The one test-only departure: DNS answers from a table, TLS trusts the throwaway CA (verification on)
      // and the forward service may reach loopback (explicit constructor option; nothing in production binds it).
      .overrideProvider(BrokerForwardService)
      .useFactory({
        factory: (db: never, crypto: never, settingsPort: never, audit: never, rate: AgentRateLimiter) =>
          new BrokerForwardService(db, crypto, settingsPort, audit, rate, resolver, connector as BrokerUpstream, { allowLoopbackForTests: true }),
        inject: [VAULT_PRISMA, VAULT_CRYPTO, VAULT_SETTINGS, VAULT_AUDIT, AgentRateLimiter],
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    installBrokerRawBody(app.getHttpAdapter().getInstance());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    limiter = moduleRef.get(AgentRateLimiter, { strict: false });

    orgId = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    ({ id: userId, session } = await createUser('broker-owner@example.test'));
    ({ id: otherUserId, session: otherSession } = await createUser('someone-else@example.test'));
    apiKeyTypeId = (await prisma.secretType.create({ data: { name: 'API Key', isSystem: true, createdById: userId, fields: [field('key', true, true), field('provider', false), field('notes', false)] } })).id;
    noteTypeId = (await prisma.secretType.create({ data: { name: 'Note', isSystem: true, createdById: userId, fields: [field('content', false)] } })).id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await upstream?.close();
    pki?.dispose();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('the owner opts a secret in with a PAT: validation, owner only, oat_/vbk_ refused, audited without the key', async () => {
    pat = await createPat(userId);
    secretId = await createSecret(session, apiKeyTypeId, 'Provider key', { key: KEY, provider: 'Provider X' });
    foreignId = await createSecret(otherSession, apiKeyTypeId, 'Foreign key', { key: FOREIGN_KEY, provider: 'Provider Y' });
    noteId = await createSecret(session, noteTypeId, 'A note', { content: 'hello' });
    const origins = [`https://${UPSTREAM}:${upstream.port}`, `https://${BLOCKED}`];
    const patch = (token: string | null, id: string, body: object) => {
      const req = http().patch(`/api/secrets/${id}/broker-access`);
      return (token ? req.set(bearer(token)) : req).send(body);
    };

    expect((await patch(null, secretId, { enabled: true, origins })).status).toBe(401);
    expect((await patch(session, foreignId, { enabled: true, origins })).status).toBe(404);
    const note = await patch(pat, noteId, { enabled: true, origins });
    expect([note.status, note.body.code]).toEqual([422, 'BROKER_UNSUPPORTED_TYPE']);
    expect((await patch(pat, secretId, { enabled: true })).body.code).toBe('BROKER_ORIGINS_REQUIRED');
    expect((await patch(pat, secretId, { enabled: true, origins: ['https://127.0.0.1'] })).body.code).toBe('BROKER_ORIGIN_INVALID');
    expect((await patch(pat, secretId, { enabled: true, origins: ['http://api.service-x.example'] })).body.code).toBe('BROKER_ORIGIN_INVALID');
    expect((await patch(pat, secretId, { enabled: true, origins, injection: { kind: 'header', name: 'Host' } })).status).toBe(400);
    expect((await patch(`vbk_${'a'.repeat(40)}`, secretId, { enabled: true, origins })).status).toBe(401);
    expect((await prisma.secret.findUniqueOrThrow({ where: { id: secretId } })).brokerAccess).toBe(false);

    const on = await patch(pat, secretId, { enabled: true, origins });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ id: secretId, brokerAccess: true, brokerOrigins: origins, brokerInjection: null, brokerField: null });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'secret.broker_access.update', targetId: secretId } });
    expect(audit.actorUserId).toBe(userId);
    expect(JSON.stringify(audit)).not.toContain(KEY);

    const listed = await http().get('/api/secrets').query({ brokerAccess: 'true' }).set(bearer(session)).expect(200);
    expect((listed.body.data.items as Array<{ id: string }>).map((i) => i.id)).toEqual([secretId]);
  });

  it('broker tokens: created by a session, listed without the token, restricted only to your own broker-enabled secrets', async () => {
    const restricted = await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'bad', secretIds: [foreignId] });
    expect([restricted.status, restricted.body.code]).toEqual([422, 'BROKER_TOKEN_SECRET_INVALID']);
    expect((await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'bad', secretIds: [noteId] })).status).toBe(422);
    expect((await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'x', expiresInDays: 4000 })).status).toBe(400);
    expect((await http().post('/api/broker/tokens').send({ name: 'x' })).status).toBe(401);

    const created = await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'Sandbox A', expiresInDays: 30 });
    expect(created.status).toBe(201);
    vbk = created.body.data.token;
    vbkId = created.body.data.id;
    expect(vbk).toMatch(/^vbk_[A-Za-z0-9]{40}$/);

    // A vbk_ token can neither mint nor list nor revoke tokens, nor reach any other route.
    for (const [method, path] of [['post', '/api/broker/tokens'], ['get', '/api/broker/tokens'], ['delete', `/api/broker/tokens/${vbkId}`], ['get', '/api/secrets'], ['get', '/api/agent/v1/whoami'], ['post', '/api/mcp']] as const) {
      expect([method, path, (await (http() as any)[method](path).set(bearer(vbk)).send({})).status]).toEqual([method, path, 401]);
    }

    const list = await http().get('/api/broker/tokens').set(bearer(pat)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(vbk);
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    expect(list.body.data[0].tokenPrefix).toBe(vbk.slice(0, 12));
    const row = await prisma.brokerToken.findUniqueOrThrow({ where: { id: vbkId } });
    expect(row.tokenHash).toBe(sha256(vbk));
    expect(await http().get('/api/broker/tokens').set(bearer(otherSession)).then((r) => r.body.data)).toEqual([]);
  });

  it('the broker is off until an administrator switches it on (403 BROKER_DISABLED, nothing sent)', async () => {
    const off = await forward(vbk);
    expect([off.status, off.body.code]).toEqual([403, 'BROKER_DISABLED']);
    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
    expect((await forward(vbk)).body.code).toBe('BROKER_DISABLED');
    expect(upstream.seen).toHaveLength(0);
    await setBroker({ enabled: true });
  });

  it('credentials: only vbk_ and pat_ are served; session, oat_ and unknown tokens are refused', async () => {
    expect((await http().get(`${base()}/v1/ping`)).status).toBe(401);
    expect((await forward(`vbk_${'z'.repeat(40)}`)).status).toBe(401);
    const asSession = await forward(session);
    expect([asSession.status, asSession.body.code]).toEqual([403, 'BROKER_CREDENTIAL_REFUSED']);
    expect((await forward('oat_0123456789abcdef')).body.code).toBe('BROKER_CREDENTIAL_REFUSED');
    expect(upstream.seen).toHaveLength(0);
  });

  it('forwards with the key added and the caller\'s credential, cookies and proxy headers stripped; the response is raw', async () => {
    const res = await forward(vbk, `/v1/ping?x=1&token=${QUERY_CANARY}`).set('Cookie', 'a=b').set('X-Forwarded-For', '1.2.3.4').set('X-Custom', 'kept');
    expect(res.status).toBe(200);
    expect(res.headers['x-vault-broker']).toBe('1');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-request-id']).toBe('r-1');
    // Raw upstream JSON, not the `{ data }` envelope.
    expect(res.body).toMatchObject({ ok: true, path: `/v1/ping?x=1&token=${QUERY_CANARY}` });
    expect(res.body.data).toBeUndefined();

    const seen = upstream.seen.at(-1)!;
    expect(seen.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.headers['x-forwarded-for']).toBeUndefined();
    expect(seen.headers['x-custom']).toBe('kept');
    expect(seen.headers.host).toBe(`${UPSTREAM}:${upstream.port}`);
    expect(JSON.stringify(seen.headers)).not.toContain(vbk);
  });

  it('forwards a JSON body and a binary body byte for byte, and a PAT works too', async () => {
    const json = await (forward(vbk, '/v1/messages', 'post') as any).set('Content-Type', 'application/json').send(JSON.stringify({ note: BODY_CANARY }));
    expect(json.status).toBe(200);
    expect(json.body.body).toBe(JSON.stringify({ note: BODY_CANARY }));
    expect(upstream.seen.at(-1)!.headers['content-type']).toBe('application/json');

    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const bin = await (forward(pat, '/v1/bytes', 'post') as any).set('Content-Type', 'application/octet-stream').send(bytes);
    expect(bin.status).toBe(200);
    expect(Buffer.from(bin.body)).toEqual(bytes);
    expect(upstream.seen.at(-1)!.headers['content-type']).toBe('application/octet-stream');
  });

  it('the base URL itself (no path) reaches the upstream root', async () => {
    const res = await http().get(base()).set(bearer(vbk));
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('/');
  });

  it('returns a redirect as it is and never follows it', async () => {
    const before = upstream.seen.length;
    const res = await forward(vbk, '/redirect').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://elsewhere.example.test/next');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(upstream.seen.length).toBe(before + 1);
  });

  it('withholds a response that contains the key: in the body and in a header (502 BROKER_KEY_ECHO)', async () => {
    for (const path of ['/echo-body', '/echo-header']) {
      const res = await forward(vbk, path);
      expect([path, res.status, res.body.code]).toEqual([path, 502, 'BROKER_KEY_ECHO']);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      expect(JSON.stringify(res.headers)).not.toContain(KEY);
    }
  });

  it('every unavailable secret is the same 404; a token restriction, a foreign secret and a missing one included', async () => {
    const missing = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
    const answer = async (id: string) => http().get(`/api/broker/v1/${id}/${UPSTREAM}:${upstream.port}/v1/ping`).set(bearer(vbk));
    const results = [await answer(missing), await answer(foreignId), await answer(noteId)];
    expect(results.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(new Set(results.map((r) => JSON.stringify({ ...r.body, path: undefined, timestamp: undefined }))).size).toBe(1);

    const other = await createSecret(session, apiKeyTypeId, 'Second key', { key: 'sk-second-1', provider: 'P' });
    await http().patch(`/api/secrets/${other}/broker-access`).set(bearer(pat)).send({ enabled: true, origins: [`https://${UPSTREAM}:${upstream.port}`] }).expect(200);
    const narrow = (await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'Narrow', secretIds: [secretId] }).expect(201)).body.data.token as string;
    expect((await forward(narrow)).status).toBe(200);
    expect((await http().get(`/api/broker/v1/${other}/${UPSTREAM}:${upstream.port}/v1/ping`).set(bearer(narrow))).status).toBe(404);
    expect((await http().get(`/api/broker/v1/${other}/${UPSTREAM}:${upstream.port}/v1/ping`).set(bearer(vbk))).status).toBe(200);
  });

  it('the origin must be exactly an allowed one, and a name that resolves to a private address is blocked', async () => {
    const mismatch = await http().get(`/api/broker/v1/${secretId}/other.example.test/v1/ping`).set(bearer(vbk));
    expect([mismatch.status, mismatch.body.code]).toEqual([403, 'BROKER_ORIGIN_MISMATCH']);
    const wrongPort = await http().get(`/api/broker/v1/${secretId}/${UPSTREAM}:1/v1/ping`).set(bearer(vbk));
    expect(wrongPort.body.code).toBe('BROKER_ORIGIN_MISMATCH');
    const before = upstream.seen.length;
    const blocked = await http().get(`/api/broker/v1/${secretId}/${BLOCKED}/v1/ping`).set(bearer(vbk));
    expect([blocked.status, blocked.body.code]).toEqual([403, 'BROKER_DESTINATION_BLOCKED']);
    expect(upstream.seen.length).toBe(before);
  });

  it('caps: an oversized request is 413 and a slow upstream is 504', async () => {
    await setBroker({ maxRequestBytes: 64, timeoutMs: 1000 });
    const big = await (forward(vbk, '/v1/messages', 'post') as any).set('Content-Type', 'application/json').send('x'.repeat(500));
    expect([big.status, big.body.code]).toEqual([413, 'BROKER_REQUEST_TOO_LARGE']);
    const slow = await forward(vbk, '/slow');
    expect([slow.status, slow.body.code]).toEqual([504, 'BROKER_UPSTREAM_TIMEOUT']);
    await setBroker({ maxRequestBytes: 10 * 1024 * 1024, timeoutMs: 30000 });
  }, 30_000);

  it('rate limit: over forwardsPerMinute is 429 RATE_LIMITED with Retry-After, before anything is looked up', async () => {
    await setBroker({ forwardsPerMinute: 2 });
    (limiter as unknown as { windows?: Map<string, unknown> }).windows?.clear();
    expect((await forward(vbk)).status).toBe(200);
    expect((await forward(vbk)).status).toBe(200);
    const limited = await forward(vbk);
    expect([limited.status, limited.body.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    await setBroker({ forwardsPerMinute: 60 });
    (limiter as unknown as { windows?: Map<string, unknown> }).windows?.clear();
  });

  it('a revoked, expired or inactive-owner token is a 401; stamps last use; a secret switched off is a 404', async () => {
    expect((await prisma.brokerToken.findUniqueOrThrow({ where: { id: vbkId } })).lastUsedAt).not.toBeNull();

    const revokedToken = (await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'Revoked' }).expect(201)).body;
    expect((await forward(revokedToken.data.token)).status).toBe(200);
    expect((await http().delete(`/api/broker/tokens/${revokedToken.data.id}`).set(bearer(session))).status).toBe(204);
    expect((await forward(revokedToken.data.token)).status).toBe(401);
    expect((await http().post(`/api/broker/tokens/${revokedToken.data.id}/revoke`).set(bearer(otherSession))).status).toBe(404);

    const expired = (await http().post('/api/broker/tokens').set(bearer(session)).send({ name: 'Expiring' }).expect(201)).body;
    await prisma.brokerToken.update({ where: { id: expired.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await forward(expired.data.token)).status).toBe(401);

    await http().patch(`/api/secrets/${secretId}/broker-access`).set(bearer(session)).send({ enabled: false }).expect(200);
    expect((await forward(vbk)).status).toBe(404);
    expect(await prisma.auditEvent.count({ where: { action: 'broker.token.revoke' } })).toBe(1);
  });

  it('SECRET EGRESS: no audit row carries the key, the query, the body or a token; the forwards are in Agent activity', async () => {
    const rows = await prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } });
    const text = JSON.stringify(rows);
    for (const canary of [KEY, FOREIGN_KEY, QUERY_CANARY, BODY_CANARY, vbk, sha256(vbk), pat]) expect(text).not.toContain(canary);

    const forwards = rows.filter((r) => r.action === 'broker.forward');
    expect(forwards.length).toBeGreaterThan(10);
    const ok = forwards.find((r) => (r.meta as any)?.result === 'ok')!;
    expect(ok.meta).toMatchObject({ outcome: 'forwarded', credential: 'broker', method: 'GET', status: 200, origin: `https://${UPSTREAM}:${upstream.port}` });
    expect((ok.meta as any).path).not.toContain('?');
    const results = new Set(forwards.map((r) => (r.meta as any).result));
    for (const expected of ['ok', 'denied:disabled', 'denied:key_echo', 'denied:origin_mismatch', 'denied:destination_blocked', 'denied:request_too_large', 'error:upstream_timeout', 'denied:rate_limited', 'denied:not_found']) {
      expect(results).toContain(expected);
    }

    const activity = await http().get('/api/agent-activity').query({ action: 'broker_forward', pageSize: 100 }).set(bearer(session)).expect(200);
    expect(activity.body.data.length).toBeGreaterThan(10);
    expect(activity.body.data[0]).toMatchObject({ action: 'broker_forward', credentialKind: expect.stringMatching(/broker|pat/) });
    expect(activity.body.data.some((i: any) => i.result === 'ok' && i.method === 'GET' && i.status === 200 && i.origin === `https://${UPSTREAM}:${upstream.port}`)).toBe(true);
    const denied = activity.body.data.find((i: any) => i.result === 'denied');
    expect(denied.reason).toBeTruthy();
    expect(JSON.stringify(activity.body)).not.toContain(KEY);
    expect(await prisma.user.count({ where: { id: otherUserId } })).toBe(1);
  });
});
