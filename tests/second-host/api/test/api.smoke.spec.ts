// =============================================================================
// Host Beta's API smoke suite (issue #194): the Vault packages, in a host that is not Vault
// =============================================================================
//
// A real PostgreSQL 16 database built from Host Beta's own migration history, the host's own
// identity, roles and bindings for every port, and the packages' host conformance kit
// (`runVaultHostConformance` of `@marinoscar/vault-api/testing`) over HTTP, plus what only this
// host can check: the ciphertext is its cipher's, its roles got Vault's grants, its own page and
// table live next to the packages', and its names collide with none of theirs.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthService, PRINCIPAL_USER_INCLUDE } from '@marinoscar/platform-api/identity';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { VAULT_RESERVED_NAMES } from '@marinoscar/vault-api/core';
import { runVaultHostConformance, type VaultHostConformanceOwner, type VaultHostConformanceUser } from '@marinoscar/vault-api/testing';

import { createHostBetaApp, hostBetaOpenApi } from '../src/main';
import { HOST_PERMISSIONS } from '../src/permissions';
import { PrismaService } from '../src/prisma.service';
import { HOST_BETA_METRIC_NAMES, HostBetaMetrics, HostBetaObjectStore } from '../src/vault-bindings';
import { provisionHostDatabase, type HostDatabase } from './host-database';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let database: HostDatabase;
let app: NestFastifyApplication;
let prisma: PrismaService;
let orgId = '';
let owner: VaultHostConformanceOwner;
let other: VaultHostConformanceUser;
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

const inject = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
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
