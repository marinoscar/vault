// =============================================================================
// Real-Postgres test: the queue runs in Vault (issue #81 E5.1, #83 E5.3)
// =============================================================================
//
// Boots the full app against a migrated, seeded deployment (the ordinary
// application role, as in production) with the in-process worker ON, and proves:
//
//   * the identity cleanup crons only ENQUEUE: firing each cron puts a global
//     `jobs` row (`org_id` null) and the worker runs it to `succeeded`, which
//     deletes an expired refresh token planted for the purpose (the shim of E3.2
//     remembered the handlers and ran nothing);
//   * `GET /api/admin/jobs` answers the admin, and only the admin.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable
// Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { DiscoveryService } from '@nestjs/core';
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

describeWithDb('the job queue in Vault (real Postgres, worker on)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { admin: '', contributor: '' };

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(who: keyof typeof tokens, orgRole: 'org_admin' | 'contributor', systemAdmin: boolean) {
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
    return user.id;
  }

  /**
   * Runs the `@Cron` method of the platform task class named `className`, the way the
   * scheduler does on its tick. Found by class name because the scheduler's own registry
   * names crons by uuid.
   */
  async function fireCron(className: string, method: string): Promise<void> {
    const task = app
      .get(DiscoveryService)
      .getProviders()
      .map((wrapper) => wrapper.instance as Record<string, () => Promise<void>> | null)
      .find((instance) => instance?.constructor?.name === className);
    if (typeof task?.[method] !== 'function') throw new Error(`No provider ${className} with ${method}()`);
    await task[method]();
  }

  async function waitForJob(type: string, status: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await prisma.job.findFirst({ where: { type }, orderBy: { createdAt: 'desc' } });
      if (job?.status === status) return job;
      if (Date.now() > deadline) throw new Error(`Job ${type} did not reach ${status}; last: ${job?.status ?? 'none'}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
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

    const adminId = await createUser('admin', 'org_admin', true);
    await createUser('contributor', 'contributor', false);
    await prisma.refreshToken.create({
      data: { userId: adminId, tokenHash: sha256('stale'), expiresAt: new Date(Date.now() - 400 * DAY) },
    });

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

  it('the token-cleanup cron enqueues a global job and the worker runs it', async () => {
    expect(await prisma.refreshToken.count({ where: { tokenHash: sha256('stale') } })).toBe(1);

    await fireCron('TokenCleanupTask', 'handleCron');
    const job = await waitForJob('auth.token.cleanup', 'succeeded');

    expect(job.orgId).toBeNull();
    expect(await prisma.refreshToken.count({ where: { tokenHash: sha256('stale') } })).toBe(0);
  });

  it('the device-code cleanup cron enqueues its job and the worker runs it', async () => {
    await fireCron('DeviceCodeCleanupTask', 'handleCleanup');
    const job = await waitForJob('device-auth.code.cleanup', 'succeeded');

    expect(job.orgId).toBeNull();
  });

  it('GET /api/admin/jobs lists the jobs for the admin and refuses everyone else', async () => {
    const listed = await http().get('/api/admin/jobs').set(as('admin'));
    expect(listed.status).toBe(200);
    const types = JSON.stringify(listed.body);
    expect(types).toContain('auth.token.cleanup');

    expect((await http().get('/api/admin/jobs').set(as('contributor'))).status).toBe(403);
    expect((await http().get('/api/admin/jobs')).status).toBe(401);
    expect((await http().get('/api/admin/nodes').set(as('admin'))).status).toBe(200);
  });

  it('the jobs, retention and nodes namespaces are served by /api/system-settings', async () => {
    const res = await http().get('/api/system-settings').set(as('admin'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ jobs: expect.any(Object), retention: expect.any(Object), nodes: expect.any(Object) }));
  });
});
