// =============================================================================
// Real-Postgres test: backups run as queue jobs (issue #82, E5.2, epic #54)
// =============================================================================
//
// Boots the full app against a migrated, seeded deployment (the ordinary application
// role, as in production) with the in-process worker ON and a fake in-memory object
// store, and proves:
//
//   * a manual system backup (`POST /api/admin/backups/run`) queues a `vault.backup.run`
//     job, links the run to it (`backup_runs.job_id`), and the worker uploads an archive
//     that opens with the schedule password; the job settles `succeeded`;
//   * a second request while one is queued or running is HTTP 409 (the queue's active-dedup
//     key replaced the advisory locks), for the system run and per user;
//   * the minute tick is enqueue-only: firing it queues a job, the HANDLER writes the run;
//   * retention keeps the newest N after successful runs;
//   * a user backup keeps its password out of `jobs.payload` (ciphertext while queued, removed
//     once settled), out of the logs, the audit rows and the run rows;
//   * a failing upload fails the run with a static message AND the job;
//   * a run whose job failed without recording it reads as failed, not running.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { JobsService, buildDedupKey } from '@marinoscar/platform-api/jobs';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { AppModule } from '../../src/app.module';
import { CryptoService } from '../../src/common/services/crypto.service';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';
import { BACKUP_FAILURE_MESSAGES, BackupRunnerService } from '../../src/backups/backup-runner.service';
import { systemBackupStorageKey } from '../../src/backups/backup-archive';
import { BACKUP_RUN_JOB_TYPE, USER_BACKUP_RUN_JOB_TYPE } from '../../src/backups/jobs/backup-job-types';
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
const USER_PASSWORD_B = 'Other-Own-Pass-0xD4';

/** An in-memory object store: just what the backup runner touches. */
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

