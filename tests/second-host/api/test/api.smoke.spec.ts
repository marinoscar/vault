// =============================================================================
// Host Beta's API smoke suite (issue #194): the Vault packages, in a host that is not Vault
// =============================================================================
//
// A real PostgreSQL 16 database built from Host Beta's own migration history, the host's own
// identity, roles and bindings for every port, and the packages' host conformance kit
// (`runVaultHostConformance` of `@marinoscar/vault-api/testing`) over HTTP, plus what only this
// host can check: the ciphertext is its cipher's, its roles got Vault's grants, its own page and
// table live next to the packages', and its names collide with none of theirs. The agent rules run
// twice: over HTTP with a personal access token, and in process through `AGENT_RELEASE_PORT` (no
// OAuth hop) for a login, a card under a merchant grant and an identity item, audited as
// `credential: 'embedded'` with the host's client label.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthService, PRINCIPAL_USER_INCLUDE } from '@marinoscar/platform-api/identity';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { AGENT_RELEASE_PORT, type AgentReleasePort } from '@marinoscar/vault-api/agent';
import type { AgentCardFillRequest } from '@marinoscar/vault-contract/agent';
import { VAULT_RESERVED_NAMES } from '@marinoscar/vault-api/core';
import { runVaultHostConformance, type VaultHostConformanceOwner, type VaultHostConformanceUser } from '@marinoscar/vault-api/testing';

import { createHostBetaApp, hostBetaOpenApi } from '../src/main';
import { HOST_PERMISSIONS } from '../src/permissions';
import { PrismaService } from '../src/prisma.service';
import { HOST_BETA_METRIC_NAMES, HostBetaMetrics, HostBetaObjectStore, HostBetaVaultSettings } from '../src/vault-bindings';
import { provisionHostDatabase, type HostDatabase } from './host-database';

/** The label Host Beta's in-process agent calls carry: audited, rate-limited on and shown to the owner. */
const HOST_AGENT_LABEL = 'Host Beta assistant';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let database: HostDatabase;
let app: NestFastifyApplication;
let prisma: PrismaService;
let orgId = '';
let owner: VaultHostConformanceOwner;
let other: VaultHostConformanceUser & { id: string };
let reader: VaultHostConformanceUser;

async function createUser(email: string, roleName: string): Promise<{ id: string; session: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({ data: { email, providerDisplayName: 'Person A', isActive: true } });
  await prisma.membership.create({ data: { userId: user.id, orgId, roleId: role.id, status: 'active' } });
  const graph = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: PRINCIPAL_USER_INCLUDE as never });
  const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId });
  return { id: user.id, session: tokens.accessToken };
}

