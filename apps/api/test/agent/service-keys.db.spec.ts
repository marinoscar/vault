// =============================================================================
// Service keys for a server process over real Postgres (issue #241)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, the OAuth server and a
// REAL authorization-code + PKCE flow that yields `oat_` tokens for the `agent` resource. Proves,
// end to end over HTTP: a Service Key is saved with normalized ids and is unique per owner, service
// and key name; the release needs `vault:service_keys_read` (a login token is insufficient_scope),
// the kill switch and the owner's opt-in; closed and missing keys are one identical 404; every call
// is audited and shown in Agent activity; CANARY values appear in no log line, audit row,
// notification or error body.
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

const CANARY = 'sk-canary-Rw73$Lq';
const OTHER_CANARY = 'sk-canary-closed-H6';

describeWithDb('Service keys for a server process (real Postgres, issue #241)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let userId = '';
  let session = '';
  let pat = '';
  let typeId = '';
  let oat = '';
  let itemsOat = '';
  let keyId = '';
  let closedId = '';
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

    ({ id: userId, session } = await createUser('key-owner@example.test'));
    pat = await createPat(userId);
    const def = SYSTEM_SECRET_TYPES.find((t) => t.name === 'Service Key')!;
    typeId = (await prisma.secretType.create({
      data: { name: def.name, isSystem: true, fields: def.fields as never, allowAttachments: def.allowAttachments },
    })).id;

    await settings().patchSettings({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } } as never, userId);
    app.get(OAuthServerSettingsReader).invalidate();
    oat = await oauthToken(['vault:service_keys_read'], appUrl);
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


  const path = '/service-keys/web_search/provider_a';

  it('saves a Service Key with normalized ids, refuses a second with the same pair, and opens it', async () => {
    const created = await owner('post', '/secrets', session, {
      name: 'Search key', typeId, data: { service: 'Web_Search', key_name: 'Provider_A', key: CANARY },
    });
    expect(created.status).toBe(201);
    keyId = created.body.data.id;
    const read = await owner('get', `/secrets/${keyId}`, session);
    expect(read.body.data.values).toMatchObject({ service: 'web_search', key_name: 'provider_a' });

    const dup = await owner('post', '/secrets', session, {
      name: 'Search key 2', typeId, data: { service: 'web_search', key_name: 'provider_a', key: OTHER_CANARY },
    });
    expect([dup.status, dup.body.code]).toEqual([409, 'SERVICE_KEY_EXISTS']);
    const bad = await owner('post', '/secrets', session, { name: 'Bad', typeId, data: { service: 'web search', key_name: 'x', key: 'y' } });
    expect(bad.status).toBe(400);

    const closed = await owner('post', '/secrets', session, {
      name: 'Closed key', typeId, data: { service: 'web_search', key_name: 'closed_one', key: OTHER_CANARY },
    });
    closedId = closed.body.data.id;
    // An OAuth token never reaches /api/secrets (route confinement).
    expect((await owner('patch', `/secrets/${keyId}/agent-access`, oat, { agentAccess: 'fill' })).status).toBe(403);
    const opened = await owner('patch', `/secrets/${keyId}/agent-access`, session, { agentAccess: 'fill' });
    expect([opened.status, opened.body.data.agentAccess]).toEqual([200, 'fill']);
  });

  it('is refused while agentAccess.enabled is off (the default)', async () => {
    const res = await agent('get', path, oat);
    expect([res.status, res.body.code]).toEqual([403, 'AGENT_ACCESS_DISABLED']);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('releases the opened key to its scope only, and one identical 404 otherwise', async () => {
    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
    const whoami = await agent('get', '/whoami', itemsOat);
    expect(whoami.body.data.contract.version).toBe('1.4');
    expect(whoami.body.data.contract.features).toContain('service_keys');

    const res = await agent('get', '/service-keys/WEB_SEARCH/provider_a', oat);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { value: CANARY } });
    expect(res.headers['cache-control']).toBe('no-store');

    const loginToken = await agent('get', path, itemsOat);
    expect(loginToken.status).toBe(403);
    expect(String(loginToken.headers['www-authenticate'])).toMatch(/insufficient_scope/);

    const closed = await agent('get', '/service-keys/web_search/closed_one', oat);
    const missing = await agent('get', '/service-keys/web_search/nothing', oat);
    expect([closed.status, missing.status]).toEqual([404, 404]);
    expect({ ...closed.body, timestamp: 0, path: 0 }).toEqual({ ...missing.body, timestamp: 0, path: 0 });
    expect((await agent('get', `/service-keys/web_search/${encodeURIComponent('bad id!')}`, oat)).status).toBe(400);
    // A personal access token works too; a browser session does not.
    expect((await agent('get', path, pat)).status).toBe(200);
    const bySession = await agent('get', path, session);
    expect([bySession.status, bySession.body.code]).toEqual([403, 'AGENT_CREDENTIAL_REQUIRED']);
  });

  it('audits every call with the service and key name, and shows it in Agent activity, never the value', async () => {
    const rows = await prisma.auditEvent.findMany({ where: { actorUserId: userId, action: 'agent.service_key.read' }, orderBy: { createdAt: 'asc' } });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const ok = rows.find((r) => (r.meta as { result?: string }).result === 'ok')!;
    expect(ok).toMatchObject({ targetType: 'secret', targetId: keyId });
    expect(ok.meta).toMatchObject({ service: 'web_search', keyName: 'provider_a', purpose: 'service_call', credential: 'oauth' });
    expect(rows.some((r) => (r.meta as { result?: string }).result === 'denied:disabled')).toBe(true);
    expect(rows.some((r) => (r.meta as { result?: string }).result === 'denied:not_found')).toBe(true);

    const activity = await owner('get', '/agent-activity?action=service_key', session);
    expect(activity.status).toBe(200);
    expect(activity.body.data[0]).toMatchObject({ action: 'service_key', service: 'web_search' });
    expect(activity.body.data.some((i: { secretId: string; result: string }) => i.secretId === keyId && i.result === 'ok')).toBe(true);
  });

  it('closing the key stops the release at once', async () => {
    await owner('patch', `/secrets/${keyId}/agent-access`, session, { agentAccess: 'none' });
    expect((await agent('get', path, oat)).status).toBe(404);
    expect(closedId).not.toBe('');
  });

  it('CANARY: the values appear in no log line, console line, audit row, notification or error body', async () => {
    const audit = JSON.stringify(await prisma.auditEvent.findMany({ where: { actorUserId: userId } }));
    const notes = JSON.stringify(notifySpy.mock.calls);
    const errorBodies = bodies.filter((b) => !b.includes('"status":200') && !b.includes('"status":201'));
    for (const canary of [CANARY, OTHER_CANARY]) {
      expect(lines.join('\n')).not.toContain(canary);
      expect(audit).not.toContain(canary);
      expect(notes).not.toContain(canary);
      expect(errorBodies.join('\n')).not.toContain(canary);
    }
  });
});