describeWithDb('backups as queue jobs (real Postgres, worker on)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let jobs: JobsService;
  let crypto: CryptoService;
  const storage = new FakeStorage();
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { admin: '', a: '', b: '' };
  const ids = { admin: '', a: '', b: '' };
  const logged: unknown[][] = [];

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(who: keyof typeof tokens, orgRole: 'org_admin' | 'contributor', systemAdmin: boolean) {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: orgRole } });
    const user = await prisma.user.create({
      data: { email: `${who}-backup@example.test`, providerDisplayName: `Person ${who.toUpperCase()}` },
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
    return user.id;
  }

  async function addSecret(ownerId: string, name: string) {
    const type = await prisma.secretType.create({
      data: { name: `Type for ${name}`, fields: [{ name: 'user', label: 'User', type: 'string' }], createdById: ownerId },
    });
    const secret = await prisma.secret.create({ data: { name, typeId: type.id, createdById: ownerId } });
    const enc = crypto.encrypt(JSON.stringify({ user: `${name}-login` }));
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

  async function waitFor<T>(what: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const runStatus = (id: string, status: string) =>
    waitFor(`run ${id} to be ${status}`, async () => {
      const run = await prisma.backupRun.findUnique({ where: { id } });
      return run?.status === status ? run : null;
    });

  /** Parks a pending job on a dedup key (scheduled in the future so the worker leaves it). */
  async function holdSlot(type: string, subject?: { type: string; id: string }) {
    return jobs.enqueue({
      type,
      reason: 'backfill',
      orgId: null,
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
      scheduledFor: new Date(Date.now() + DAY),
    });
  }

  async function openArchive(bytes: Buffer, password: string) {
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)));
    const entries = (await reader.getEntries()) as FileEntry[];
    const read = async (name: string) =>
      JSON.parse(
        Buffer.from(
          await entries.find((e) => e.filename === name)!.getData(new Uint8ArrayWriter(), { password }),
        ).toString('utf8'),
      );
    return { names: entries.map((e) => e.filename).sort(), read, close: () => reader.close() };
  }

  const putSchedule = (over: Record<string, unknown> = {}) =>
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
        ...over,
      });

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
    jobs = app.get(JobsService);
    crypto = app.get(CryptoService);

    await createUser('admin', 'org_admin', true);
    await createUser('a', 'contributor', false);
    await createUser('b', 'contributor', false);
    await addSecret(ids.a, 'Alpha Login');
    await addSecret(ids.b, 'Beta Login');

    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      const original = Logger.prototype[method];
      jest.spyOn(Logger.prototype, method).mockImplementation(function (this: Logger, ...args: unknown[]) {
        logged.push(args);
        return (original as (...a: unknown[]) => void).apply(this, args);
      } as never);
    }
  }, 240_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    storage.failUploads = false;
  });

  describe('manual system backup', () => {
    it('queues a job, links the run to it, and the worker uploads an archive that opens with the schedule password', async () => {
      const saved = await putSchedule();
      expect([saved.status, saved.body.message]).toEqual([200, undefined]);

      const started = await http().post('/api/admin/backups/run').set(as('admin'));
      expect(started.status).toBe(202);
      expect(started.body.data).toMatchObject({ scope: 'system', status: 'running', trigger: 'manual' });
      const runId = started.body.data.id as string;

      const run = await runStatus(runId, 'succeeded');
      // The handler records the run as succeeded BEFORE the queue settles the job
      // (the worker marks the job once the handler returns), so wait for the job too.
      const job = await waitFor('the job to succeed', async () => {
        const row = await prisma.job.findUniqueOrThrow({ where: { id: run.jobId! } });
        return row.status === 'succeeded' ? row : null;
      });
      expect(job).toMatchObject({ type: BACKUP_RUN_JOB_TYPE, status: 'succeeded', orgId: null, dedupKey: buildDedupKey(BACKUP_RUN_JOB_TYPE) });

      const bytes = storage.objects.get(run.storageKey!)!;
      expect(bytes).toBeDefined();
      const archive = await openArchive(bytes, SCHEDULE_PASSWORD);
      expect(archive.names).toEqual(expect.arrayContaining(['README.txt', 'index.json']));
      expect((await archive.read('index.json')).kind).toBe('system-backup');
      await archive.close();
      expect(bytes.includes(Buffer.from(SCHEDULE_PASSWORD))).toBe(false);

      const listed = await http().get('/api/admin/backups').set(as('admin'));
      expect(listed.body.data.items[0]).toMatchObject({ id: runId, status: 'succeeded', downloadable: true });
    });

    it('is HTTP 409 while a system backup is queued or running, and writes no run row', async () => {
      const before = await prisma.backupRun.count();
      const held = await holdSlot(BACKUP_RUN_JOB_TYPE);
      try {
        const res = await http().post('/api/admin/backups/run').set(as('admin'));
        expect(res.status).toBe(409);
        expect(await prisma.backupRun.count()).toBe(before);
      } finally {
        await prisma.job.delete({ where: { id: held.id } });
      }
      expect((await http().post('/api/admin/backups/run').set(as('admin'))).status).toBe(202);
      await waitFor('the queue to drain', async () => (await prisma.job.count({ where: { type: BACKUP_RUN_JOB_TYPE, status: { in: ['pending', 'running'] } } })) === 0);
    });

    it('keeps the newest N after successful runs (retention)', async () => {
      expect((await putSchedule({ keepCount: 2 })).status).toBe(200);
      await prisma.backupRun.deleteMany({});
      storage.objects.clear();

      const ids4: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await http().post('/api/admin/backups/run').set(as('admin'));
        expect(res.status).toBe(202);
        ids4.push(res.body.data.id);
        await runStatus(res.body.data.id, 'succeeded');
        // The handler applies retention after recording success; wait for the job to settle too.
        await waitFor('the job to settle', async () => (await prisma.job.count({ where: { type: BACKUP_RUN_JOB_TYPE, status: { in: ['pending', 'running'] } } })) === 0);
      }

      const rows = await prisma.backupRun.findMany({ orderBy: { startedAt: 'asc' } });
      expect(rows.map((r) => r.id)).toEqual(ids4);
      expect(rows.map((r) => r.deletedAt !== null)).toEqual([true, true, false, false]);
      expect(storage.objects.size).toBe(2);
      expect(storage.objects.has(rows[3].storageKey!)).toBe(true);
      expect(storage.objects.has(rows[0].storageKey!)).toBe(false);
    });

    it('keeps both archives when two runs share a start second (#130)', async () => {
      expect((await putSchedule({ keepCount: 1 })).status).toBe(200);
      await prisma.backupRun.deleteMany({});
      storage.objects.clear();

      const startedAt = new Date('2026-07-01T10:00:00.000Z');
      const older = randomUUID();
      const newer = randomUUID();
      const keyOlder = systemBackupStorageKey(startedAt, older);
      const keyNewer = systemBackupStorageKey(startedAt, newer);
      expect(keyOlder).not.toBe(keyNewer);
      for (const [id, key, at] of [
        [older, keyOlder, startedAt],
        [newer, keyNewer, new Date(startedAt.getTime() + 500)],
      ] as const) {
        storage.objects.set(key, Buffer.from(id));
        await prisma.backupRun.create({
          data: { id, scope: 'system', status: 'succeeded', trigger: 'manual', storageKey: key, startedAt: at },
        });
      }

      await app.get(BackupRunnerService).applyRetention(newer);

      expect(storage.objects.has(keyOlder)).toBe(false);
      expect(storage.objects.has(keyNewer)).toBe(true);
      const survivor = await prisma.backupRun.findUnique({ where: { id: newer } });
      expect(survivor?.deletedAt).toBeNull();
    });

    it('fails the run with a static message and fails the job when the upload fails', async () => {
      storage.failUploads = true;
      const res = await http().post('/api/admin/backups/run').set(as('admin'));
      expect(res.status).toBe(202);

      const run = await runStatus(res.body.data.id, 'failed');
      expect(run.error).toBe(BACKUP_FAILURE_MESSAGES.upload);
      expect(run.error).not.toContain('S3 exploded');
      const job = await waitFor('the job to fail', async () => {
        const j = await prisma.job.findUnique({ where: { id: run.jobId! } });
        return j?.status === 'failed' ? j : null;
      });
      expect(job.lastError).toBe(BACKUP_FAILURE_MESSAGES.upload);
    });
  });

  describe('the schedule tick is enqueue-only', () => {
    it('queues a job when due; the handler writes the run, uploads, and the slot moves forward', async () => {
      expect((await putSchedule({ keepCount: 7 })).status).toBe(200);
      await prisma.backupRun.deleteMany({});
      await prisma.backupSchedule.update({ where: { id: 'default' }, data: { nextRunAt: new Date(Date.now() - 60_000) } });

      await fireCron('BackupScheduleTask', 'handleTick');

      // The tick itself wrote no run row; the job exists straight away.
      const job = await prisma.job.findFirstOrThrow({ where: { type: BACKUP_RUN_JOB_TYPE }, orderBy: { createdAt: 'desc' } });
      expect(job.orgId).toBeNull();
      expect(job.payload).toEqual({ trigger: 'schedule' });

      const run = await waitFor('the scheduled run', async () => {
        const r = await prisma.backupRun.findFirst({ where: { jobId: job.id } });
        return r?.status === 'succeeded' ? r : null;
      });
      expect(run).toMatchObject({ trigger: 'schedule', scope: 'system', triggeredById: null });
      expect(storage.objects.has(run.storageKey!)).toBe(true);

      const schedule = await prisma.backupSchedule.findUniqueOrThrow({ where: { id: 'default' } });
      expect(schedule.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(schedule.lastRunAt).not.toBeNull();
    });

    it('does not queue a second job while one is active', async () => {
      await prisma.backupSchedule.update({ where: { id: 'default' }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
      const held = await holdSlot(BACKUP_RUN_JOB_TYPE);
      try {
        await fireCron('BackupScheduleTask', 'handleTick');
        expect(await prisma.job.count({ where: { type: BACKUP_RUN_JOB_TYPE, status: { in: ['pending', 'running'] } } })).toBe(1);
      } finally {
        await prisma.job.delete({ where: { id: held.id } });
      }
    });
  });

  describe('user backups (My backups)', () => {
    it('keeps the password out of jobs.payload once settled, the logs, the audit rows and the run rows', async () => {
      const enqueueSpy = jest.spyOn(jobs, 'enqueueWithin');
      logged.length = 0;

      const res = await http()
        .post('/api/backups/me')
        .set(as('a'))
        .send({ password: USER_PASSWORD, includeSecrets: true, includeAttachments: true });
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({ scope: 'user', status: 'running' });
      expect(JSON.stringify(res.body)).not.toContain(USER_PASSWORD);

      // At enqueue: ciphertext only.
      const queued = enqueueSpy.mock.calls.map((c) => c[1]).find((i) => i.type === USER_BACKUP_RUN_JOB_TYPE)!;
      expect(queued).toMatchObject({ subjectType: 'user', subjectId: ids.a, orgId: null });
      expect(JSON.stringify(queued)).not.toContain(USER_PASSWORD);
      expect((queued.payload as { passwordEncrypted: string }).passwordEncrypted).toEqual(expect.any(String));

      const run = await runStatus(res.body.data.id, 'succeeded');
      expect(run.storageKey).toEqual(expect.stringContaining(`user-backups/${ids.a}/`));
      const job = await waitFor('the job to settle', async () => {
        const j = await prisma.job.findUnique({ where: { id: run.jobId! } });
        return j?.status === 'succeeded' ? j : null;
      });
      expect(job).toMatchObject({ type: USER_BACKUP_RUN_JOB_TYPE, subjectType: 'user', subjectId: ids.a, orgId: null });

      // The archive opens with the user's password and holds only that user's secret.
      const archive = await openArchive(storage.objects.get(run.storageKey!)!, USER_PASSWORD);
      expect(JSON.stringify(await archive.read('secrets.json'))).toContain('Alpha Login');
      expect(JSON.stringify(await archive.read('secrets.json'))).not.toContain('Beta Login');
      await archive.close();

      // Settled: no ciphertext left on the job row.
      await waitFor('the payload scrub', async () => {
        const j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
        return !('passwordEncrypted' in ((j.payload as object) ?? {}));
      });

      const everywhere = JSON.stringify(
        {
          jobs: await prisma.job.findMany(),
          runs: await prisma.backupRun.findMany(),
          audit: await prisma.auditEvent.findMany(),
          logs: logged,
        },
        (_k, v) => (typeof v === 'bigint' ? String(v) : v),
      );
      expect(everywhere).not.toContain(USER_PASSWORD);
      expect(storage.objects.get(run.storageKey!)!.includes(Buffer.from(USER_PASSWORD))).toBe(false);
    });

    it('is HTTP 409 only for the user who already has an active backup', async () => {
      const held = await holdSlot(USER_BACKUP_RUN_JOB_TYPE, { type: 'user', id: ids.a });
      try {
        const blocked = await http().post('/api/backups/me').set(as('a')).send({ password: USER_PASSWORD });
        expect(blocked.status).toBe(409);

        const other = await http().post('/api/backups/me').set(as('b')).send({ password: USER_PASSWORD_B });
        expect(other.status).toBe(202);
        const run = await runStatus(other.body.data.id, 'succeeded');
        const archive = await openArchive(storage.objects.get(run.storageKey!)!, USER_PASSWORD_B);
        expect(JSON.stringify(await archive.read('secrets.json'))).toContain('Beta Login');
        await archive.close();
      } finally {
        await prisma.job.delete({ where: { id: held.id } });
      }
    });

    it("keeps each user's newest 10 saved backups", async () => {
      await prisma.backupRun.deleteMany({ where: { scope: 'user', ownerId: ids.b } });
      for (let i = 0; i < 11; i += 1) {
        const res = await http().post('/api/backups/me').set(as('b')).send({ password: USER_PASSWORD_B });
        expect(res.status).toBe(202);
        await runStatus(res.body.data.id, 'succeeded');
        await waitFor('the job to settle', async () => (await prisma.job.count({ where: { type: USER_BACKUP_RUN_JOB_TYPE, subjectId: ids.b, status: { in: ['pending', 'running'] } } })) === 0);
      }
      const rows = await prisma.backupRun.findMany({ where: { scope: 'user', ownerId: ids.b }, orderBy: { startedAt: 'asc' } });
      expect(rows).toHaveLength(11);
      expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(10);
      expect(rows[0].deletedAt).not.toBeNull();
    }, 180_000);
  });

  describe('a run whose job failed without recording it', () => {
    it('reads as failed in the list, not running forever', async () => {
      const job = await prisma.job.create({
        data: { type: BACKUP_RUN_JOB_TYPE, reason: 'backfill', status: 'failed', finishedAt: new Date(), lastError: 'lease expired' },
      });
      const run = await prisma.backupRun.create({
        data: { scope: 'system', status: 'running', trigger: 'schedule', storageKey: 'system-backups/stuck.zip', jobId: job.id },
      });

      const listed = await http().get('/api/admin/backups?pageSize=50').set(as('admin'));
      const row = listed.body.data.items.find((r: { id: string }) => r.id === run.id);
      expect(row).toMatchObject({ status: 'failed', downloadable: false });
      expect(row.error).toEqual(expect.any(String));

      // And it can be deleted (the 409 "still running" guard follows the derived status).
      expect((await http().delete(`/api/admin/backups/${run.id}`).set(as('admin'))).status).toBe(204);
    });
  });
});
