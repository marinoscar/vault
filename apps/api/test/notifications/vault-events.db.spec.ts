// =============================================================================
// Real-Postgres test: Vault's notification events (issue #86, E7.2, epic #62)
// =============================================================================
//
// Boots the full app against a migrated, seeded deployment (ordinary application role,
// in-process worker ON, a fake object store) and proves, over real tables:
//
//   * the three events are in the preferences matrix (`GET /api/notifications/events`);
//   * `vault.card_expiring`: the daily scan notifies the OWNER at 30, 7 and 0 days, and running it
//     again on the same day sends nothing (dedup per card and threshold, no new table); a renewed
//     card is re-armed; no card field value reaches an inbox row, a delivery row or the audit trail;
//   * the cron only enqueues a `vault.cards.expiry_scan` job (system job, orgId null) and the
//     worker runs it;
//   * backup results: a user backup tells its owner only, a system backup tells the holders of
//     `system_settings:read` only; a failure carries the static message, never the raw error.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
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
import { BACKUP_FAILURE_MESSAGES } from '../../src/backups/backup-runner.service';
import { CARD_EXPIRY_SCAN_JOB_TYPE } from '../../src/card-expiry/card-expiry-job-types';
import { CardExpiryScanHandler } from '../../src/card-expiry/card-expiry-scan.handler';
import { CryptoService } from '../../src/common/services/crypto.service';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import { STORAGE_PROVIDER } from '../../src/storage/providers/storage-provider.interface';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const DAY = 24 * 3600 * 1000;
const SCHEDULE_PASSWORD = 'Schedule-Pass-0xA1';
const USER_PASSWORD = 'My-Own-Pass-0xB2C3';

const MARKERS = {
  number: '4111999988887777',
  cvv: 'CVV-MARKER-913',
  holder: 'HOLDER-MARKER-ZED',
  code2: 'CID-MARKER-552',
  notes: 'NOTES-MARKER-quartz',
  bank: 'BANK-MARKER-orchid',
};

class FakeStorage {
  readonly objects = new Map<string, Buffer>();
  failUploads = false;
  getBucket() {
    return 'fake-bucket';
  }
  async upload(key: string, stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    if (this.failUploads) throw new Error('S3 exploded');
    this.objects.set(key, Buffer.concat(chunks));
    return { key };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describeWithDb("Vault's notification events (real Postgres, worker on)", () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let crypto: CryptoService;
  const storage = new FakeStorage();
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { admin: '', a: '', b: '' };
  const ids = { admin: '', a: '', b: '' };

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(who: keyof typeof tokens, orgRole: 'org_admin' | 'contributor', systemAdmin: boolean) {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: orgRole } });
    const user = await prisma.user.create({
      data: { email: `${who}-vault-events@example.test`, providerDisplayName: `Person ${who.toUpperCase()}` },
    });
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

  async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await probe();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const inbox = (userId: string, eventKey: string) =>
    prisma.notification.findMany({ where: { userId, eventKey }, orderBy: { createdAt: 'asc' } });

  let cardTypeId = '';
  async function addCard(ownerId: string, name: string, over: Record<string, string> = {}) {
    const secret = await prisma.secret.create({ data: { name, typeId: cardTypeId, createdById: ownerId } });
    const values = {
      card_network: 'visa',
      cardholder_name: MARKERS.holder,
      number: MARKERS.number,
      exp_month: '07',
      exp_year: '2027',
      cvv: MARKERS.cvv,
      security_code_2: MARKERS.code2,
      issuing_bank: MARKERS.bank,
      notes: MARKERS.notes,
      ...over,
    };
    const enc = crypto.encrypt(JSON.stringify(values));
    await prisma.secretVersion.create({
      data: {
        secretId: secret.id,
        version: 1,
        encryptedData: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        createdById: ownerId,
        isCurrent: true,
      },
    });
    return secret.id;
  }

  async function fireCron(className: string, method: string): Promise<void> {
    const task = app
      .get(DiscoveryService)
      .getProviders()
      .map((wrapper) => wrapper.instance as Record<string, () => Promise<void>> | null)
      .find((instance) => instance?.constructor?.name === className);
    if (typeof task?.[method] !== 'function') throw new Error(`No provider ${className} with ${method}()`);
    await task[method]();
  }

  const putSchedule = () =>
    http()
      .put('/api/admin/backups/schedule')
      .set(as('admin'))
      .send({
        enabled: true,
        frequency: 'daily',
        intervalHours: null,
        dayOfWeek: null,
        dayOfMonth: null,
        timeOfDay: '03:00',
        timezone: 'UTC',
        keepCount: 7,
        includeAttachments: true,
        includeVersions: false,
        includeSecrets: true,
        includeMedia: false,
        includeSystem: false,
        password: SCHEDULE_PASSWORD,
      });

