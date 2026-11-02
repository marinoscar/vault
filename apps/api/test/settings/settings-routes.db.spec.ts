// =============================================================================
// Real-Postgres test: the platform settings routes, bound by Vault (issue #79, E4.1)
// =============================================================================
//
// Builds a migrated, seeded deployment (the ordinary application role, as in
// production), plants the `global` row and a user settings row EXACTLY as the
// pre-E4.1 code wrote them, boots the full app, and drives
// `/api/system-settings`, `/api/user-settings` and `/api/org-settings` with real
// credentials:
//
//   * existing values survive (ui, features, the `ai` block in the platform AI
//     slice's shape since E8.1, maintenance, an unknown key) and are served in
//     the same wire shape;
//   * the AI key is no longer a system-settings field (E8.1): a PATCH naming
//     `ai.apiKey` stores nothing anywhere; keys go through /api/admin/ai/*;
//   * RBAC: admin writes system settings, a contributor reads and writes only its
//     own user settings, nobody anonymous reads anything;
//   * a user's pre-E4.1 profile reads in the platform layout; dataTables and
//     navigation are stored server-side;
//   * the Vault namespaces (vaultCards, vaultBackups) are served, validated and
//     consumed (the backup schedule defaults).
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable
// Postgres superuser.
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
import { formatSettingsMigrationReport, migrateSettings } from '../../src/settings/settings-migration';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describeWithDb('platform settings routes bound by Vault (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens: Record<'admin' | 'contributor' | 'viewer', string> = { admin: '', contributor: '', viewer: '' };
  const ids: Record<'admin' | 'contributor' | 'viewer', string> = { admin: '', contributor: '', viewer: '' };

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const globalRow = () => prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });

  async function createUser(
    who: keyof typeof tokens,
    orgRole: 'org_admin' | 'contributor' | 'viewer',
    systemAdmin = false,
  ): Promise<void> {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: orgRole } });
    const user = await prisma.user.create({ data: { email: `${who}@example.test`, providerDisplayName: 'Person A' } });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, roleId: role.id, status: 'active' } });
    if (systemAdmin) {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    }
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: user.id,
        name: `${who} token`,
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(0, 8),
        durationValue: 30,
        durationUnit: 'days',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
    tokens[who] = raw;
    ids[who] = user.id;
  }

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();

    const input = platformSeedInputFrom(
      { permissions: platformPermissionCatalog(PERMISSION_OPTIONS), settings: DEFAULT_SYSTEM_SETTINGS },
      { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' },
    );
    await seedPlatform(prisma as unknown as SeedPrisma, input);

    // The `global` row as the pre-E4.1 deployment wrote it: Vault's three blocks,
    // the platform's `maintenance`, a key no one models, and the pre-E4.2 ciphertext.
    await prisma.systemSettings.update({
      where: { key: 'global' },
      data: {
        value: {
          ui: { allowUserThemeOverride: false },
          features: { cardScanning: true },
          ai: { enabled: true, keyPolicy: 'byok_with_org_fallback', providers: { openai: { enabled: true } }, cardExtractModel: 'gpt-4o' },
          maintenance: { enabled: false, message: 'Back soon' },
          futureThing: { keep: 'me' },
        },
      },
    });

    await createUser('admin', 'org_admin', true);
    await createUser('contributor', 'contributor');
    await createUser('viewer', 'viewer');

    // A user's settings as the pre-E4.1 code wrote them.
    await prisma.userSettings.create({
      data: {
        userId: ids.contributor,
        value: {
          theme: 'dark',
          profile: { displayName: 'Person A', useProviderImage: false, customImageUrl: 'https://img.example.test/me.png' },
        },
      },
    });

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

  describe('GET /api/system-settings', () => {
    it('serves the existing values in the legacy wire shape, plus the new namespaces', async () => {
      const res = await http().get('/api/system-settings').set(as('admin'));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        ui: { allowUserThemeOverride: false },
        features: { cardScanning: true },
        ai: {
          enabled: true,
          keyPolicy: 'byok_with_org_fallback',
          providers: { openai: { enabled: true } },
          cardExtractModel: 'gpt-4o',
        },
        maintenance: { enabled: false, message: 'Back soon' },
        vaultCards: { imageMaxBytes: 5 * 1024 * 1024, expiryWarningDays: 30 },
        vaultBackups: {
          keepCount: 7,
          includeAttachments: true,
          includeVersions: false,
          includeSecrets: true,
          includeMedia: false,
          includeSystem: false,
        },
        version: expect.any(Number),
      });
    });

    it('never returns a key field', async () => {
      const res = await http().get('/api/system-settings').set(as('admin'));
      expect(res.body.data.ai).not.toHaveProperty('apiKey');
      expect(res.body.data.ai).not.toHaveProperty('apiKeyConfigured');
      // An unknown top-level key is carried, not served.
      expect(res.body.data).not.toHaveProperty('futureThing');
    });

    it('is admin-only', async () => {
      expect((await http().get('/api/system-settings')).status).toBe(401);
      expect((await http().get('/api/system-settings').set(as('contributor'))).status).toBe(403);
      expect((await http().get('/api/system-settings').set(as('viewer'))).status).toBe(403);
    });
  });

  describe('PATCH /api/system-settings', () => {
    it('merges feature flags and keeps every key it does not own', async () => {
      const res = await http().patch('/api/system-settings').set(as('admin')).send({ features: { newFlag: true } });

      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ cardScanning: true, newFlag: true });
      const stored = (await globalRow()).value as Record<string, any>;
      expect(stored.futureThing).toEqual({ keep: 'me' });
      expect(stored.maintenance).toMatchObject({ message: 'Back soon' });
      expect(stored.ui).toEqual({ allowUserThemeOverride: false });
      expect(stored.ai).toMatchObject({ cardExtractModel: 'gpt-4o', providers: { openai: { enabled: true } } });
    });

    it('rejects a contributor', async () => {
      const res = await http().patch('/api/system-settings').set(as('contributor')).send({ features: { x: true } });
      expect(res.status).toBe(403);
    });

    it('validates input (400) and a stale If-Match is a 409', async () => {
      expect(
        (await http().patch('/api/system-settings').set(as('admin')).send({ ai: { cardExtractModel: '' } })).status,
      ).toBe(400);
      expect(
        (await http().patch('/api/system-settings').set(as('admin')).send({ vaultCards: { imageMaxBytes: 0 } })).status,
      ).toBe(400);
      expect(
        (
          await http()
            .patch('/api/system-settings')
            .set(as('admin'))
            .set('If-Match', '9999')
            .send({ ui: { allowUserThemeOverride: true } })
        ).status,
      ).toBe(409);
    });

    it('updates the Vault namespaces', async () => {
      const res = await http()
        .patch('/api/system-settings')
        .set(as('admin'))
        .send({ vaultCards: { imageMaxBytes: 1024, expiryWarningDays: 60 }, vaultBackups: { keepCount: 14, includeMedia: true } });

      expect(res.status).toBe(200);
      expect(res.body.data.vaultCards).toEqual({ imageMaxBytes: 1024, expiryWarningDays: 60 });
      expect(res.body.data.vaultBackups).toMatchObject({ keepCount: 14, includeMedia: true, includeSecrets: true });
    });

    it('the admin backup schedule starts from the vaultBackups defaults until a schedule is saved', async () => {
      const res = await http().get('/api/admin/backups/schedule').set(as('admin'));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ keepCount: 14, includeMedia: true, includeSecrets: true });
    });
  });

  describe('the AI block (E8.1)', () => {
    it('patches cardExtractModel and the platform fields, and keeps the rest of the block', async () => {
      const res = await http()
        .patch('/api/system-settings')
        .set(as('admin'))
        .send({ ai: { cardExtractModel: 'gpt-4o-mini', limits: { perUser: { requestsPerDay: 25 } } } });

      expect(res.status).toBe(200);
      expect(res.body.data.ai).toMatchObject({
        enabled: true,
        keyPolicy: 'byok_with_org_fallback',
        cardExtractModel: 'gpt-4o-mini',
        limits: { perUser: { requestsPerDay: 25 } },
      });
    });

    it('a PUT without ai keeps the stored ai block (the namespace is not required on PUT)', async () => {
      // PUT replaces the document: namespaces declared `requiredOnPut` (the platform's
      // `notifications`, E7.1) must be sent back, as a client that GETs then PUTs does.
      const current = await http().get('/api/system-settings').set(as('admin'));
      const res = await http()
        .put('/api/system-settings')
        .set(as('admin'))
        .send({ notifications: current.body.data.notifications, ui: { allowUserThemeOverride: true }, features: { onlyFlag: true } });

      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ onlyFlag: true });
      expect(res.body.data.ai).toMatchObject({ enabled: true, cardExtractModel: 'gpt-4o-mini' });
      expect((await globalRow()).value).toMatchObject({ futureThing: { keep: 'me' } });
    });

    it('a key sent through system settings is stored nowhere: not in the row, a credential or an audit row', async () => {
      const smuggled = 'sk-smuggled-' + 'z'.repeat(30);
      await http().patch('/api/system-settings').set(as('admin')).send({ ai: { apiKey: smuggled } });

      expect(JSON.stringify((await globalRow()).value)).not.toContain(smuggled);
      expect(JSON.stringify(await prisma.auditEvent.findMany())).not.toContain(smuggled);
      expect(JSON.stringify(await prisma.credential.findMany())).not.toContain(smuggled);
      expect(await prisma.credential.count({ where: { purpose: 'ai', name: 'openai' } })).toBe(0);
    });
  });

  describe('an ai block still in the pre-E8 shape (before vault:migrate-ai-platform)', () => {
    it('is served with the platform defaults, not an error, so the window between deploy and migration is safe', async () => {
      const before = (await globalRow()).value as Record<string, any>;
      await prisma.systemSettings.update({
        where: { key: 'global' },
        data: { value: { ...before, ai: { enabled: true, provider: 'openai', model: 'gpt-4o', maxCallsPerUserPerDay: 7, apiKey: null } } },
      });

      const res = await http().get('/api/system-settings').set(as('admin'));

      expect(res.status).toBe(200);
      // The platform AI policy has no provider switched on yet, so card scanning is refused
      // (503 AI_NOT_CONFIGURED) until the command runs; nothing 500s.
      expect(res.body.data.ai.providers.openai.enabled).toBe(false);
      expect(res.body.data.ai).not.toHaveProperty('model');
      await prisma.systemSettings.update({ where: { key: 'global' }, data: { value: before } });
    });
  });

  describe('/api/user-settings', () => {
    it('reads a pre-E4.1 profile in the platform layout and keeps the custom image URL', async () => {
      const res = await http().get('/api/user-settings').set(as('contributor'));

      expect(res.status).toBe(200);
      expect(res.body.data.theme).toBe('dark');
      expect(res.body.data.profile).toMatchObject({
        displayName: 'Person A',
        imageSource: 'none',
        customImageUrl: 'https://img.example.test/me.png',
      });
      expect(res.body.data.profile).not.toHaveProperty('useProviderImage');
    });

    it('creates the default document on first read', async () => {
      const res = await http().get('/api/user-settings').set(as('viewer'));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ theme: 'system', profile: { imageSource: 'provider' } });
    });

    it('PATCH changes the theme and keeps the rest; PUT replaces the document', async () => {
      const patch = await http().patch('/api/user-settings').set(as('contributor')).send({ theme: 'light' });
      expect(patch.status).toBe(200);
      expect(patch.body.data.theme).toBe('light');
      expect(patch.body.data.profile.displayName).toBe('Person A');

      const put = await http()
        .put('/api/user-settings')
        .set(as('contributor'))
        .send({ theme: 'dark', profile: { displayName: 'Person B', imageSource: 'provider' } });
      expect(put.status).toBe(200);
      expect(put.body.data.profile.displayName).toBe('Person B');
    });

    it('stores dataTables and navigation server-side (the web localStorage shims move here)', async () => {
      const res = await http()
        .patch('/api/user-settings')
        .set(as('contributor'))
        .send({ navigation: { railCollapsed: true }, dataTables: { 'secrets-list': { savedViews: [] } } });

      expect(res.status).toBe(200);
      expect(res.body.data.navigation).toMatchObject({ railCollapsed: true });
      const again = await http().get('/api/user-settings').set(as('contributor'));
      expect(again.body.data.navigation).toMatchObject({ railCollapsed: true });
      expect(again.body.data.dataTables).toHaveProperty('secrets-list');
    });

    it('rejects an invalid theme (400) and anonymous access (401); a user only reaches their own document', async () => {
      expect((await http().patch('/api/user-settings').set(as('contributor')).send({ theme: 'neon' })).status).toBe(400);
      expect((await http().get('/api/user-settings')).status).toBe(401);
      const mine = await http().get('/api/user-settings').set(as('viewer'));
      const theirs = await http().get('/api/user-settings').set(as('contributor'));
      expect(mine.body.data.profile.displayName).not.toBe(theirs.body.data.profile.displayName);
    });

    it('refuses an uploaded avatar: Vault has no avatar objects until the storage slice', async () => {
      const res = await http()
        .patch('/api/user-settings')
        .set(as('contributor'))
        .send({ profile: { imageSource: 'upload', imageObjectId: '00000000-0000-4000-8000-000000000000' } });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('/api/org-settings', () => {
    it('serves the default organization to its org_admin and refuses the others', async () => {
      expect((await http().get('/api/org-settings').set(as('admin'))).status).toBe(200);
      expect((await http().get('/api/org-settings').set(as('contributor'))).status).toBe(403);
      expect((await http().get('/api/org-settings')).status).toBe(401);
    });

    it('refuses a namespace that has no organization layer', async () => {
      const res = await http().patch('/api/org-settings').set(as('admin')).send({ ui: { allowUserThemeOverride: true } });
      expect(res.status).toBe(400);
    });
  });

  describe('the data migration against real rows', () => {
    it('dry run changes nothing; apply rewrites the legacy profile once; values survive', async () => {
      const legacy = { theme: 'dark', profile: { displayName: 'Person C', useProviderImage: true, customImageUrl: null } };
      await prisma.userSettings.upsert({
        where: { userId: ids.admin },
        create: { userId: ids.admin, value: legacy },
        update: { value: legacy },
      });
      const before = JSON.stringify(await prisma.userSettings.findMany({ orderBy: { id: 'asc' } }));

      const dry = await migrateSettings(prisma as never);
      expect(dry.userRowsToMigrate).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(await prisma.userSettings.findMany({ orderBy: { id: 'asc' } }))).toBe(before);

      const applied = await migrateSettings(prisma as never, { apply: true });
      expect(applied.userRowsMigrated).toBe(dry.userRowsToMigrate);
      const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId: ids.admin } });
      expect(row.value).toEqual({
        theme: 'dark',
        profile: { displayName: 'Person C', imageSource: 'provider', imageObjectId: null },
      });

      const again = await migrateSettings(prisma as never, { apply: true });
      expect(again.userRowsMigrated).toBe(0);
      expect(formatSettingsMigrationReport(again).join('\n')).not.toContain('Person C');

      // The route still serves the migrated document.
      const res = await http().get('/api/user-settings').set(as('admin'));
      expect(res.body.data).toMatchObject({ theme: 'dark', profile: { displayName: 'Person C', imageSource: 'provider' } });
    });
  });
});
