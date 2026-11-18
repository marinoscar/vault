// =============================================================================
// Real-Postgres test: secret origins (E14.4, epic #172)
// =============================================================================
// Proves, against a migrated deployment (ordinary application role): `secrets.origins` is set on
// create, update (and cleared when the URLs are removed), rollback and renew; the backfill job
// fills rows written before the column existed and a re-run changes nothing; the column holds only
// origins (no path, no username or password); findCredentialsByOrigin matches exact and site.
// Skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { OriginsBackfillHandler, SecretsService } from '@marinoscar/vault-api/secrets';
import { CryptoService } from '../../src/common/services/crypto.service';
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

describeWithDb('secret origins (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};
  let token = '';
  let userId = '';
  let credTypeId = '';

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const origins = async (id: string) =>
    (await prisma.secret.findUniqueOrThrow({ where: { id }, select: { origins: true } })).origins;
  const create = async (name: string, data: Record<string, string>) => {
    const res = await http().post('/api/secrets').set(auth()).send({ name, typeId: credTypeId, data });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

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
    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env);
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({
      data: { email: 'origins@example.test', providerDisplayName: 'Person A' },
    });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, roleId: role.id, status: 'active' } });
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: user.id,
        name: 'origins token',
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(0, 8),
        durationValue: 30,
        durationUnit: 'days',
        expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
    token = raw;
    userId = user.id;

    const field = (name: string, required: boolean, sensitive = false) => ({
      name,
      label: name,
      type: 'string',
      required,
      sensitive,
    });
    const type = await prisma.secretType.create({
      data: {
        name: 'Credential',
        isSystem: true,
        createdById: userId,
        fields: [field('username', true), field('password', true, true), field('url', false), field('additional_urls', false)],
      },
    });
    credTypeId = type.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('sets origins on create, normalized and without paths or secrets', async () => {
    const id = await create('Shop', {
      username: 'person-a',
      password: 'Sup3r-secret-pw',
      url: 'HTTPS://Shop.Example.test/login?next=/a',
      additional_urls: 'app.example.test\nhttp://nope.example.test',
    });
    expect(await origins(id)).toEqual(['https://app.example.test', 'https://shop.example.test']);
    const joined = (await origins(id)).join(' ');
    expect(joined).not.toMatch(/person-a|Sup3r|login|next/);
  });

  it('recomputes on update, clears when the URLs go, and restores on rollback', async () => {
    const id = await create('Mail', { username: 'u', password: 'p1', url: 'https://mail.example.test' });
    expect(await origins(id)).toEqual(['https://mail.example.test']);

    let res = await http()
      .put(`/api/secrets/${id}`)
      .set(auth())
      .send({ data: { username: 'u', password: 'p2', url: 'https://other.example.test' } });
    expect(res.status).toBe(200);
    expect(await origins(id)).toEqual(['https://other.example.test']);

    res = await http().put(`/api/secrets/${id}`).set(auth()).send({ data: { username: 'u', password: 'p3' } });
    expect(res.status).toBe(200);
    expect(await origins(id)).toEqual([]);

    const v1 = await prisma.secretVersion.findFirstOrThrow({ where: { secretId: id, version: 1 } });
    res = await http().post(`/api/secrets/${id}/versions/${v1.id}/rollback`).set(auth()).send({});
    expect(res.status).toBeLessThan(300);
    expect(await origins(id)).toEqual(['https://mail.example.test']);

    res = await http()
      .post(`/api/secrets/${id}/renew`)
      .set(auth())
      .send({ data: { username: 'u', password: 'p4', url: 'https://renewed.example.test' } });
    expect(res.status).toBeLessThan(300);
    expect(await origins(id)).toEqual(['https://renewed.example.test']);
  });

  it('keeps origins empty for other secret types', async () => {
    const note = await prisma.secretType.create({
      data: { name: 'Note', isSystem: true, createdById: userId, fields: [{ name: 'url', label: 'url', type: 'string', required: false, sensitive: false }] },
    });
    const res = await http()
      .post('/api/secrets')
      .set(auth())
      .send({ name: 'A note', typeId: note.id, data: { url: 'https://note.example.test' } });
    expect(res.status).toBe(201);
    expect(await origins(res.body.data.id)).toEqual([]);
  });

  it('backfills rows written without origins and a re-run changes nothing', async () => {
    const id = await create('Legacy', { username: 'u', password: 'p', url: 'https://legacy.example.test/x' });
    await prisma.secret.update({ where: { id }, data: { origins: [] } });
    expect(await origins(id)).toEqual([]);

    const handler = app.get(OriginsBackfillHandler);
    const first = await handler.run();
    expect(first.updated).toBeGreaterThanOrEqual(1);
    expect(await origins(id)).toEqual(['https://legacy.example.test']);

    const second = await handler.run();
    expect(second).toMatchObject({ updated: 0, unreadable: 0 });
    // The ciphertext is untouched and nothing but origins was added.
    const crypto = app.get(CryptoService);
    const v = await prisma.secretVersion.findFirstOrThrow({ where: { secretId: id, isCurrent: true } });
    expect(JSON.parse(crypto.decrypt(v.encryptedData, v.iv, v.authTag)).password).toBe('p');
  });

  it('finds agent-accessible credentials by exact and site origin', async () => {
    const id = await create('Agent login', { username: 'u', password: 'p', url: 'https://login.agent.example.test' });
    await prisma.secret.update({ where: { id }, data: { agentAccess: 'fill' } });
    const svc = app.get(SecretsService);

    let found = await svc.findCredentialsByOrigin(userId, 'https://login.agent.example.test/path');
    expect(found.map((f) => [f.id, f.matchKind])).toEqual([[id, 'exact']]);

    found = await svc.findCredentialsByOrigin(userId, 'https://www.agent.example.test');
    expect(found.map((f) => [f.id, f.matchKind])).toEqual([[id, 'site']]);

    expect(await svc.findCredentialsByOrigin(userId, 'https://elsewhere.example.org')).toEqual([]);
    // Not opted in: invisible.
    await create('Hidden', { username: 'u', password: 'p', url: 'https://hidden.example.org' });
    expect(await svc.findCredentialsByOrigin(userId, 'https://hidden.example.org')).toEqual([]);
  });
});