  const enableEvent = async (who: keyof typeof tokens, eventKey: string) => {
    const res = await http()
      .patch('/api/user-settings')
      .set(as(who))
      .send({ notifications: { browser: { [eventKey]: true } } });
    expect([res.status, res.body.message]).toEqual([200, undefined]);
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

    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'JOBS_WORKER_MODE', 'JOBS_POLL_MS']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env, { JOBS_WORKER_MODE: 'all', JOBS_POLL_MS: '200' });
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    crypto = app.get(CryptoService);

    await createUser('admin', 'org_admin', true);
    await createUser('a', 'contributor', false);
    await createUser('b', 'contributor', false);

    const cardType = await prisma.secretType.create({
      data: { name: 'Card', isSystem: true, fields: [{ name: 'number', label: 'Number', type: 'string' }] },
    });
    cardTypeId = cardType.id;
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

  it('lists the three events in the preferences matrix', async () => {
    const res = await http().get('/api/notifications/events').set(as('a'));
    expect(res.status).toBe(200);
    const events = JSON.stringify(res.body);
    for (const key of ['vault.backup_succeeded', 'vault.backup_failed', 'vault.card_expiring']) {
      expect(events).toContain(key);
    }
  });

  describe('vault.card_expiring (the expiry scan)', () => {
    let aCard = '';
    let scan: (now: Date) => Promise<{ scanned: number; notified: number; unreadable: number }>;
    // The card expires 07/2027: valid through 2027-07-31.
    const at = (iso: string) => new Date(`${iso}T08:00:00Z`);

    beforeAll(async () => {
      aCard = await addCard(ids.a, 'Travel card');
      await addCard(ids.b, 'Spare card', { exp_year: '2030' });
      const handler = app.get(CardExpiryScanHandler);
      scan = (now) => handler.scan(now);
    });

    it('sends nothing more than 30 days out', async () => {
      expect(await scan(at('2027-06-30'))).toMatchObject({ scanned: 2, notified: 0 });
      expect(await inbox(ids.a, 'vault.card_expiring')).toHaveLength(0);
    });

    it.each([
      ['2027-07-01', 30, 1],
      ['2027-07-24', 7, 2],
      ['2027-07-31', 0, 3],
    ])('on %s sends the %i-day message once, however often the scan runs', async (day, threshold, total) => {
      expect(await scan(at(day))).toMatchObject({ notified: 1 });
      expect(await scan(at(day))).toMatchObject({ notified: 0 });
      expect(await scan(at(day))).toMatchObject({ notified: 0 });

      const rows = await inbox(ids.a, 'vault.card_expiring');
      expect(rows).toHaveLength(total);
      const last = rows[rows.length - 1];
      expect(last.link).toBe(`/secrets/${aCard}`);
      expect(last.title).toBe('A card is expiring');
      expect(last.body).toContain('Travel card');
      expect(last.body).toContain('07/2027');
      expect(last.body).toContain(threshold === 0 ? 'expires today' : `expires in ${threshold} days`);
    });

    it('is quiet once the month is over, and never tells another user', async () => {
      expect(await scan(at('2027-08-01'))).toMatchObject({ notified: 0 });
      expect(await inbox(ids.a, 'vault.card_expiring')).toHaveLength(3);
      expect(await inbox(ids.b, 'vault.card_expiring')).toHaveLength(0);
    });

    it('re-arms after a renewal (a new expiry) and records the dedup in the audit trail', async () => {
      const version = await prisma.secretVersion.findFirstOrThrow({ where: { secretId: aCard, isCurrent: true } });
      const renewed = crypto.encrypt(
        JSON.stringify({ number: MARKERS.number, cvv: MARKERS.cvv, exp_month: '09', exp_year: '2028' }),
      );
      await prisma.secretVersion.update({ where: { id: version.id }, data: { isCurrent: false } });
      await prisma.secretVersion.create({
        data: {
          secretId: aCard,
          version: 2,
          encryptedData: renewed.ciphertext,
          iv: renewed.iv,
          authTag: renewed.authTag,
          createdById: ids.a,
          isCurrent: true,
        },
      });

      expect(await scan(at('2028-09-23'))).toMatchObject({ notified: 1 });
      expect(await scan(at('2028-09-23'))).toMatchObject({ notified: 0 });
      expect(await inbox(ids.a, 'vault.card_expiring')).toHaveLength(4);

      const audit = await prisma.auditEvent.findMany({
        where: { action: 'vault.card.expiry_notified', targetId: aCard },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((row) => row.meta)).toEqual([
        { threshold: 30, expiry: '07/2027' },
        { threshold: 7, expiry: '07/2027' },
        { threshold: 0, expiry: '07/2027' },
        { threshold: 7, expiry: '09/2028' },
      ]);
    });

    it('leaks no card field value into an inbox row, a delivery row, the audit trail or a job', async () => {
      const everything = JSON.stringify(
        {
          inbox: await prisma.notification.findMany(),
          deliveries: await prisma.notificationDelivery.findMany(),
          audit: await prisma.auditEvent.findMany(),
          jobs: await prisma.job.findMany(),
        },
        (_k, v) => (typeof v === 'bigint' ? String(v) : v),
      );
      for (const marker of Object.values(MARKERS)) {
        expect(everything).not.toContain(marker);
      }
      expect(everything).not.toContain('4111');
    });

    it('the daily cron only enqueues a system job, and the worker runs it', async () => {
      await fireCron('CardExpiryTask', 'handleTick');
      const job = await prisma.job.findFirstOrThrow({
        where: { type: CARD_EXPIRY_SCAN_JOB_TYPE },
        orderBy: { createdAt: 'desc' },
      });
      expect(job.orgId).toBeNull();
      await waitFor('the scan job to succeed', async () => {
        const row = await prisma.job.findUnique({ where: { id: job.id } });
        return row?.status === 'succeeded' ? row : null;
      });
    });
  });

  describe('backup results', () => {
    const runStatus = (id: string, status: string) =>
      waitFor(`run ${id} to be ${status}`, async () => {
        const run = await prisma.backupRun.findUnique({ where: { id } });
        return run?.status === status ? run : null;
      });

    beforeAll(async () => {
      // The success message is routine and off by default: admin and user A opt in.
      await enableEvent('admin', 'vault.backup_succeeded');
      await enableEvent('a', 'vault.backup_succeeded');
      expect((await putSchedule()).status).toBe(200);
    });

    beforeEach(() => {
      storage.failUploads = false;
    });

    it('a system backup tells the administrators, not a contributor', async () => {
      const started = await http().post('/api/admin/backups/run').set(as('admin'));
      expect(started.status).toBe(202);
      const run = await runStatus(started.body.data.id, 'succeeded');

      const rows = await waitFor('the admin message', async () => {
        const found = await inbox(ids.admin, 'vault.backup_succeeded');
        return found.length > 0 ? found : null;
      });
      expect(rows[0]).toMatchObject({ title: 'Backup completed', link: '/admin/settings/backups' });
      expect(rows[0].body).toContain('Manual system backup');
      expect(rows[0].body).toContain('secret');
      expect(JSON.stringify(rows[0])).not.toContain(run.storageKey!);

      await waitFor('the queue to drain', async () => (await prisma.job.count({ where: { status: { in: ['pending', 'running'] } } })) === 0);
      expect(await inbox(ids.a, 'vault.backup_succeeded')).toHaveLength(0);
      expect(await inbox(ids.b, 'vault.backup_succeeded')).toHaveLength(0);
    });

    it('a failed system backup carries the static message and never the raw error', async () => {
      storage.failUploads = true;
      const started = await http().post('/api/admin/backups/run').set(as('admin'));
      expect(started.status).toBe(202);
      await runStatus(started.body.data.id, 'failed');

      const rows = await waitFor('the admin failure message', async () => {
        const found = await inbox(ids.admin, 'vault.backup_failed');
        return found.length > 0 ? found : null;
      });
      expect(rows[0].title).toBe('Backup failed');
      expect(rows[0].body).toContain(BACKUP_FAILURE_MESSAGES.upload);
      expect(JSON.stringify(rows)).not.toContain('S3 exploded');
      expect(await inbox(ids.a, 'vault.backup_failed')).toHaveLength(0);
    });

    it("a user's backup tells its owner only", async () => {
      await waitFor('the queue to drain', async () => (await prisma.job.count({ where: { status: { in: ['pending', 'running'] } } })) === 0);
      const adminBefore = (await inbox(ids.admin, 'vault.backup_succeeded')).length;

      const started = await http().post('/api/backups/me').set(as('a')).send({ password: USER_PASSWORD });
      expect(started.status).toBe(202);
      await runStatus(started.body.data.id, 'succeeded');

      const rows = await waitFor('the owner message', async () => {
        const found = await inbox(ids.a, 'vault.backup_succeeded');
        return found.length > 0 ? found : null;
      });
      expect(rows[0]).toMatchObject({ link: '/settings/backups' });
      expect(rows[0].body).toContain('Your saved backup');
      expect(JSON.stringify(rows)).not.toContain(USER_PASSWORD);

      expect(await inbox(ids.admin, 'vault.backup_succeeded')).toHaveLength(adminBefore);
      expect(await inbox(ids.b, 'vault.backup_succeeded')).toHaveLength(0);
    });

    it("a user's failed backup tells its owner (on by default) and nobody else", async () => {
      await waitFor('the queue to drain', async () => (await prisma.job.count({ where: { status: { in: ['pending', 'running'] } } })) === 0);
      const adminBefore = (await inbox(ids.admin, 'vault.backup_failed')).length;
      storage.failUploads = true;

      const started = await http().post('/api/backups/me').set(as('a')).send({ password: USER_PASSWORD });
      expect(started.status).toBe(202);
      await runStatus(started.body.data.id, 'failed');

      const rows = await waitFor('the owner failure message', async () => {
        const found = await inbox(ids.a, 'vault.backup_failed');
        return found.length > 0 ? found : null;
      });
      expect(rows[0]).toMatchObject({ link: '/settings/backups' });
      expect(rows[0].body).toContain(BACKUP_FAILURE_MESSAGES.upload);
      expect(JSON.stringify(rows)).not.toContain(USER_PASSWORD);
      expect(await inbox(ids.admin, 'vault.backup_failed')).toHaveLength(adminBefore);
    });
  });
});
