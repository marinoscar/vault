// =============================================================================
// MCP reveal_secret over real Postgres (issue #244, ADR-0005)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, the OAuth server and a
// REAL authorization-code + PKCE flow yielding an `oat_` token with `vault:mcp_read` + `vault:mcp_reveal`.
// Proves, end to end:
//
//   - the owner switches "Reveal to assistants" on with a personal access token (PATCH
//     /api/secrets/:id/assistant-reveal) and `reveal_secret` returns exactly the one field value;
//   - a token with only `vault:mcp_read` gets 403 insufficient_scope naming `vault:mcp_reveal`;
//   - reveal off, a missing secret, another user's revealed secret and a card are all "not found";
//   - an `oat_` token is refused (403) on the toggle route, a Card is 422, a foreign secret is 404;
//   - SECRET EGRESS: after reveals, the plaintext appears in no audit_events row, no agent-activity
//     response, no other response and no log line; the field NAME does (audit meta, Agent activity).
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
const SCOPES = ['vault:mcp_read', 'vault:mcp_reveal'];
const REVEALED_KEY = 'sk-revealed-key-8Wn3-reveal-me';
const REVEALED_PASSWORD = 'RevealedPw-6Tj5-reveal-me';
const FOREIGN_KEY = 'sk-foreign-key-2Pq7-do-not-leak';
const CLOSED_KEY = 'sk-closed-key-9Bd4-do-not-leak';
const SENT_PASSWORD = 'ModelSentPw-3Hx8-do-not-echo';
const SENT_KEY = 'sk-model-sent-key-5Rt2-do-not-echo';
const CARD_NUMBER = '4111111111111111';
const CARD_CVV = '737';

