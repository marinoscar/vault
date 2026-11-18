// =============================================================================
// Real-Postgres test: TOTP on Credential secrets (E14.5, epic #172)
// =============================================================================
// Proves, against a migrated deployment (ordinary application role): a Credential saved with an
// otpauth URI or bare base32 seed stores the canonical URI (as ciphertext); POST /api/secrets/:id/totp
// returns a 6-digit code without the seed and with no-store; an invalid seed is a 400; the audit row
// carries the secret id and never the code or the seed. Skipped without a reachable Postgres superuser.
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

describeWithDb('secret TOTP (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};
  let token = '';
  let userId = '';
  let credTypeId = '';

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const stored = async (id: string) => {
    const v = await prisma.secretVersion.findFirstOrThrow({ where: { secretId: id, isCurrent: true } });
    return JSON.parse(app.get(CryptoService).decrypt(v.encryptedData, v.iv, v.authTag)) as Record<string, string>;
  };
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
      data: { email: 'totp@example.test', providerDisplayName: 'Person A' },
    });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, roleId: role.id, status: 'active' } });
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: user.id,
        name: 'totp token',
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
        fields: [field('username', true), field('password', true, true), field('url', false), field('additional_urls', false), field('totp', false, true)],
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

  // A widely published example seed, not a real account secret.
  const SEED = 'JBSWY3DPEHPK3PXP';
  const CANONICAL = `otpauth://totp/?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;

  it('stores the canonical URI and returns a code without the seed', async () => {
    const id = await create('Shop', { username: 'person-a', password: 'pw-1', totp: 'jbsw y3dp ehpk 3pxp' });
    expect((await stored(id)).totp).toBe(CANONICAL);

    const detail = await http().get(`/api/secrets/${id}`).set(auth());
    expect(detail.status).toBe(200);
    expect(detail.body.data.values.totp).toBe(CANONICAL);

    const res = await http().post(`/api/secrets/${id}/totp`).set(auth());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body.data).sort()).toEqual(['code', 'expiresAt', 'period']);
    expect(res.body.data.code).toMatch(/^\d{6}$/);
    expect(res.body.data.period).toBe(30);
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toContain(SEED);

    const rows = await prisma.auditEvent.findMany({ where: { action: 'secret.totp.read', targetId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(userId);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(SEED);
    expect(serialized).not.toContain(res.body.data.code);
  });

  it('rejects an invalid seed with a 400 and stores nothing', async () => {
    const res = await http()
      .post('/api/secrets')
      .set(auth())
      .send({ name: 'Bad', typeId: credTypeId, data: { username: 'u', password: 'p', totp: 'otpauth://hotp/a?secret=' + SEED } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('totp');
    expect(await prisma.secret.count({ where: { name: 'Bad' } })).toBe(0);
  });

  it('answers 404 for a Credential without a totp value and for a non-Credential', async () => {
    const plain = await create('Plain', { username: 'u', password: 'p' });
    expect((await http().post(`/api/secrets/${plain}/totp`).set(auth())).status).toBe(404);

    const other = await prisma.secretType.create({
      data: { name: 'Note', isSystem: true, createdById: userId, fields: [{ name: 'body', label: 'b', type: 'string', required: false, sensitive: false }] },
    });
    const note = await http().post('/api/secrets').set(auth()).send({ name: 'A note', typeId: other.id, data: { body: 'x' } });
    expect(note.status).toBe(201);
    expect((await http().post(`/api/secrets/${note.body.data.id}/totp`).set(auth())).status).toBe(404);
  });

  it('updating the seed normalizes it and creates a new version', async () => {
    const id = await create('Rotating', { username: 'u', password: 'p', totp: SEED });
    const res = await http()
      .put(`/api/secrets/${id}`)
      .set(auth())
      .send({ data: { username: 'u', password: 'p', totp: `otpauth://totp/Org%20Alpha:a?secret=${SEED}&digits=8` } });
    expect(res.status).toBe(200);
    expect((await stored(id)).totp).toBe(
      `otpauth://totp/Org%20Alpha%3Aa?secret=${SEED}&issuer=Org%20Alpha&algorithm=SHA1&digits=8&period=30`,
    );
    const code = await http().post(`/api/secrets/${id}/totp`).set(auth());
    expect(code.body.data.code).toMatch(/^\d{8}$/);
  });
});
