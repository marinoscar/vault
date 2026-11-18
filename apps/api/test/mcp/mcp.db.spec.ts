// =============================================================================
// The Vault MCP server over real Postgres (issue #180, E14.8, epic #172)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, the OAuth server and the
// agent kill switch, and a REAL authorization-code + PKCE flow (platform test kit) that yields an
// `oat_` token for the `mcp` resource. Drives POST /api/mcp the way a chat assistant does:
// initialize -> tools/list -> search_secrets -> get_secret -> list_secret_types -> create_secret
// (generatePassword) -> update_secret. Proves, end to end:
//
//   - the transport: raw JSON-RPC (no `{ data }` envelope), 202 for a notification, 405 for GET and
//     DELETE, batch and unsupported-version refusals, the Origin rule BEFORE authentication;
//   - the kill switch (tools/call 403 AGENT_ACCESS_DISABLED while initialize and tools/list work);
//   - the scope step-up: a read-only token calling a write tool gets 403 insufficient_scope with a
//     challenge naming vault:mcp_write, and re-consent (a wider token) fixes it;
//   - route confinement: an `agent` token is refused on /api/mcp and an `mcp` token on /api/agent/v1;
//   - visibility: only the caller's own logins opened to agents; closed, foreign and card secrets
//     are not found; the card type is neither listed nor creatable;
//   - generatePassword stores a value that meets the policy and returns none;
//   - the rate limit (429 with Retry-After) and the audit row `mcp.tool.call`;
//   - SECRET EGRESS: no canary, model-sent or generated value in any response, audit row, log line
//     or console line (the decrypted values are read back only through the session routes).
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
const SCOPES = ['vault:mcp_read', 'vault:mcp_write'];
const SENT_PASSWORD = 'ModelSentPw-3Hx8-do-not-echo';
const SENT_KEY = 'sk-model-sent-key-5Rt2-do-not-echo';
const CARD_NUMBER = '4111111111111111';
const CARD_CVV = '737';

