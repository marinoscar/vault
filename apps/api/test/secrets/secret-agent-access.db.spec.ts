// =============================================================================
// Real-Postgres test: per-secret agent access (E14.3, epic #172)
// =============================================================================
// Boots the full app against a migrated deployment (ordinary application role)
// and proves, over HTTP with a PAT: new secrets read `none`; the toggle persists,
// stamps agent_access_changed_at and writes an audit row without values; a
// non-Credential type is a 422; the list filter selects by agentAccess; another
// user's secret is refused. Skipped without a reachable Postgres superuser.
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

describeWithDb('secret agent access (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { a: '', b: '' };
  const ids = { a: '', b: '' };
  const secrets: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const patch = (who: keyof typeof tokens, id: string, agentAccess: string) =>
    http().patch(`/api/secrets/${id}/agent-access`).set(as(who)).send({ agentAccess });

  async function createUser(who: keyof typeof tokens) {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({
      data: { email: `${who}-agent@example.test`, providerDisplayName: `Person ${who.toUpperCase()}` },
    });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, roleId: role.id, status: 'active' } });
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: user.id,
        name: `${who} token`,
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(0, 8),
        durationValue: 30,
        durationUnit: 'days',
        expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
    tokens[who] = raw;
    ids[who] = user.id;
  }

  async function addSecret(key: string, ownerId: string, typeName: string, isSystem: boolean) {
    const type = await prisma.secretType.create({
      data: { name: typeName, isSystem, fields: [{ name: 'user', label: 'User', type: 'string' }], createdById: ownerId },
    });
    const secret = await prisma.secret.create({ data: { name: key, typeId: type.id, createdById: ownerId } });
    secrets[key] = secret.id;
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

    await createUser('a');
    await createUser('b');
    await addSecret('Shop Login', ids.a, 'Credential', true);
    await addSecret('Bank Key', ids.a, 'API Key', true);
    await addSecret('Other Login', ids.b, 'Credential', true);
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

  it('reads none by default on list items', async () => {
    const res = await http().get('/api/secrets').set(as('a'));
    expect(res.status).toBe(200);
    for (const item of res.body.data.items) {
      expect(item).toMatchObject({ agentAccess: 'none', agentAccessChangedAt: null });
    }
  });

  it('toggles a Credential to fill, stamps the change time, audits it and filters the list', async () => {
    const res = await patch('a', secrets['Shop Login'], 'fill');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: secrets['Shop Login'], agentAccess: 'fill' });
    expect(typeof res.body.data.agentAccessChangedAt).toBe('string');

    const row = await prisma.secret.findUniqueOrThrow({ where: { id: secrets['Shop Login'] } });
    expect(row.agentAccess).toBe('fill');
    expect(row.agentAccessChangedAt).toBeInstanceOf(Date);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'secrets.agent_access.update', targetId: secrets['Shop Login'] },
    });
    expect(audit.meta).toEqual({ secretId: secrets['Shop Login'], from: 'none', to: 'fill' });

    const fill = await http().get('/api/secrets?agentAccess=fill').set(as('a'));
    expect(fill.body.data.items.map((i: { id: string }) => i.id)).toEqual([secrets['Shop Login']]);
    const none = await http().get('/api/secrets?agentAccess=none').set(as('a'));
    expect(none.body.data.items.map((i: { id: string }) => i.id)).toEqual([secrets['Bank Key']]);

    const back = await patch('a', secrets['Shop Login'], 'none');
    expect(back.body.data.agentAccess).toBe('none');
  });

  it('answers 422 AGENT_ACCESS_UNSUPPORTED_TYPE for a non-Credential type and leaves it none', async () => {
    const res = await patch('a', secrets['Bank Key'], 'fill');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AGENT_ACCESS_UNSUPPORTED_TYPE');
    const row = await prisma.secret.findUniqueOrThrow({ where: { id: secrets['Bank Key'] } });
    expect(row.agentAccess).toBe('none');
  });

  it("refuses another user's secret and an invalid value", async () => {
    expect((await patch('a', secrets['Other Login'], 'fill')).status).toBe(403);
    expect((await patch('a', secrets['Shop Login'], 'read')).status).toBe(400);
  });
});