describeWithDb('MCP reveal_secret (real Postgres, #244)', () => {
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


  let pat = '';
  let keyId = '';
  let loginId = '';
  let closedKeyId = '';
  let foreignKeyId = '';
  let cardId = '';
  let readOnly = '';
  let otherReveal = '';
  const missing = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
  const toggle = (token: string, id: string, enabled: boolean) =>
    http().patch(`/api/secrets/${id}/assistant-reveal`).set(bearer(token)).send({ enabled });

  it('seeds secrets through the session routes and turns agent access on', async () => {
    pat = await createPat(userId, 'reveal pat');
    keyId = await createSecret(session, apiKeyTypeId, 'Key A', { key: REVEALED_KEY, provider: 'Provider A' });
    loginId = await createSecret(session, credTypeId, 'Login A', { username: CANARY_USERNAME, password: REVEALED_PASSWORD, url: ORIGIN, totp: SEED });
    closedKeyId = await createSecret(session, apiKeyTypeId, 'Key Closed', { key: CLOSED_KEY, provider: 'Provider A' });
    foreignKeyId = await createSecret(otherSession, apiKeyTypeId, 'Key Foreign', { key: FOREIGN_KEY, provider: 'Provider B' });
    cardId = await createSecret(session, cardTypeId, 'Card A', { cardholder_name: 'Person A', number: CARD_NUMBER, exp_month: '12', exp_year: '2031', cvv: CARD_CVV });
    await settings().patchSettings({ agentAccess: { enabled: true, revealPerMinute: 100 } } as never, userId);
    readOnly = (await mintOAuthTestToken(prisma as never, { userId, resourceId: 'mcp', scopes: ['vault:mcp_read'], appUrl, orgId })).token;
    otherReveal = (await mintOAuthTestToken(prisma as never, { userId: otherUserId, resourceId: 'mcp', scopes: SCOPES, appUrl, orgId })).token;
    // Closed by default: the column defaults to false.
    expect((await prisma.secret.findUniqueOrThrow({ where: { id: keyId } })).assistantReveal).toBe(false);
  });

  it('is not found before the owner opts in (the same answer as a missing secret)', async () => {
    const off = await tool(oat, 'reveal_secret', { id: keyId, field: 'key' });
    const gone = await tool(oat, 'reveal_secret', { id: missing, field: 'key' });
    expect(off.res.status).toBe(200);
    expect(off.result?.isError).toBe(true);
    expect(off.data.code).toBe('NOT_FOUND');
    expect(off.result).toEqual(gone.result);
  });

  it('toggle route: an oat_ token is 403, a foreign secret is 404, a Card is 422, a bad body is 400; the column is unchanged', async () => {
    expect((await toggle(oat, keyId, true)).status).toBe(403);
    expect((await toggle(otherSession, keyId, true)).status).toBe(404);
    expect((await toggle(session, missing, true)).status).toBe(404);
    const card = await toggle(pat, cardId, true);
    expect(card.status).toBe(422);
    expect(JSON.stringify(card.body)).toContain('ASSISTANT_REVEAL_UNSUPPORTED_TYPE');
    expect((await toggle(pat, keyId, 'yes' as never)).status).toBe(400);
    expect((await http().patch(`/api/secrets/${keyId}/assistant-reveal`).send({ enabled: true })).status).toBe(401);
    for (const id of [keyId, cardId, foreignKeyId]) {
      expect([id, (await prisma.secret.findUniqueOrThrow({ where: { id } })).assistantReveal]).toEqual([id, false]);
    }
  });

  it('owner toggles reveal on with a PAT (audited, no value); the list filter and search_secrets show it', async () => {
    const on = await toggle(pat, keyId, true);
    expect(on.status).toBe(200);
    // Like the agent-access toggle, the owner's own session/PAT response is the secret detail (decrypted on read
    // by design); the egress guarantees below are about the MCP, audit and activity surfaces.
    expect(on.body.data).toMatchObject({ id: keyId, assistantReveal: true });
    expect(await toggle(session, loginId, true).then((r) => r.status)).toBe(200);
    expect(await toggle(pat, loginId, true).then((r) => r.status)).toBe(200); // idempotent

    const row = await prisma.secret.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.assistantReveal).toBe(true);
    expect(row.assistantRevealChangedAt).not.toBeNull();
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'secret.assistant_reveal.update', targetId: keyId }, orderBy: { createdAt: 'desc' } });
    expect(audit?.actorUserId).toBe(userId);
    expect(JSON.stringify(audit)).not.toContain(REVEALED_KEY);

    const listed = await http().get('/api/secrets').query({ assistantReveal: 'true' }).set(bearer(session)).expect(200);
    expect((listed.body.data.items as Array<{ id: string }>).map((i) => i.id).sort()).toEqual([keyId, loginId].sort());
    expect(JSON.stringify(listed.body)).not.toContain(REVEALED_KEY);

    const found = await tool(oat, 'search_secrets', { query: 'Key A' });
    expect(found.data.items.map((i: { id: string }) => i.id)).toEqual([keyId]);
    expect(found.data.items[0].assistantReveal).toBe(true);
    expect(JSON.stringify(found.res.body)).not.toContain(REVEALED_KEY);
    const got = await tool(oat, 'get_secret', { id: keyId });
    expect(got.data.secret.fields.key).toBe('[hidden]');
  });

  it('reveal_secret returns exactly the one field value (an API Key, and a login that is closed to filling)', async () => {
    const key = await tool(oat, 'reveal_secret', { id: keyId, field: 'key' });
    expect(key.res.status).toBe(200);
    expect(key.result?.isError).toBeUndefined();
    expect(key.data).toEqual({ id: keyId, name: 'Key A', type: 'API Key', field: 'key', value: REVEALED_KEY });

    const pwd = await tool(oat, 'reveal_secret', { id: loginId, field: 'password' });
    expect(pwd.data).toEqual({ id: loginId, name: 'Login A', type: 'Credential', field: 'password', value: REVEALED_PASSWORD });
    // Siblings of the asked field never ride along.
    for (const text of [JSON.stringify(key.res.body), JSON.stringify(pwd.res.body)]) {
      expect(text).not.toContain(SEED);
    }
    expect(JSON.stringify(key.res.body)).not.toContain('Provider A');
    expect((await tool(oat, 'reveal_secret', { id: keyId, field: 'nope' })).data.code).toBe('FIELD_NOT_FOUND');
  });

  it('a PAT (session-equivalent credential) with the same call is handled by the same gate and returns the value', async () => {
    const res = await tool(pat, 'reveal_secret', { id: keyId, field: 'key' });
    expect(res.data.value).toBe(REVEALED_KEY);
  });

  it('a read-only token gets 403 insufficient_scope naming vault:mcp_reveal; nothing is revealed or audited as a reveal', async () => {
    const before = await prisma.auditEvent.count({ where: { action: 'mcp.tool.call', meta: { path: ['tool'], equals: 'reveal_secret' } } });
    const res = await rpc(readOnly, 'tools/call', { name: 'reveal_secret', arguments: { id: keyId, field: 'key' } });
    expect(res.status).toBe(403);
    const challenge = String(res.headers['www-authenticate']);
    expect(challenge).toContain('insufficient_scope');
    expect(challenge).toContain('vault:mcp_reveal');
    expect(JSON.stringify(res.body)).not.toContain(REVEALED_KEY);
    // The read-only token still reads the non-secret tools.
    expect((await tool(readOnly, 'search_secrets')).res.status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: 'mcp.tool.call', meta: { path: ['tool'], equals: 'reveal_secret' } } })).toBe(before);
  });

  it('another user\'s revealed secret and a closed secret are not found, whoever asks', async () => {
    await toggle(otherSession, foreignKeyId, true).expect(200);
    const foreign = await tool(oat, 'reveal_secret', { id: foreignKeyId, field: 'key' });
    const closed = await tool(oat, 'reveal_secret', { id: closedKeyId, field: 'key' });
    const none = await tool(oat, 'reveal_secret', { id: missing, field: 'key' });
    for (const r of [foreign, closed]) {
      expect(r.result?.isError).toBe(true);
      expect(r.data.code).toBe('NOT_FOUND');
      expect(r.result).toEqual(none.result);
    }
    // The other user can reveal their own, not the first user's.
    expect((await tool(otherReveal, 'reveal_secret', { id: foreignKeyId, field: 'key' })).data.value).toBe(FOREIGN_KEY);
    expect((await tool(otherReveal, 'reveal_secret', { id: keyId, field: 'key' })).data.code).toBe('NOT_FOUND');
    // Cards are never revealable, even when the column is forced on in the database.
    await prisma.secret.update({ where: { id: cardId }, data: { assistantReveal: true } });
    const card = await tool(oat, 'reveal_secret', { id: cardId, field: 'number' });
    expect(card.data.code).toBe('NOT_FOUND');
    expect(JSON.stringify(card.res.body)).not.toContain(CARD_NUMBER);
    expect((await tool(oat, 'reveal_secret', { id: cardId, field: 'cvv' })).data.code).toBe('NOT_FOUND');
    await prisma.secret.update({ where: { id: cardId }, data: { assistantReveal: false } });
  });

  it('switching reveal off closes it again at once', async () => {
    expect((await toggle(session, loginId, false)).status).toBe(200);
    expect((await tool(oat, 'reveal_secret', { id: loginId, field: 'password' })).data.code).toBe('NOT_FOUND');
    expect((await tool(oat, 'reveal_secret', { id: keyId, field: 'key' })).data.value).toBe(REVEALED_KEY);
  });

  it('Agent activity shows the reveals as mcp_reveal with the field name and no value; an oat_ token cannot read it', async () => {
    const res = await http().get('/api/agent-activity').query({ action: 'mcp_reveal' }).set(bearer(session)).expect(200);
    const items = res.body.data as Array<{ action: string; secretId?: string; field?: string | null }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.action === 'mcp_reveal')).toBe(true);
    expect(items.some((i) => i.field === 'key')).toBe(true);
    expect(items.some((i) => i.field === 'password')).toBe(true);
    // The other tools' mcp.tool.call rows (search_secrets, ...) never show as activity.
    const all = await http().get('/api/agent-activity').query({ pageSize: 100 }).set(bearer(session)).expect(200);
    expect((all.body.data as Array<{ action: string }>).every((i) => ['mcp_reveal', 'agent_access', 'lookup', 'fill', 'totp', 'create', 'rotate', 'identity_fill', 'card_grant', 'service_key'].includes(i.action))).toBe(true);
    expect((await http().get('/api/agent-activity').set(bearer(oat))).status).toBe(403);
    // Another user's trail has none of this user's reveals.
    const theirs = await http().get('/api/agent-activity').query({ action: 'mcp_reveal' }).set(bearer(otherSession)).expect(200);
    expect((theirs.body.data as Array<{ secretId?: string }>).some((i) => i.secretId === keyId)).toBe(false);
    bodies.push(JSON.stringify({ activity: res.body, all: all.body, theirs: theirs.body }));
  });

  it('has its own rate limit: more than agentAccess.revealPerMinute (set to 3 here) reveals in a minute is 429', async () => {
    await settings().patchSettings({ agentAccess: { revealPerMinute: 3 } } as never, userId);
    const limited = await mintOAuthTestToken(prisma as never, { userId, resourceId: 'mcp', scopes: SCOPES, appUrl, orgId });
    let last: Awaited<ReturnType<typeof rpc>> | undefined;
    let ok = 0;
    for (let i = 0; i < 12 && !last; i++) {
      const res = await rpc(limited.token, 'tools/call', { name: 'reveal_secret', arguments: { id: keyId, field: 'key' } });
      if (res.status === 429) last = res;
      else {
        expect(res.status).toBe(200);
        ok += 1;
      }
    }
    expect(last?.status).toBe(429);
    expect(ok).toBeLessThanOrEqual(3);
    expect(last?.body.error.data).toMatchObject({ code: 'RATE_LIMITED' });
    expect(JSON.stringify(last?.body)).not.toContain(REVEALED_KEY);
    await settings().patchSettings({ agentAccess: { revealPerMinute: 100 } } as never, userId);
  });

  it('the kill switch stops reveals too', async () => {
    await settings().patchSettings({ agentAccess: { enabled: false } } as never, userId);
    const res = await rpc(oat, 'tools/call', { name: 'reveal_secret', arguments: { id: keyId, field: 'key' } });
    expect(res.status).toBe(403);
    expect(res.body.error.data).toEqual({ code: 'AGENT_ACCESS_DISABLED' });
    await settings().patchSettings({ agentAccess: { enabled: true } } as never, userId);
  });

  it('SECRET EGRESS: the plaintext is in no audit_events row, response, activity list or log line; the field name is', async () => {
    const rows = await prisma.auditEvent.findMany();
    const audit = JSON.stringify(rows);
    const revealRows = rows.filter((r) => (r.meta as { tool?: string } | null)?.tool === 'reveal_secret');
    expect(revealRows.length).toBeGreaterThan(0);
    expect(revealRows.some((r) => (r.meta as { field?: string }).field === 'key' && (r.meta as { result?: string }).result === 'ok')).toBe(true);
    expect(revealRows.some((r) => (r.meta as { field?: string }).field === 'password')).toBe(true);
    for (const r of revealRows) {
      expect(r.actorUserId).toBeTruthy();
      if ((r.meta as { result?: string }).result === 'ok') expect(r.targetType).toBe('secret');
      expect(Object.keys(r.meta as object)).not.toContain('value');
    }

    // (a 3-digit CVV is checked by exact field below: as a substring it would match ids and timestamps)
    const needles = [REVEALED_KEY, REVEALED_PASSWORD, FOREIGN_KEY, CLOSED_KEY, SEED, CARD_NUMBER];
    // The only place a value may appear is the reveal_secret `value` key of a successful MCP response.
    const responses = bodies.filter((b) => !b.includes('"method":"tools/call"') || !b.includes('"value"')).join('\n');
    const haystacks: Array<[string, string]> = [
      ['audit_events', audit],
      ['non-reveal responses and activity', responses],
      ['logs', lines.join('\n')],
    ];
    for (const [where, text] of haystacks) {
      for (const needle of needles) expect([where, needle, text.includes(needle)]).toEqual([where, needle, false]);
    }
    // Every MCP response carrying a revealed value came from reveal_secret and held exactly one field.
    for (const body of bodies) {
      for (const needle of [REVEALED_KEY, REVEALED_PASSWORD, FOREIGN_KEY]) {
        if (!body.includes(needle)) continue;
        const parsed = JSON.parse(body) as { method: string; body: { result?: { structuredContent?: { field?: string; value?: string } } } };
        expect(parsed.method).toBe('tools/call');
        expect(parsed.body.result?.structuredContent?.value).toBe(needle);
        expect(parsed.body.result?.structuredContent?.field).toBeTruthy();
      }
    }
    expect(lines.join('\n')).not.toContain(CANARY_USERNAME);
    expect(responses).not.toContain(`"cvv":"${CARD_CVV}"`);
  });
});