describeWithDb('Vault MCP server (real Postgres, E14.8)', () => {
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
  let apiKeyTypeId = '';
  let cardTypeId = '';
  let oat = '';
  const savedEnv: Record<string, string | undefined> = {};
  const lines: string[] = [];
  const bodies: string[] = [];
  const restores: Array<() => void> = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = () => app.get(SystemSettingsService);

  let rpcId = 0;
  /** One JSON-RPC POST; the response is kept for the egress check. */
  const rpc = async (token: string | null, method: string, params?: object, headers: Record<string, string> = {}, body?: unknown) => {
    let req = http().post('/api/mcp').set({ 'mcp-protocol-version': '2025-06-18', ...headers });
    if (token) req = req.set(bearer(token));
    const payload = body !== undefined ? body : { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) };
    const res = await req.send(payload as object);
    bodies.push(JSON.stringify({ method, status: res.status, body: res.body }));
    return res;
  };
  /** One tools/call; `result` is the tool result (absent on an HTTP or JSON-RPC error). */
  const tool = async (token: string, name: string, args: object = {}) => {
    const res = await rpc(token, 'tools/call', { name, arguments: args });
    const result = res.body?.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean } | undefined;
    return { res, result, data: result?.structuredContent };
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

    apiKeyTypeId = (
      await prisma.secretType.create({
        data: { name: 'API Key', isSystem: true, createdById: userId, fields: [field('key', true, true), field('provider', false), field('notes', false)] },
      })
    ).id;
    cardTypeId = (
      await prisma.secretType.create({
        data: {
          name: 'Card', isSystem: true, createdById: userId,
          fields: [field('cardholder_name', true), field('number', true, true), field('exp_month', true), field('exp_year', true), field('cvv', true, true)],
        },
      })
    ).id;

    // OAuth server on, and a real authorization-code + PKCE flow for the MCP scope set.
    await settings().patchSettings({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } } as never, userId);
    app.get(OAuthServerSettingsReader).invalidate();
    const made = await createOAuthTestClient(prisma as never, { tokenEndpointAuthMethod: 'client_secret_post' });
    const flow = await runOAuthAuthorizationCodeFlow(app, {
      client: made, user: { sessionToken: session }, scopes: SCOPES, resource: `${appUrl}/api/mcp`,
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
  let cardId = '';
  const generatedValues: string[] = [];

  const missing = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';

  it('speaks raw JSON-RPC (no { data } envelope): initialize, then notifications/initialized is a 202, ping works', async () => {
    const init = await rpc(oat, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Client A', version: '1.0' } });
    expect(init.status).toBe(200);
    expect(init.body).not.toHaveProperty('data');
    expect(init.body).toMatchObject({ jsonrpc: '2.0', result: { protocolVersion: '2025-06-18', serverInfo: { name: 'vault' } } });
    expect(init.body.result.capabilities.tools).toBeDefined();
    expect(init.body.result.instructions).toMatch(/never returns a secret value/);

    const note = await http().post('/api/mcp').set(bearer(oat)).set('mcp-protocol-version', '2025-06-18').send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
    expect(note.text).toBe('');
    expect((await rpc(oat, 'ping')).body.result).toEqual({});
    // An unknown protocol revision in initialize is answered with the latest handshake revision.
    expect((await rpc(oat, 'initialize', { protocolVersion: '1999-01-01' }, { 'mcp-protocol-version': '' })).body.result.protocolVersion).toBe('2025-11-25');
  });

  it('is OFF by default: tools/call is 403 AGENT_ACCESS_DISABLED while initialize and tools/list work', async () => {
    const list = await rpc(oat, 'tools/list');
    expect(list.status).toBe(200);
    const denied = await rpc(oat, 'tools/call', { name: 'search_secrets', arguments: {} });
    expect(denied.status).toBe(403);
    expect(denied.body.error.data).toEqual({ code: 'AGENT_ACCESS_DISABLED' });
    const row = await prisma.auditEvent.findFirst({ where: { action: 'mcp.tool.call' } });
    expect(row?.meta).toMatchObject({ tool: 'search_secrets', result: 'denied:disabled', credential: 'oauth' });

    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
    expect((await tool(oat, 'list_secret_types')).res.status).toBe(200);
  });

  it('tools/list: five tools, each with a title, an input schema, annotations and a scope', async () => {
    const res = await rpc(oat, 'tools/list');
    const tools = res.body.result.tools as Array<any>;
    expect(tools.map((t) => t.name)).toEqual(['search_secrets', 'get_secret', 'list_secret_types', 'create_secret', 'update_secret']);
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations).toEqual(expect.objectContaining({ readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean), idempotentHint: expect.any(Boolean) }));
      expect(t.securitySchemes[0].scopes).toHaveLength(1);
    }
    expect(tools.find((t) => t.name === 'create_secret').annotations.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === 'search_secrets').securitySchemes[0].scopes).toEqual(['vault:mcp_read']);
  });

  it('seeds secrets through the session routes (a login opened to agents, closed, foreign, a card)', async () => {
    shopId = await createSecret(session, credTypeId, 'Shop', { username: CANARY_USERNAME, password: CANARY_PASSWORD, url: ORIGIN, totp: SEED, notes: 'Shop login' });
    await openToAgents(session, shopId);
    closedId = await createSecret(session, credTypeId, 'Closed', { username: 'closed@example.test', password: 'ClosedPw-1-do-not-leak', url: 'https://closed.example.test' });
    foreignId = await createSecret(otherSession, credTypeId, 'Theirs', { username: 'theirs@example.test', password: 'TheirsPw-1-do-not-leak', url: ORIGIN });
    await openToAgents(otherSession, foreignId);
    cardId = await createSecret(session, cardTypeId, 'Card A', { cardholder_name: 'Person A', number: CARD_NUMBER, exp_month: '12', exp_year: '2031', cvv: CARD_CVV });
  });

  it('search_secrets: only the caller\'s open logins, non-sensitive fields only, filters by query and origin', async () => {
    const all = await tool(oat, 'search_secrets');
    expect(all.res.status).toBe(200);
    expect(all.data.items).toEqual([
      { id: shopId, name: 'Shop', type: 'Credential', origins: [ORIGIN], agentAccess: 'fill', version: 1, updatedAt: expect.any(String), fields: { username: CANARY_USERNAME, url: ORIGIN, notes: 'Shop login' } },
    ]);
    expect((await tool(oat, 'search_secrets', { query: 'sho' })).data.count).toBe(1);
    expect((await tool(oat, 'search_secrets', { query: 'closed' })).data.count).toBe(0);
    expect((await tool(oat, 'search_secrets', { origin: ORIGIN })).data.items.map((i: { id: string }) => i.id)).toEqual([shopId]);
    expect((await tool(oat, 'search_secrets', { origin: 'https://other.example.org' })).data.count).toBe(0);
    expect((await tool(oat, 'search_secrets', { type: 'Card' })).data.count).toBe(0);
    expect((await tool(oat, 'search_secrets', { limit: 500 })).result?.isError).toBe(true);
  });

  it('get_secret: metadata and non-sensitive fields, sensitive fields "[hidden]"; the rest is not found', async () => {
    const got = await tool(oat, 'get_secret', { id: shopId });
    expect(got.data.secret).toMatchObject({ id: shopId, name: 'Shop', agentAccess: 'fill', fields: { username: CANARY_USERNAME, password: '[hidden]', totp: '[hidden]', url: ORIGIN } });
    const answers = new Set<string>();
    for (const id of [closedId, foreignId, cardId, missing]) {
      const miss = await tool(oat, 'get_secret', { id });
      expect(miss.result?.isError).toBe(true);
      expect(miss.data.code).toBe('NOT_FOUND');
      answers.add(miss.result!.content[0]!.text);
    }
    expect(answers.size).toBe(1);
  });

  it('list_secret_types: names and field definitions; no card type', async () => {
    const { data } = await tool(oat, 'list_secret_types');
    const names = data.types.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['API Key', 'Credential', 'Note']));
    expect(names).not.toContain('Card');
    const cred = data.types.find((t: { name: string }) => t.name === 'Credential');
    expect(cred.fields.find((f: { name: string }) => f.name === 'password')).toMatchObject({ sensitive: true, required: true });
  });

  let createdId = '';

  it('create_secret with generatePassword: stored, meets the policy, NOT returned; opened to agents on request', async () => {
    const created = await tool(oat, 'create_secret', {
      type: 'Credential', name: 'New site', fields: { username: 'person-b@example.test', url: 'https://new.example.test' },
      generatePassword: { length: 32, symbols: true }, allowAgents: true,
    });
    expect(created.res.status).toBe(200);
    expect(created.result?.isError).toBeUndefined();
    createdId = created.data.id;
    expect(created.data).toMatchObject({ name: 'New site', type: 'Credential', agentAccess: 'fill', version: 1, passwordGenerated: true, passwordReturned: false, origins: ['https://new.example.test'] });

    // The value is read back through the SESSION route only (the user reads it in Vault).
    const stored = (await http().get(`/api/secrets/${createdId}`).set(bearer(session)).expect(200)).body.data.values.password as string;
    expect(stored).toHaveLength(32);
    expect(/[a-z]/.test(stored) && /[A-Z]/.test(stored) && /[0-9]/.test(stored) && /[^A-Za-z0-9]/.test(stored)).toBe(true);
    generatedValues.push(stored);
    expect(JSON.stringify(created.res.body)).not.toContain(stored);

    const row = await prisma.secret.findUniqueOrThrow({ where: { id: createdId } });
    expect(row).toMatchObject({ createdById: userId, agentAccess: 'fill' });
    expect((await tool(oat, 'search_secrets', { query: 'New site' })).data.count).toBe(1);
  });

  it('create_secret: closed by default (invisible to MCP afterwards), API Key, supplied values not echoed, card refused', async () => {
    const closed = await tool(oat, 'create_secret', { type: 'Credential', name: 'Private login', fields: { username: 'u', password: SENT_PASSWORD, url: 'https://private.example.test' } });
    expect(closed.data).toMatchObject({ agentAccess: 'none' });
    expect((await tool(oat, 'search_secrets', { query: 'Private' })).data.count).toBe(0);
    expect((await tool(oat, 'get_secret', { id: closed.data.id })).result?.isError).toBe(true);
    expect((await tool(oat, 'update_secret', { id: closed.data.id, fields: { notes: 'x' } })).data.code).toBe('NOT_FOUND');
    const stored = await http().get(`/api/secrets/${closed.data.id}`).set(bearer(session)).expect(200);
    expect(stored.body.data.values.password).toBe(SENT_PASSWORD);

    const key = await tool(oat, 'create_secret', { type: 'API Key', name: 'Key A', fields: { key: SENT_KEY, provider: 'Provider A' } });
    expect(key.data).toMatchObject({ type: 'API Key', agentAccess: 'none' });
    expect((await http().get(`/api/secrets/${key.data.id}`).set(bearer(session)).expect(200)).body.data.values.key).toBe(SENT_KEY);
    expect((await tool(oat, 'create_secret', { type: 'API Key', name: 'Key B', fields: { key: 'k' }, allowAgents: true })).result?.isError).toBe(true);

    const card = await tool(oat, 'create_secret', { type: 'Card', name: 'Card B', fields: { cardholder_name: 'Person A', number: CARD_NUMBER, cvv: CARD_CVV } });
    expect(card.data.code).toBe('TYPE_NOT_SUPPORTED');
    expect(await prisma.secret.count({ where: { name: 'Card B' } })).toBe(0);
    expect((await tool(oat, 'create_secret', { type: 'Credential', name: 'Shop', fields: { username: 'u', password: 'x' } })).data.code).toBe('CONFLICT');
  });

  it('update_secret: merges server-side, a new version, never echoes; the website fields are refused', async () => {
    const updated = await tool(oat, 'update_secret', { id: shopId, fields: { notes: 'changed note' } });
    expect(updated.data).toEqual({ id: shopId, version: 2, changed: true, updatedFields: ['notes'] });
    let values = (await http().get(`/api/secrets/${shopId}`).set(bearer(session)).expect(200)).body.data;
    expect(values.currentVersion).toBe(2);
    expect(values.values).toMatchObject({ username: CANARY_USERNAME, password: CANARY_PASSWORD, totp: expect.stringContaining(SEED), notes: 'changed note' });
    expect(await prisma.secretVersion.count({ where: { secretId: shopId, isCurrent: true } })).toBe(1);

    const rotated = await tool(oat, 'update_secret', { id: shopId, fields: { password: SENT_PASSWORD } });
    expect(rotated.data.version).toBe(3);
    values = (await http().get(`/api/secrets/${shopId}`).set(bearer(session)).expect(200)).body.data;
    expect(values.values.password).toBe(SENT_PASSWORD);
    expect(values.values.username).toBe(CANARY_USERNAME);

    expect((await tool(oat, 'update_secret', { id: shopId, fields: { url: 'https://evil.example.test' } })).data.code).toBe('FIELD_NOT_UPDATABLE');
    expect((await tool(oat, 'update_secret', { id: foreignId, fields: { notes: 'x' } })).data.code).toBe('NOT_FOUND');
    expect((await tool(oat, 'update_secret', { id: closedId, fields: { notes: 'x' } })).data.code).toBe('NOT_FOUND');
    expect((await tool(oat, 'update_secret', { id: shopId, fields: { nope: 'x' } })).result?.isError).toBe(true);
    expect((await tool(oat, 'update_secret', { id: shopId, fields: { notes: 'changed note' } })).data).toMatchObject({ changed: false, version: 3 });
  });

  it('scopes: a read-only token gets 403 insufficient_scope naming vault:mcp_write on a write tool; a wider token fixes it', async () => {
    const mint = async (scopes: string[]) => (await mintOAuthTestToken(prisma as never, { userId, resourceId: 'mcp', scopes, appUrl, orgId })).token;
    const readOnly = await mint(['vault:mcp_read']);
    expect((await tool(readOnly, 'search_secrets')).res.status).toBe(200);
    expect((await rpc(readOnly, 'tools/list')).status).toBe(200);
    for (const [name, args] of [
      ['create_secret', { type: 'Credential', name: 'Nope', fields: { username: 'u' } }],
      ['update_secret', { id: shopId, fields: { notes: 'x' } }],
    ] as const) {
      const res = await rpc(readOnly, 'tools/call', { name, arguments: args });
      expect([name, res.status]).toEqual([name, 403]);
      const challenge = String(res.headers['www-authenticate']);
      expect(challenge).toContain('insufficient_scope');
      expect(challenge).toContain('vault:mcp_write');
    }
    expect(await prisma.secret.count({ where: { name: 'Nope' } })).toBe(0);
    // Re-consent: a token with the write scope succeeds.
    expect((await tool(await mint(SCOPES), 'create_secret', { type: 'Credential', name: 'Reconsented', fields: { username: 'u' }, generatePassword: {} })).res.status).toBe(200);
    // The audit trail has no row for the step-up (the call never started).
    const nope = await prisma.auditEvent.count({ where: { action: 'mcp.tool.call', meta: { path: ['tool'], equals: 'update_secret' }, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    expect(nope).toBeGreaterThan(0);
  });

  it('route confinement: an agent token is refused on /api/mcp, and an mcp token on /api/agent/v1 and the UI routes', async () => {
    const agentToken = (await mintOAuthTestToken(prisma as never, { userId, resourceId: 'agent', scopes: ['vault:items_read'], appUrl, orgId })).token;
    const refused = await rpc(agentToken, 'tools/list');
    expect([401, 403]).toContain(refused.status);
    for (const path of ['/api/agent/v1/whoami', '/api/secrets', `/api/secrets/${shopId}`, '/api/auth/me']) {
      const res = await http().get(path).set(bearer(oat));
      expect([path, [401, 403].includes(res.status)]).toEqual([path, true]);
    }
  });

  it('transport: GET and DELETE are 405 with Allow, a batch and an unsupported revision are 400, a bad body is -32600', async () => {
    for (const method of ['get', 'delete'] as const) {
      const res = await http()[method]('/api/mcp').set(bearer(oat));
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
    expect((await http().get('/api/mcp')).status).toBe(401);
    const batch = await rpc(oat, 'ping', undefined, {}, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(batch.status).toBe(400);
    expect(batch.body.error.code).toBe(-32600);
    const old = await rpc(oat, 'tools/list', undefined, { 'mcp-protocol-version': '1999-01-01' });
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe(-32022);
    expect(old.body.error.data.supported).toContain('2026-07-28');
    expect((await rpc(oat, 'ping', undefined, {}, { jsonrpc: '1.0', id: 1, method: 'ping' })).body.error.code).toBe(-32600);
    expect((await rpc(oat, 'resources/list')).body.error.code).toBe(-32601);
    expect((await rpc(oat, 'tools/list', undefined, { 'mcp-method': 'ping' })).body.error.code).toBe(-32020);
  });

  it('Origin rule: a foreign Origin is 403 even before authentication; the application origin and no Origin pass', async () => {
    const evil = await http().post('/api/mcp').set('origin', 'https://evil.example.test').set(bearer(oat)).send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(evil.status).toBe(403);
    const unauthenticated = await http().post('/api/mcp').set('origin', 'https://evil.example.test').send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(unauthenticated.status).toBe(403);
    expect((await http().post('/api/mcp').set('origin', 'http://localhost:6274').set(bearer(oat)).send({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(403);
    const own = await http().post('/api/mcp').set('origin', appUrl).set(bearer(oat)).send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(own.status).toBe(200);
    expect((await http().post('/api/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
  });

  it('credentials: a personal access token and a session bearer are accepted; the kill switch applies to them too', async () => {
    const pat = await createPat(userId, 'mcp pat');
    const found = await tool(pat, 'search_secrets', { query: 'Shop' });
    expect(found.res.status).toBe(200);
    expect(found.data.items.map((i: { id: string }) => i.id)).toEqual([shopId]);
    expect((await tool(session, 'list_secret_types')).res.status).toBe(200);
    const row = await prisma.auditEvent.findFirst({ where: { action: 'mcp.tool.call', actorUserId: userId, meta: { path: ['credential'], equals: 'pat' } }, orderBy: { createdAt: 'desc' } });
    expect(row?.meta).toMatchObject({ credential: 'pat', patId: expect.any(String), tool: 'search_secrets', result: 'ok' });
    // A viewer-level user without secrets:write cannot use a write tool, and no step-up can fix that.
    const noWrite = await prisma.role.findUniqueOrThrow({ where: { name: 'viewer' } });
    const viewer = await prisma.user.create({ data: { email: 'viewer-mcp@example.test', providerDisplayName: 'Person C', isActive: true } });
    await prisma.membership.create({ data: { userId: viewer.id, orgId, roleId: noWrite.id, status: 'active' } });
    const viewerPat = await createPat(viewer.id, 'viewer pat');
    expect((await tool(viewerPat, 'search_secrets')).res.status).toBe(200);
    const forbidden = await rpc(viewerPat, 'tools/call', { name: 'create_secret', arguments: { type: 'Credential', name: 'V', fields: { username: 'u' } } });
    expect(forbidden.status).toBe(403);
    expect(String(forbidden.headers['www-authenticate'] ?? '')).not.toContain('insufficient_scope');
  });

  it('rate limit: tools/call is capped per token and user with Retry-After; initialize and tools/list are not', async () => {
    const pat = await createPat(userId, 'limited pat');
    let limited: Awaited<ReturnType<typeof rpc>> | undefined;
    for (let i = 0; i < 61 && !limited; i++) {
      const res = await rpc(pat, 'tools/call', { name: 'list_secret_types', arguments: {} });
      if (res.status === 429) limited = res;
      else expect(res.status).toBe(200);
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error.data).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited?.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await rpc(pat, 'tools/list')).status).toBe(200);
    expect((await tool(await createPat(userId, 'fresh pat'), 'list_secret_types')).res.status).toBe(200);
  });

  it('audit: one mcp.tool.call row per call (tool, client, secret id, result), no value', async () => {
    const rows = await prisma.auditEvent.findMany({ where: { action: 'mcp.tool.call' }, orderBy: { createdAt: 'asc' } });
    const tools = new Set(rows.map((r) => (r.meta as { tool: string }).tool));
    for (const name of ['search_secrets', 'get_secret', 'list_secret_types', 'create_secret', 'update_secret']) expect(tools).toContain(name);
    const results = new Set(rows.map((r) => (r.meta as { result: string }).result));
    for (const expected of ['ok', 'denied:disabled', 'denied:rate_limited', 'error:not_found', 'error:field_not_updatable', 'error:type_not_supported']) expect(results).toContain(expected);
    const get = rows.find((r) => (r.meta as { tool: string; result: string }).tool === 'get_secret' && r.targetId === shopId)!;
    expect(get.actorUserId).toBe(userId);
    expect(get.targetType).toBe('secret');
    expect(get.meta).toMatchObject({ credential: 'oauth', clientId: expect.any(String), grantId: expect.any(String), secretId: shopId });
    const create = rows.find((r) => (r.meta as { tool: string; result: string }).tool === 'create_secret' && (r.meta as { result: string }).result === 'ok')!;
    expect(create.targetId).toBe(createdId);
  });

  it('SECRET EGRESS: no canary, model-sent, card or generated value in any MCP response, audit row, log line or console line', async () => {
    const needles = [CANARY_PASSWORD, SEED, SENT_PASSWORD, SENT_KEY, CARD_NUMBER, CARD_CVV, 'ClosedPw-1-do-not-leak', 'TheirsPw-1-do-not-leak', ...generatedValues];
    expect(generatedValues.length).toBeGreaterThan(0);
    const auditRows = await prisma.auditEvent.findMany({ where: { action: { in: ['mcp.tool.call'] } } });
    const haystacks: Array<[string, string]> = [
      ['responses', bodies.join('\n')],
      ['mcp audit', JSON.stringify(auditRows)],
      ['logs', lines.join('\n')],
    ];
    for (const [where, text] of haystacks) {
      for (const needle of needles) expect([where, needle.length > 3 && text.includes(needle)]).toEqual([where, false]);
    }
    expect(lines.join('\n')).not.toContain(CANARY_USERNAME);
    expect(otherUserId).not.toBe(userId);
  });
});