async function createPat(userId: string): Promise<string> {
  const raw = `pat_${randomBytes(32).toString('hex')}`;
  await prisma.personalAccessToken.create({
    data: {
      userId, name: 'Host Beta agent', tokenHash: sha256(raw), tokenPrefix: raw.slice(0, 8),
      durationValue: 1, durationUnit: 'days', expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  return raw;
}

const inject = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  database = await provisionHostDatabase();
  Object.assign(process.env, database.env);
  app = await createHostBetaApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
  orgId = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;

  const made = await createUser('owner@host.example.test', 'beta_editor');
  owner = { ...made, agentToken: await createPat(made.id) };
  other = await createUser('other@host.example.test', 'beta_editor');
  reader = await createUser('reader@host.example.test', 'beta_reader');
}, 180_000);

afterAll(async () => {
  await app?.close();
  await database?.drop();
});

runVaultHostConformance({
  app: () => app,
  owner: () => owner,
  other: () => other,
  createStorageObject: async (user) => {
    const key = `hostbeta/${user.id}/${randomBytes(6).toString('hex')}.pdf`;
    await app.get(HostBetaObjectStore).upload(key, Buffer.from('%PDF-1.7 Host Beta'));
    const row = await prisma.runInOrg(orgId, (tx) =>
      (tx as PrismaService).storageObject.create({
        data: { name: 'lease.pdf', size: BigInt(18), mimeType: 'application/pdf', storageKey: key, status: 'ready', uploadedById: user.id, orgId },
      }),
    );
    return row.id;
  },
  readAuditActions: async () => (await prisma.auditEvent.findMany({ select: { action: true } })).map((row) => row.action),
  hostNames: () => ({
    routes: ['/beta/notes'],
    permissions: Object.values(HOST_PERMISSIONS).map((p) => p.id),
    jobTypes: app.get(JobHandlerRegistry).types().filter((type) => !type.startsWith(VAULT_RESERVED_NAMES.jobTypePrefix)),
    openApiTags: ['Beta notes'],
    metricNames: HOST_BETA_METRIC_NAMES,
  }),
  openApiDocument: () => hostBetaOpenApi(app) as never,
  inProcessAgent: {
    clientLabel: HOST_AGENT_LABEL,
    readAuditEvents: () => prisma.auditEvent.findMany({ select: { action: true, meta: true } }),
  },
});

describe('Host Beta around the packages', () => {
  it('stores secret values as the HOST cipher’s ciphertext (key id k1), never as plaintext', async () => {
    const versions = await prisma.secretVersion.findMany({ select: { encryptedData: true } });
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version.encryptedData.startsWith('k1.')).toBe(true);
      expect(version.encryptedData).not.toContain('HostConformance');
    }
  });

  it("gives Vault's default grants to the host's roles: a beta_reader reads but cannot write", async () => {
    expect((await inject('GET', '/api/secrets', reader.session)).statusCode).toBe(200);
    const created = await inject('POST', '/api/secrets', reader.session, { name: 'x', typeId: randomBytes(16).toString('hex'), data: {} });
    expect(created.statusCode).toBe(403);
  });

  it('serves its own page on its own table next to the packages', async () => {
    const created = await inject('POST', '/api/beta/notes', owner.session, { title: 'Hello from Host Beta' });
    expect(created.statusCode).toBe(201);
    const list = await inject('GET', '/api/beta/notes', reader.session);
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).toContain('Hello from Host Beta');
  });

  it('emits through the host’s metric names', () => {
    const counts = app.get(HostBetaMetrics).counts;
    expect(counts.get('app.beta.secrets.created')).toBeGreaterThan(0);
    expect([...counts.keys()].every((name) => !name.split('.').includes('vault'))).toBe(true);
  });

  it('registers the packages’ job handlers on the host queue under vault.*', () => {
    const types = app.get(JobHandlerRegistry).types();
    expect(types).toEqual(expect.arrayContaining(['vault.backup.run', 'vault.user_backup.run', 'vault.cards.expiry_scan', 'vault.secrets.origins.backfill']));
  });
});

// -----------------------------------------------------------------------------
// The agent rules in process: what an embedding host calls instead of /api/agent/v1
// -----------------------------------------------------------------------------

/** The status and body of the Nest `HttpException` a port call threw. */
async function refusal(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    const http = error as { getStatus?: () => number; getResponse?: () => unknown };
    if (typeof http.getStatus === 'function' && typeof http.getResponse === 'function') return { status: http.getStatus(), body: http.getResponse() };
    throw error;
  }
  throw new Error('expected a refusal');
}

const codeOf = (refused: { body: unknown }) => (refused.body as { code?: string }).code;

