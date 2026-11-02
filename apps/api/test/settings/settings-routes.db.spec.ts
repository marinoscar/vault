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
//   * existing values survive (ui, features, ai block, maintenance, an unknown
//     key, the pre-E4.2 ai.apiKey ciphertext block) and are served in the same
//     wire shape;
//   * the AI key is write-only: stored in the credential store, never returned,
//     never in the settings row, never in an audit row;
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
const API_KEY = 'sk-test-0123456789abcdefghijklmnop';
const LEGACY_CIPHERTEXT = {
  ciphertext: 'c2VjcmV0LWNpcGhlcnRleHQ=',
  iv: 'aXY=',
  authTag: 'dGFn',
  last4: 'wxyz',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

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
          ai: { enabled: true, provider: 'openai', model: 'gpt-4o', maxCallsPerUserPerDay: 7, apiKey: LEGACY_CIPHERTEXT },
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
          provider: 'openai',
          model: 'gpt-4o',
          maxCallsPerUserPerDay: 7,
          apiKeyConfigured: false,
          apiKeyLast4: null,
          apiKeyUpdatedAt: null,
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

    it('never returns the legacy ciphertext block or any key field', async () => {
      const res = await http().get('/api/system-settings').set(as('admin'));
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(LEGACY_CIPHERTEXT.ciphertext);
      expect(text).not.toContain('authTag');
      expect(res.body.data.ai).not.toHaveProperty('apiKey');
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
    it('merges feature flags and keeps every key it does not own, the legacy ciphertext included', async () => {
      const res = await http().patch('/api/system-settings').set(as('admin')).send({ features: { newFlag: true } });

      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ cardScanning: true, newFlag: true });
      const stored = (await globalRow()).value as Record<string, any>;
      expect(stored.futureThing).toEqual({ keep: 'me' });
      expect(stored.maintenance).toMatchObject({ message: 'Back soon' });
      expect(stored.ui).toEqual({ allowUserThemeOverride: false });
      // The pre-E4.2 block waits for vault:migrate-ai-key; a save must not destroy it.
      expect(stored.ai.apiKey).toEqual(LEGACY_CIPHERTEXT);
    });

    it('rejects a contributor', async () => {
      const res = await http().patch('/api/system-settings').set(as('contributor')).send({ features: { x: true } });
      expect(res.status).toBe(403);
    });

    it('validates input (400) and a stale If-Match is a 409', async () => {
      expect(
        (await http().patch('/api/system-settings').set(as('admin')).send({ ai: { maxCallsPerUserPerDay: -1 } })).status,
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

  describe('the AI key', () => {
    const settingsAndAuditText = async () => ({
      row: JSON.stringify((await globalRow()).value),
      audits: JSON.stringify(await prisma.auditEvent.findMany()),
      credentialRows: JSON.stringify(await prisma.credential.findMany()),
    });

    it('is stored in the credential store, masked in the response, and nowhere else', async () => {
      const res = await http().patch('/api/system-settings').set(as('admin')).send({ ai: { apiKey: API_KEY } });

      expect(res.status).toBe(200);
      expect(res.body.data.ai).toMatchObject({ apiKeyConfigured: true, apiKeyLast4: 'mnop', apiKeyUpdatedAt: expect.any(String) });
      expect(JSON.stringify(res.body)).not.toContain(API_KEY);

      const { row, audits, credentialRows } = await settingsAndAuditText();
      expect(row).not.toContain(API_KEY);
      expect(audits).not.toContain(API_KEY);
      expect(credentialRows).not.toContain(API_KEY);
      expect(await prisma.credential.count({ where: { purpose: 'ai', name: 'openai' } })).toBe(1);
      expect(audits).toContain('system_settings:ai_key');

      const get = await http().get('/api/system-settings').set(as('admin'));
      expect(get.body.data.ai).toMatchObject({ apiKeyConfigured: true, apiKeyLast4: 'mnop' });
      expect(JSON.stringify(get.body)).not.toContain(API_KEY);
    });

    it('an unrelated save does not touch the key', async () => {
      const res = await http().patch('/api/system-settings').set(as('admin')).send({ ai: { enabled: false, model: 'gpt-4o-mini' } });
      expect(res.status).toBe(200);
      expect(res.body.data.ai).toMatchObject({ enabled: false, model: 'gpt-4o-mini', apiKeyConfigured: true, apiKeyLast4: 'mnop' });
    });

    it('a PUT without ai keeps the stored ai block and the key; an ai member replaces only the non-secret fields', async () => {
      const smuggled = 'z'.repeat(30);
      const res = await http()
        .put('/api/system-settings')
        .set(as('admin'))
        .send({ ui: { allowUserThemeOverride: true }, features: { onlyFlag: true }, ai: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', maxCallsPerUserPerDay: 9, apiKey: smuggled } });

      expect(res.status).toBe(200);
      expect(res.body.data.features).toEqual({ onlyFlag: true });
      expect(res.body.data.ai).toMatchObject({ enabled: true, maxCallsPerUserPerDay: 9, apiKeyConfigured: true, apiKeyLast4: 'mnop' });
      expect(JSON.stringify((await globalRow()).value)).not.toContain(smuggled);

      const without = await http().put('/api/system-settings').set(as('admin')).send({ ui: { allowUserThemeOverride: true }, features: {} });
      expect(without.status).toBe(200);
      expect(without.body.data.ai).toMatchObject({ enabled: true, maxCallsPerUserPerDay: 9, apiKeyLast4: 'mnop' });
      expect((await globalRow()).value).toMatchObject({ futureThing: { keep: 'me' } });
    });

    it('a too-short key is a 400 and changes nothing', async () => {
      const res = await http().patch('/api/system-settings').set(as('admin')).send({ ai: { apiKey: 'short' } });
      expect(res.status).toBe(400);
      const get = await http().get('/api/system-settings').set(as('admin'));
      expect(get.body.data.ai.apiKeyConfigured).toBe(true);
    });

    it('a stale If-Match leaves the key as it was', async () => {
      const res = await http()
        .patch('/api/system-settings')
        .set(as('admin'))
        .set('If-Match', '9999')
        .send({ ai: { apiKey: 'sk-test-REPLACEMENT-0123456789abcdef' } });
      expect(res.status).toBe(409);
      const get = await http().get('/api/system-settings').set(as('admin'));
      expect(get.body.data.ai.apiKeyLast4).toBe('mnop');
    });

    it('null clears the key', async () => {
      const res = await http().patch('/api/system-settings').set(as('admin')).send({ ai: { apiKey: null } });
      expect(res.status).toBe(200);
      expect(res.body.data.ai).toMatchObject({ apiKeyConfigured: false, apiKeyLast4: null });
      expect(await prisma.credential.count({ where: { purpose: 'ai', name: 'openai' } })).toBe(0);
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
