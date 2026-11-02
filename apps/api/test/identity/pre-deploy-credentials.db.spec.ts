// =============================================================================
// Real-Postgres test: credentials written BEFORE the identity slice still work
// (issue #77, E3.2)
// =============================================================================
//
// Vault's own auth stack was replaced by the platform's. Sessions, personal
// access tokens and device codes that are already in production were written by
// the OLD code: no `org_id`, no `device_code_id`, hashed with sha256 over the raw
// token. This builds a migrated, seeded deployment (role, migrate, seed, as
// production does), inserts those rows exactly the old way, and authenticates
// them through the full app:
//
//   - a `pat_` token (no org_id)                      -> GET /api/auth/me
//   - a refresh token (no org_id, no device link)     -> POST /api/auth/refresh, then the new access token
//   - an approved device code written the old way -> POST /api/auth/device/token
//   - INITIAL_ADMIN_EMAIL bypasses the allowlist and becomes admin; any other
//     address that is not on the allowlist is refused; an allowlisted one is a viewer
//
// Like every `*.db.spec.ts` it runs through `npm run test:db` and skips when no
// Postgres superuser is reachable.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { AuthService } from '@marinoscar/platform-api/identity';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const INITIAL_ADMIN = 'first-admin@example.test';

describeWithDb('credentials written by the pre-identity code (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};

  const http = () => request(app.getHttpServer());

  async function createUser(email: string, orgRole: 'viewer' | 'contributor'): Promise<string> {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: orgRole } });
    const user = await prisma.user.create({ data: { email, providerDisplayName: 'Person A' } });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, roleId: role.id, status: 'active' } });
    return user.id;
  }

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();

    const input = platformSeedInputFrom(
      {
        permissions: platformPermissionCatalog(PERMISSION_OPTIONS),
        settings: { ui: { allowUserThemeOverride: true }, features: {} },
      },
      { INITIAL_ADMIN_EMAIL: INITIAL_ADMIN },
    );
    await seedPlatform(prisma as unknown as SeedPrisma, input);

    // The app reads POSTGRES_* when PrismaService is constructed.
    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'INITIAL_ADMIN_EMAIL']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env, { INITIAL_ADMIN_EMAIL: INITIAL_ADMIN });
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('authenticates a personal access token inserted the old way (no org_id)', async () => {
    const userId = await createUser('pat-user@example.test', 'contributor');
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId,
        name: 'old cli token',
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(0, 8),
        durationValue: 30,
        durationUnit: 'days',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${raw}`);

    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('pat-user@example.test');
    // A contributor holds the Vault permissions through the membership role.
    expect(me.body.data.permissions).toEqual(expect.arrayContaining(['secrets:read', 'secrets:write', 'media:write']));
    expect(me.body.data.permissions).not.toContain('secrets:read_any');

    expect((await http().get('/api/secrets').set('Authorization', `Bearer ${raw}`)).status).not.toBe(401);
    // A revoked one is refused.
    await prisma.personalAccessToken.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
    expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${raw}`)).status).toBe(401);
  });

  it('refreshes a session from a refresh token inserted the old way, and rotates it', async () => {
    const userId = await createUser('session-user@example.test', 'viewer');
    const raw = randomBytes(32).toString('hex');
    await prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) },
    });

    const refreshed = await http().post('/api/auth/refresh').set('Cookie', `refresh_token=${raw}`);

    expect(refreshed.status).toBe(200);
    const accessToken = refreshed.body.data.accessToken as string;
    expect(accessToken).toEqual(expect.any(String));
    const setCookie = ([] as string[]).concat(refreshed.headers['set-cookie'] ?? []).join(';');
    expect(setCookie).toContain('refresh_token=');
    expect(setCookie).toContain('Path=/api/auth');

    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain('secrets:read');
    expect(me.body.data.permissions).not.toContain('secrets:write');

    // The old token was rotated: presenting it again is reuse and is refused.
    const reused = await http().post('/api/auth/refresh').set('Cookie', `refresh_token=${raw}`);
    expect(reused.status).toBe(401);
  });

  it('completes an approved device code written the old way', async () => {
    const userId = await createUser('device-user@example.test', 'contributor');
    const deviceCode = randomBytes(32).toString('hex');
    await prisma.deviceCode.create({
      data: {
        deviceCode: sha256(deviceCode),
        userCode: 'ABCD-EFGH',
        userId,
        status: 'approved',
        clientInfo: {},
        scopes: [],
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const token = await http().post('/api/auth/device/token').send({ deviceCode });

    expect(token.status).toBe(200);
    expect(token.body.data).toEqual(
      expect.objectContaining({ accessToken: expect.any(String), refreshToken: expect.any(String), tokenType: 'Bearer' }),
    );
    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${token.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('device-user@example.test');
  });

  describe('sign-in policy', () => {
    const profile = (email: string, id: string) => ({ id, email, displayName: 'Person A', picture: undefined });

    it('lets INITIAL_ADMIN_EMAIL in without an allowlist entry, as admin of the default organization', async () => {
      const auth = app.get(AuthService, { strict: false });

      const result = await auth.handleGoogleLogin(profile(INITIAL_ADMIN, 'google-initial-admin') as never);
      expect(result).toBeTruthy();

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: INITIAL_ADMIN },
        include: { userRoles: { include: { role: true } }, memberships: { include: { role: true, org: true } } },
      });
      expect(user.userRoles.map((ur) => ur.role.name)).toContain('admin');
      expect(user.memberships.map((m) => [m.org.isDefault, m.role.name])).toContainEqual([true, 'org_admin']);
    });

    it('refuses an address that is not on the allowlist', async () => {
      const auth = app.get(AuthService, { strict: false });

      await expect(auth.handleGoogleLogin(profile('stranger@example.test', 'google-stranger') as never)).rejects.toThrow();
      expect(await prisma.user.findUnique({ where: { email: 'stranger@example.test' } })).toBeNull();
    });

    it('admits an allowlisted address as a viewer', async () => {
      await prisma.allowedEmail.create({ data: { email: 'invited@example.test' } });
      const auth = app.get(AuthService, { strict: false });

      await auth.handleGoogleLogin(profile('invited@example.test', 'google-invited') as never);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'invited@example.test' },
        include: { userRoles: true, memberships: { include: { role: true } } },
      });
      expect(user.userRoles).toEqual([]);
      expect(user.memberships.map((m) => m.role.name)).toEqual(['viewer']);
    });
  });

  it('boots with the seed: viewers cannot write secrets, contributors can (real grants)', async () => {
    const viewerId = await createUser('viewer2@example.test', 'viewer');
    const auth = app.get(AuthService, { strict: false });
    const full = await auth.generateFullTokens(
      (await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } } })) as never,
    );
    const write = await http().post('/api/secrets').set('Authorization', `Bearer ${full.accessToken}`).send({});
    const read = await http().get('/api/secrets').set('Authorization', `Bearer ${full.accessToken}`);

    expect(write.status).toBe(403);
    expect(read.status).toBe(200);
  });
});
