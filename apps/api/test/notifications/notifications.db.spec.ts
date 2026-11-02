// =============================================================================
// Real-Postgres test: email and notifications in Vault (issue #85, E7.1)
// =============================================================================
//
// Boots the full app against a migrated, seeded deployment (the ordinary
// application role, the in-process worker ON) and proves, over real tables:
//
//   * an admin broadcast reaches the bell: `POST /api/admin/broadcasts` runs the
//     `admin.broadcast.start` and `.chunk` jobs and the contributor's
//     `GET /api/notifications` and unread count carry the row (acceptance
//     criterion of #85);
//   * marking it read clears the unread count; another user never sees it;
//   * the identity notifier writes a `security.role_changed` inbox row and a
//     delivery row through `NotificationsService`, and the event is mandatory;
//   * the broadcast routes refuse a contributor, the email and push settings
//     routes answer an admin, and none of them needs an environment variable.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres
// superuser.
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
import { IDENTITY_NOTIFIER, type IdentityNotifier } from '@marinoscar/platform-api/identity';

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

describeWithDb('email and notifications in Vault (real Postgres, worker on)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { admin: '', contributor: '', viewer: '' };
  const ids = { admin: '', contributor: '', viewer: '' };

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(who: keyof typeof tokens, orgRole: 'org_admin' | 'contributor' | 'viewer', systemAdmin: boolean) {
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
        expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
    tokens[who] = raw;
    ids[who] = user.id;
  }

  async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 25_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await probe();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
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

    await createUser('admin', 'org_admin', true);
    await createUser('contributor', 'contributor', false);
    await createUser('viewer', 'viewer', false);

    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'JOBS_WORKER_MODE', 'JOBS_POLL_MS']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env, { JOBS_WORKER_MODE: 'all', JOBS_POLL_MS: '200' });
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

  it('an admin broadcast reaches the bell of every active user', async () => {
    const created = await http()
      .post('/api/admin/broadcasts')
      .set(as('admin'))
      .send({ title: 'Planned maintenance', body: 'The vault is read-only for ten minutes.', channels: ['browser'] });
    expect(created.status).toBe(201);

    const inbox = await waitFor('the broadcast in the contributor inbox', async () => {
      const res = await http().get('/api/notifications').set(as('contributor'));
      expect(res.status).toBe(200);
      const items = JSON.stringify(res.body).includes('Planned maintenance') ? res.body : null;
      return items;
    });
    expect(JSON.stringify(inbox)).toContain('The vault is read-only for ten minutes.');

    const unread = await http().get('/api/notifications/unread-count').set(as('contributor'));
    expect(unread.status).toBe(200);
    expect(unread.body.data).toMatchObject({ unreadCount: 1 });

    // Every active user is in the audience, the admin who sent it included.
    for (const who of ['admin', 'viewer'] as const) {
      await waitFor(`the broadcast in the ${who} inbox`, async () =>
        JSON.stringify((await http().get('/api/notifications').set(as(who))).body).includes('Planned maintenance'),
      );
    }

    expect(await prisma.notification.count({ where: { userId: ids.contributor } })).toBe(1);
  });

  it('marking the broadcast read clears the unread count and touches no one else', async () => {
    const list = await http().get('/api/notifications').set(as('contributor'));
    const rows = (list.body.data?.items ?? list.body.data) as Array<{ id: string }>;
    const read = await http().post(`/api/notifications/${rows[0].id}/read`).set(as('contributor'));
    expect([200, 201, 204]).toContain(read.status);

    const unread = await http().get('/api/notifications/unread-count').set(as('contributor'));
    expect(unread.body.data).toMatchObject({ unreadCount: 0 });
    const other = await http().get('/api/notifications/unread-count').set(as('viewer'));
    expect(other.body.data).toMatchObject({ unreadCount: 1 });
  });

  it('the identity notifier writes a mandatory role-change inbox row and a delivery row', async () => {
    const notifier = app.get<IdentityNotifier>(IDENTITY_NOTIFIER, { strict: false });
    await notifier.roleChanged(ids.viewer, {
      recipientEmail: 'viewer@example.test',
      previousRoles: ['viewer'],
      currentRoles: ['contributor'],
      changedAt: new Date().toISOString(),
    } as never);

    const row = await waitFor('the role-change inbox row', () =>
      prisma.notification.findFirst({ where: { userId: ids.viewer, eventKey: 'security.role_changed' } }),
    );
    expect(row.userId).toBe(ids.viewer);
    // The email channel is attempted too (no transport is configured, so it is recorded, not lost).
    const delivery = await waitFor('a delivery row', () =>
      prisma.notificationDelivery.findFirst({ where: { userId: ids.viewer, eventKey: 'security.role_changed' } }),
    );
    expect(delivery.eventKey).toBe('security.role_changed');
  });

  it('refuses broadcasts to a contributor and serves the settings routes to an admin', async () => {
    expect((await http().get('/api/admin/broadcasts').set(as('contributor'))).status).toBe(403);
    expect((await http().get('/api/admin/broadcasts')).status).toBe(401);
    expect((await http().get('/api/admin/broadcasts').set(as('admin'))).status).toBe(200);
    expect((await http().get('/api/email-settings').set(as('admin'))).status).toBe(200);
    expect((await http().get('/api/email-settings').set(as('contributor'))).status).toBe(403);
    expect((await http().get('/api/admin/push-config').set(as('admin'))).status).toBe(200);
    expect((await http().get('/api/admin/push-config').set(as('contributor'))).status).toBe(403);
  });

  it('serves the notifications policy through /api/system-settings', async () => {
    const res = await http().get('/api/system-settings').set(as('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ notifications: expect.any(Object) }));
  });
});
