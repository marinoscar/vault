// =============================================================================
// Agent access acceptance: the epic's success criteria as ONE ordered scenario (issue #181, E14.9)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role) and the full app. Everything goes
// through the real routes: the admin enables the OAuth server and the agent kill switch with
// `PATCH /api/system-settings`; Person A opens a Credential to agents; an OAuth client runs
// authorization code + PKCE through consent against `/api/agent/v1`; lookup, fill, totp, wrong
// origin, route confinement, create and rotate with a generated password; the activity page and the
// inbox; revoking the grant; a second client against `/api/mcp`; and a canary scan of every log
// line, audit row and notification row of the whole run.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

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


const ORIGIN = 'https://shop.example.test';
const CANARY_PASSWORD = 'CanaryPw-7Qz9-do-not-leak';
const CANARY_USERNAME = 'person-a@example.test';
// RFC 6238 test seed (the ASCII bytes "12345678901234567890", base32).
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const AGENT_SCOPES = ['vault:items_read', 'vault:items_fill', 'vault:items_write', 'offline_access'];
const MCP_SCOPES = ['vault:mcp_read', 'vault:mcp_write'];
const MISSING_ID = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';

describeWithDb('Vault agent access: the epic acceptance scenario (real Postgres, E14.9)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let userId = '';
  let orgId = '';
  let appUrl = '';
  let session = '';
  let credTypeId = '';
  let adminSession = '';
  let oat = '';
  let mcpToken = '';
  const savedEnv: Record<string, string | undefined> = {};
  const lines: string[] = [];
  const bodies: string[] = [];
  const mcpBodies: string[] = [];
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

  /** One JSON-RPC tools/call against /api/mcp; the response is kept for the egress check. */
  let rpcId = 0;
  const mcp = async (token: string, method: string, params?: object) => {
    const res = await http()
      .post('/api/mcp')
      .set({ 'mcp-protocol-version': '2025-06-18', ...bearer(token) })
      .send({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) });
    mcpBodies.push(JSON.stringify({ method, status: res.status, body: res.body }));
    return res;
  };
  const mcpTool = async (token: string, name: string, args: object = {}) => {
    const res = await mcp(token, 'tools/call', { name, arguments: args });
    return { res, data: res.body?.result?.structuredContent as any, isError: res.body?.result?.isError === true };
  };

  const createSecret = async (who: string, typeId: string, name: string, data: Record<string, string>) => {
    const res = await http().post('/api/secrets').set(bearer(who)).send({ name, typeId, data });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const openToAgents = async (who: string, id: string) =>
    http().patch(`/api/secrets/${id}/agent-access`).set(bearer(who)).send({ agentAccess: 'fill' }).expect(200);

  const field = (name: string, required: boolean, sensitive = false) => ({ name, label: name, type: 'string', required, sensitive });

  async function createUser(email: string, systemAdmin = false) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: systemAdmin ? 'org_admin' : 'contributor' } });
    const user = await prisma.user.create({ data: { email, providerDisplayName: systemAdmin ? 'Admin A' : 'Person A', isActive: true } });
    await prisma.membership.create({ data: { userId: user.id, orgId, roleId: role.id, status: 'active' } });
    if (systemAdmin) {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    }
    const graph = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId });
    return { id: user.id, session: tokens.accessToken };
  }

  /** Runs the authorization-code + PKCE flow (through consent) for a freshly registered client. */
  async function connectClient(name: string, scopes: string[], resourcePath: string) {
    const made = await createOAuthTestClient(prisma as never, { name, tokenEndpointAuthMethod: 'client_secret_post' });
    const flow = await runOAuthAuthorizationCodeFlow(app, {
      client: made, user: { sessionToken: session }, scopes, resource: `${appUrl}${resourcePath}`,
    });
    expect(flow.code).toBeTruthy();
    const exchanged = await exchangeOAuthCode(app, { client: made, code: flow.code!, verifier: flow.pkce.verifier });
    expect(exchanged.status).toBe(200);
    const token = exchanged.body.access_token as string;
    expect(token.startsWith('oat_')).toBe(true);
    expect(String(exchanged.body.scope).split(' ').sort()).toEqual([...scopes].sort());
    return token;
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
    ({ session } = await createUser('person-a@example.test'));
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: 'person-a@example.test' } })).id;
    ({ session: adminSession } = await createUser('admin-a@example.test', true));

    credTypeId = (
      await prisma.secretType.create({
        data: {
          name: 'Credential', isSystem: true, createdById: userId,
          fields: [field('username', true), field('password', true, true), field('url', false), field('notes', false), field('additional_urls', false), field('totp', false, true)],
        },
      })
    ).id;
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
  let createdId = '';
  let grantId = '';
  let generatedCreate = '';
  let generatedRotate = '';
  const totpCodes: string[] = [];
  const mcpGenerated: string[] = [];

  const waitFor = async <T,>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    let value = await read();
    for (let i = 0; i < 50 && !done(value); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      value = await read();
    }
    return value;
  };
  const inbox = () => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const adminPatch = (body: object) => http().patch('/api/system-settings').set(bearer(adminSession)).send(body);

  it('a) the admin enables the OAuth server through the real settings route; an ordinary user cannot', async () => {
    await http().patch('/api/system-settings').set(bearer(session)).send({ agentAccess: { enabled: true } }).expect(403);
    const res = await adminPatch({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } });
    expect(res.status).toBe(200);
    app.get(OAuthServerSettingsReader).invalidate();
    const served = (await http().get('/api/system-settings').set(bearer(adminSession)).expect(200)).body.data;
    expect(served.oauthServer.enabled).toBe(true);
    expect(served.agentAccess.enabled).toBe(false);
  });

  it('b) Person A creates a Credential with a TOTP seed and opens it to agents', async () => {
    shopId = await createSecret(session, credTypeId, 'Shop', {
      username: CANARY_USERNAME, password: CANARY_PASSWORD, url: ORIGIN, totp: SEED,
    });
    const closed = await http().get(`/api/secrets/${shopId}`).set(bearer(session)).expect(200);
    expect(closed.body.data.agentAccess).toBe('none');
    const opened = await openToAgents(session, shopId);
    expect(opened.body.data).toMatchObject({ agentAccess: 'fill' });
  });

  it('c) an OAuth client runs authorization code + PKCE through consent for the agent scopes; agent routes answer 403 while the switch is off', async () => {
    oat = await connectClient('Agent Runtime A', AGENT_SCOPES, '/api/agent/v1');
    const grants = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
    expect(grants.body.data).toHaveLength(1);

    for (const res of [
      await agent('get', '/whoami', oat),
      await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, oat),
      await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AGENT_ACCESS_DISABLED');
    }

    // The admin switches the kill switch on through the same route.
    expect((await adminPatch({ agentAccess: { enabled: true } })).status).toBe(200);
    const served = (await http().get('/api/system-settings').set(bearer(adminSession)).expect(200)).body.data;
    expect(served.agentAccess.enabled).toBe(true);
    expect((await agent('get', '/whoami', oat)).status).toBe(200);
  });

  it('d) lookup by origin, fill username, fill password, totp; a wrong origin is 403; the oat_ never reaches /api/secrets', async () => {
    const found = await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, oat);
    expect(found.status).toBe(200);
    expect(found.body.data).toEqual([
      { id: shopId, name: 'Shop', username: CANARY_USERNAME, origins: [ORIGIN], matchKind: 'exact', hasTotp: true, updatedAt: expect.any(String) },
    ]);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'username', origin: ORIGIN, purpose: 'login' })).body.data).toEqual({ value: CANARY_USERNAME });
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' })).body.data).toEqual({ value: CANARY_PASSWORD });
    const totp = await agent('post', `/credentials/${shopId}/totp`, oat, { origin: ORIGIN, purpose: 'mfa' });
    expect(totp.status).toBe(200);
    expect(totp.body.data.code).toMatch(/^\d{6}$/);
    totpCodes.push(totp.body.data.code);

    const wrong = await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: 'https://login-app.example.test', purpose: 'login' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('ORIGIN_MISMATCH');

    for (const path of [`/api/secrets/${shopId}`, '/api/secrets']) {
      const res = await http().get(path).set(bearer(oat));
      expect([path, [401, 403].includes(res.status)]).toEqual([path, true]);
    }
  });

  it('e) creates a login with a generated password (returned once), then rotates it with a generated one (a new version)', async () => {
    const created = await agent('post', '/credentials', oat, {
      name: 'New site', username: 'person-b@example.test', origin: 'https://new.example.test',
      generate: { length: 28, symbols: true }, purpose: 'signup',
    });
    expect(created.status).toBe(201);
    createdId = created.body.data.id;
    generatedCreate = created.body.data.generatedPassword;
    expect(generatedCreate).toHaveLength(28);

    const rotated = await agent('post', `/credentials/${createdId}/password`, oat, {
      origin: 'https://new.example.test', generate: { length: 22, symbols: false }, purpose: 'password_change',
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.version).toBe(2);
    generatedRotate = rotated.body.data.generatedPassword;
    expect(generatedRotate).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(generatedRotate).not.toBe(generatedCreate);
    expect(await prisma.secretVersion.count({ where: { secretId: createdId } })).toBe(2);
    expect(await prisma.secretVersion.count({ where: { secretId: createdId, isCurrent: true } })).toBe(1);

    // The user reads the current value in Vault (a session route), never an agent response again.
    const stored = await http().get(`/api/secrets/${createdId}`).set(bearer(session)).expect(200);
    expect(stored.body.data.values.password).toBe(generatedRotate);
  });

  it('f) Person A sees all of it in the activity list (with the client name, never a value) and in the inbox', async () => {
    const res = await http().get('/api/agent-activity?pageSize=100').set(bearer(session)).expect(200);
    const items = res.body.data as Array<Record<string, any>>;
    for (const item of items) agentActivityItemSchema.parse(item);
    for (const action of ['lookup', 'fill', 'totp', 'create', 'rotate', 'agent_access']) {
      expect(items.map((i) => i.action)).toContain(action);
    }
    expect(items.find((i) => i.action === 'fill' && i.result === 'ok')).toMatchObject({
      secretId: shopId, secretName: 'Shop', clientName: 'Agent Runtime A', credentialKind: 'oauth', origin: ORIGIN,
    });
    expect(items.find((i) => i.result === 'denied')).toMatchObject({ action: 'fill', reason: 'origin_mismatch' });
    expect(items.find((i) => i.action === 'create')).toMatchObject({ secretId: createdId, clientName: 'Agent Runtime A' });
    expect(items.find((i) => i.action === 'rotate')).toMatchObject({ secretId: createdId });
    const text = JSON.stringify(res.body);
    for (const leak of [CANARY_PASSWORD, SEED, generatedCreate, generatedRotate, ...totpCodes]) expect(text).not.toContain(leak);

    const rows = await waitFor(inbox, (r) => r.filter((n) => n.eventKey === 'vault.agent_credential_changed').length >= 2);
    const keys = rows.map((n) => n.eventKey);
    expect(keys).toContain('vault.agent_new_app');
    expect(keys.filter((k) => k === 'vault.agent_credential_changed')).toHaveLength(2);
  });

  it('g) revoking the grant in Connected apps makes the very next agent call answer 401', async () => {
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'agent.credential.fill', actorUserId: userId, targetId: shopId }, orderBy: { createdAt: 'desc' } });
    grantId = String((audit.meta as { grantId: string }).grantId);
    const grants = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
    expect((grants.body.data as Array<{ id: string }>).map((g) => g.id)).toContain(grantId);
    expect((await agent('get', '/whoami', oat)).status).toBe(200);

    await http().delete(`/api/oauth/grants/${grantId}`).set(bearer(session)).expect((r) => expect([200, 204]).toContain(r.status));
    expect((await agent('get', `/credentials?origin=${encodeURIComponent(ORIGIN)}`, oat)).status).toBe(401);
    expect((await agent('post', `/credentials/${shopId}/fill`, oat, { field: 'password', origin: ORIGIN, purpose: 'login' })).status).toBe(401);
  });

  it('h) a second client for /api/mcp: initialize, tools/list, search finds the opened login without its password, create with generatePassword returns no value', async () => {
    mcpToken = await connectClient('Assistant B', MCP_SCOPES, '/api/mcp');

    const init = await mcp(mcpToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Assistant B', version: '1.0' } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('vault');
    const list = await mcp(mcpToken, 'tools/list');
    expect(list.status).toBe(200);
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['search_secrets', 'create_secret']));

    const found = await mcpTool(mcpToken, 'search_secrets', { query: 'Shop' });
    expect(found.data.items.map((i: { id: string }) => i.id)).toEqual([shopId]);
    expect(found.data.items[0].fields).toEqual({ username: CANARY_USERNAME, url: ORIGIN });

    const created = await mcpTool(mcpToken, 'create_secret', {
      type: 'Credential', name: 'Mcp site', fields: { username: 'person-c@example.test', url: 'https://mcp.example.test' },
      generatePassword: { length: 30, symbols: true }, allowAgents: true,
    });
    expect(created.isError).toBe(false);
    expect(created.data).toMatchObject({ name: 'Mcp site', passwordGenerated: true, passwordReturned: false });
    const stored = (await http().get(`/api/secrets/${created.data.id}`).set(bearer(session)).expect(200)).body.data.values.password as string;
    expect(stored).toHaveLength(30);
    mcpGenerated.push(stored);
    expect((await mcpTool(mcpToken, 'search_secrets', { query: 'Mcp site' })).data.count).toBe(1);
  });

  it('i) canary scan: no password, generated password, seed or code in any log, audit row, notification or leaking response', async () => {
    const needles = [CANARY_PASSWORD, SEED, generatedCreate, generatedRotate, ...mcpGenerated, ...totpCodes];
    expect(needles.every((n) => n.length >= 6)).toBe(true);
    const mentions = (text: string, needle: string) =>
      new RegExp(`(?<![0-9A-Za-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9A-Za-z])`).test(text);

    const auditRows = await prisma.auditEvent.findMany();
    const notifications = await prisma.notification.findMany();
    const haystacks: Array<[string, string]> = [
      ['logs', lines.join('\n')],
      ['audit', JSON.stringify(auditRows)],
      ['notifications', JSON.stringify(notifications)],
      ['mcp responses', mcpBodies.join('\n')],
    ];
    for (const [where, text] of haystacks) {
      for (const needle of needles) expect([where, mentions(text, needle)]).toEqual([where, false]);
    }
    expect(lines.join('\n')).not.toContain(CANARY_USERNAME);

    // The agent responses carry a value only where they are meant to: the password fill, the
    // totp response, and the create and rotate that generated one.
    const countIn = (needle: string) => bodies.filter((b) => mentions(b, needle)).length;
    expect(countIn(CANARY_PASSWORD)).toBe(1);
    expect(countIn(generatedCreate)).toBe(1);
    expect(countIn(generatedRotate)).toBe(1);
    expect(countIn(SEED)).toBe(0);
    for (const code of totpCodes) expect(bodies.filter((b) => b.includes(`"code":"${code}"`))).toHaveLength(1);
    // Nothing the scan covered is empty: the run really did log, audit and notify.
    expect(lines.length).toBeGreaterThan(0);
    expect(auditRows.some((r) => r.action.startsWith('agent.credential.'))).toBe(true);
    expect(auditRows.some((r) => r.action === 'mcp.tool.call')).toBe(true);
    expect(notifications.length).toBeGreaterThan(0);
  });
});