describe('Host Beta calls the agent rules in process (AGENT_RELEASE_PORT)', () => {
  const SHOP = 'https://shop.example.test';
  const FORM = 'https://form.example.test';
  // The well-known test PAN; the code and the id number are canaries, not real values.
  const CANARY_NUMBER = '4242424242424242';
  const CANARY_CODE = 'cvc-canary-2208';
  const CANARY_ID_NUMBER = 'id-canary-B7731';
  const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000b2';
  const port = () => app.get<symbol, AgentReleasePort>(AGENT_RELEASE_PORT, { strict: false });
  const asOwner = () => ({ userId: owner.id, clientLabel: HOST_AGENT_LABEL });
  const purchase = (over: Partial<AgentCardFillRequest> = {}): AgentCardFillRequest => ({
    field: 'number', origin: SHOP, amount: 25, currency: 'USD', purpose: 'purchase', ...over,
  });
  let loginId = '';
  let cardId = '';
  let identityId = '';
  let typeIds: Record<string, string> = {};

  beforeAll(async () => {
    const types = await inject('GET', '/api/secret-types', owner.session);
    typeIds = Object.fromEntries((types.json().data as Array<{ id: string; name: string }>).map((t) => [t.name, t.id]));
    loginId = (await prisma.secret.findFirstOrThrow({ where: { name: 'Shop login', createdById: owner.id }, select: { id: true } })).id;
  });

  it("keeps another user's login from an in-process call naming that user", async () => {
    const asOther = { userId: other.id, clientLabel: HOST_AGENT_LABEL };
    expect(await port().lookup({ ...asOther, origin: SHOP })).toEqual([]);
    const foreign = await refusal(port().fill({ ...asOther, secretId: loginId, field: 'password', origin: SHOP, purpose: 'login' }));
    const unknown = await refusal(port().fill({ ...asOther, secretId: UNKNOWN_ID, field: 'password', origin: SHOP, purpose: 'login' }));
    expect(foreign.status).toBe(404);
    expect(foreign).toEqual(unknown);
  });

  it('applies the deployment kill switches in process: cards and identity stay off until the host turns them on', async () => {
    const cards = await refusal(port().cardsLookup({ ...asOwner(), origin: SHOP }));
    expect([cards.status, codeOf(cards)]).toEqual([403, 'CARD_ACCESS_DISABLED']);
    const identity = await refusal(port().identityLookup({ ...asOwner(), origin: FORM }));
    expect([identity.status, codeOf(identity)]).toEqual([403, 'IDENTITY_ACCESS_DISABLED']);
    app.get(HostBetaVaultSettings).patchNamespace('agentAccess', { cards: { enabled: true }, identity: { enabled: true } });
  });

  it('seeds a card and an identity item and opens them with the owner session', async () => {
    const card = await inject('POST', '/api/secrets', owner.session, {
      name: 'Card A',
      typeId: typeIds.Card,
      data: { cardholder_name: 'Person A', number: CANARY_NUMBER, exp_month: '04', exp_year: '2031', cvv: CANARY_CODE, card_network: 'Visa' },
    });
    expect(card.statusCode).toBe(201);
    cardId = card.json().data.id;
    const identity = await inject('POST', '/api/secrets', owner.session, {
      name: 'Identity A',
      typeId: typeIds.Identity,
      data: { full_name: 'Person A', id_number: CANARY_ID_NUMBER, city: 'Town B' },
    });
    expect(identity.statusCode).toBe(201);
    identityId = identity.json().data.id;
    expect((await inject('PATCH', `/api/secrets/${cardId}/agent-access`, owner.session, { agentAccess: 'fill' })).statusCode).toBe(200);
    const opened = await inject('PATCH', `/api/secrets/${identityId}/agent-access`, owner.session, { agentAccess: 'fill', allowedOrigins: [FORM] });
    expect(opened.statusCode).toBe(200);
  });

  it('refuses an opened card with no merchant grant exactly as an unknown card', async () => {
    expect(await port().cardsLookup({ ...asOwner(), origin: SHOP })).toEqual([]);
    const ungranted = await refusal(port().cardFill({ ...asOwner(), cardId, ...purchase() }));
    const unknown = await refusal(port().cardFill({ ...asOwner(), cardId: UNKNOWN_ID, ...purchase() }));
    expect(ungranted.status).toBe(404);
    expect(ungranted).toEqual(unknown);
  });

  it('releases ONE card field in process within the grant the owner created, for its merchant only', async () => {
    const grant = await inject('POST', `/api/secrets/${cardId}/card-grants`, owner.session, { merchantOrigin: SHOP, maxAmount: 100, currency: 'USD' });
    expect(grant.statusCode).toBe(201);

    const listed = await port().cardsLookup({ ...asOwner(), origin: SHOP });
    expect(listed.map((c) => [c.id, c.last4])).toEqual([[cardId, '4242']]);
    expect(JSON.stringify(listed)).not.toContain(CANARY_NUMBER);

    expect(await port().cardFill({ ...asOwner(), cardId, ...purchase() })).toEqual({ value: CANARY_NUMBER });

    const elsewhere = await refusal(port().cardFill({ ...asOwner(), cardId, ...purchase({ origin: 'https://shop-example.test' }) }));
    expect([elsewhere.status, codeOf(elsewhere)]).toEqual([403, 'ORIGIN_MISMATCH']);
    const above = await refusal(port().cardFill({ ...asOwner(), cardId, ...purchase({ amount: 100.01 }) }));
    expect([above.status, codeOf(above)]).toEqual([403, 'CARD_AMOUNT_EXCEEDED']);
    const code = await refusal(port().cardFill({ ...asOwner(), cardId, ...purchase({ field: 'securityCode' }) }));
    expect([code.status, codeOf(code)]).toEqual([403, 'SECURITY_CODE_NOT_GRANTED']);
    for (const refused of [elsewhere, above, code]) expect(JSON.stringify(refused.body)).not.toContain(CANARY_NUMBER);
  });

  it('releases ONE identity field in process; a sensitive one only on an allowed origin', async () => {
    const found = await port().identityLookup({ ...asOwner(), origin: FORM });
    expect(found.map((i) => [i.id, i.originAllowed])).toEqual([[identityId, true]]);
    expect(JSON.stringify(found)).not.toContain(CANARY_ID_NUMBER);
    expect(await port().identityFill({ ...asOwner(), identityId, field: 'full_name', origin: FORM, purpose: 'form' })).toEqual({ value: 'Person A' });
    expect(await port().identityFill({ ...asOwner(), identityId, field: 'id_number', origin: FORM, purpose: 'form' })).toEqual({ value: CANARY_ID_NUMBER });
    const mismatch = await refusal(port().identityFill({ ...asOwner(), identityId, field: 'id_number', origin: SHOP, purpose: 'form' }));
    expect([mismatch.status, codeOf(mismatch)]).toEqual([403, 'ORIGIN_MISMATCH']);
  });

  it("audits every in-process call as credential 'embedded' with the host's label, and no released value", async () => {
    const rows = await prisma.auditEvent.findMany({ where: { action: { startsWith: 'agent.' } }, select: { action: true, meta: true } });
    const metaOf = (row: { meta: unknown }) => (row.meta ?? {}) as { credential?: string; clientLabel?: string; result?: string };
    const embedded = rows.filter((row) => metaOf(row).credential === 'embedded');
    for (const action of ['agent.credential.lookup', 'agent.credential.fill', 'agent.card.lookup', 'agent.card.fill', 'agent.identity.lookup', 'agent.identity.fill']) {
      const ok = embedded.filter((row) => row.action === action && metaOf(row).result === 'ok');
      expect({ action, audited: ok.length > 0 }).toEqual({ action, audited: true });
      for (const row of ok) expect(metaOf(row).clientLabel).toBe(HOST_AGENT_LABEL);
    }
    expect(embedded.some((row) => row.action === 'agent.card.fill' && metaOf(row).result !== 'ok')).toBe(true);
    const blob = JSON.stringify(rows);
    for (const canary of [CANARY_NUMBER, CANARY_CODE, CANARY_ID_NUMBER, 'HostConformance-Pw']) expect(blob).not.toContain(canary);
  });
});
