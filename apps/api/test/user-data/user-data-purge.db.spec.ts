// =============================================================================
// Real-Postgres test: the Danger Zone and the factory reset over Vault's data
// (issue #91, E9.3, epic #64)
// =============================================================================
//
// Boots the full app against a migrated, seeded deployment (the ordinary application role, as in
// production) with the in-process worker ON and a fake in-memory object store, and proves that the
// platform's purge removes EVERY row a user owns and EVERY object behind it:
//
//   * `backups` scope: only the caller's saved backups go (rows AND archive bytes); secrets, files
//     and everyone else's backups stay;
//   * `everything` scope: the caller's secrets with their versions and attachment records, media folders
//     and folder links, the files they uploaded (rows and bytes, attachments' files included), their
//     backups (rows and bytes, a soft-deleted run too) and their unused custom secret types go; a custom
//     type another user's secret still uses stays, as do system types, the system backup, the other
//     user's rows and objects, and the user row itself;
//   * the factory reset: every user's data, the actor's included, every logical backup (system ones too)
//     with its archive, every storage object, every custom secret type; the system types, the backup
//     schedule and the actor stay.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
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

/** An in-memory object store: just what the purge, the backup runs and the objects touch. */
class FakeStorage {
  readonly objects = new Map<string, Buffer>();

  getBucket() {
    return 'fake-bucket';
  }

  async upload(key: string, stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    this.objects.set(key, Buffer.concat(chunks));
    return { key };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async abortMultipartUpload() {
    return undefined;
  }
}

describeWithDb('user data deletion and factory reset over Vault data (real Postgres, worker on)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  // The bypass client; its model delegates are typed loosely by the platform.
  let system: any;
  let app: NestFastifyApplication;
  let orgId: string;
  const storage = new FakeStorage();
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { admin: '', a: '', b: '' };
  const ids = { admin: '', a: '', b: '' };
  type Who = keyof typeof tokens;
  /** Everything seeded for one user, so the assertions name what must be gone. */
  const seeded: Record<'a' | 'b', { secrets: string[]; objects: string[]; keys: string[]; folders: string[]; runs: string[]; archiveKeys: string[] }> = {
    a: { secrets: [], objects: [], keys: [], folders: [], runs: [], archiveKeys: [] },
    b: { secrets: [], objects: [], keys: [], folders: [], runs: [], archiveKeys: [] },
  };
  let systemRunId = '';
  let systemArchiveKey = '';
  let systemTypeId = '';
  let typeUnusedId = '';
  let typeUsedByBId = '';

  const http = () => request(app.getHttpServer());
  const as = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(who: Who, orgRole: 'org_admin' | 'contributor', systemAdmin: boolean) {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    orgId = org.id;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: orgRole } });
    const user = await prisma.user.create({
      data: { email: `${who}-purge@example.test`, providerDisplayName: `Person ${who.toUpperCase()}` },
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

  /** A stored file: the row (bypass client, `storage_objects` forces RLS) and its bytes. */
  async function addObject(ownerId: string, label: string) {
    const key = `uploads/${orgId}/1717000000000/${label}.bin`;
    const object = await system.storageObject.create({
      data: {
        name: `${label}.bin`,
        size: BigInt(4),
        mimeType: 'application/octet-stream',
        storageKey: key,
        status: 'ready',
        uploadedById: ownerId,
        orgId,
      },
    });
    storage.objects.set(key, Buffer.from('data'));
    return { id: object.id, key, orgId };
  }

  async function addSecretWithAttachment(who: 'a' | 'b', name: string, typeId: string) {
    const secret = await prisma.secret.create({ data: { name, typeId, createdById: ids[who] } });
    const v1 = await prisma.secretVersion.create({
      data: { secretId: secret.id, version: 1, encryptedData: 'ct1', iv: 'iv1', authTag: 'tag1', createdById: ids[who], isCurrent: false },
    });
    const v2 = await prisma.secretVersion.create({
      data: { secretId: secret.id, version: 2, encryptedData: 'ct2', iv: 'iv2', authTag: 'tag2', createdById: ids[who], isCurrent: true },
    });
    const object = await addObject(ids[who], `${who}-${name}`);
    await system.secretAttachment.create({
      data: { secretId: secret.id, secretVersionId: v2.id, storageObjectId: object.id, orgId: object.orgId, role: 'card_front' },
    });
    void v1;
    seeded[who].secrets.push(secret.id);
    seeded[who].objects.push(object.id);
    seeded[who].keys.push(object.key);
    return secret.id;
  }

  async function addMediaFolder(who: 'a' | 'b', name: string) {
    const folder = await prisma.mediaFolder.create({ data: { name, userId: ids[who] } });
    const object = await addObject(ids[who], `${who}-media-${name}`);
    await system.mediaFolderFile.create({ data: { objectId: object.id, orgId, mediaFolderId: folder.id } });
    seeded[who].folders.push(folder.id);
    seeded[who].objects.push(object.id);
    seeded[who].keys.push(object.key);
  }

  async function addBackupRun(who: 'a' | 'b', deleted = false) {
    const key = `user-backups/${ids[who]}/vault-backup-${seeded[who].runs.length}.zip`;
    const run = await prisma.backupRun.create({
      data: {
        status: 'succeeded',
        trigger: 'manual',
        scope: 'user',
        ownerId: ids[who],
        triggeredById: ids[who],
        storageKey: key,
        sizeBytes: BigInt(3),
        finishedAt: new Date(),
        ...(deleted ? { deletedAt: new Date() } : {}),
      },
    });
    if (!deleted) storage.objects.set(key, Buffer.from('zip'));
    seeded[who].runs.push(run.id);
    seeded[who].archiveKeys.push(key);
  }

  async function waitFor<T>(what: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Starts a destructive job over HTTP and waits for the QUEUE to settle it (the credential may be gone by then). */
  async function startAndSettle(path: string, who: Who, body: Record<string, unknown>) {
    const started = await http().post(path).set(as(who)).send(body);
    expect([started.status, started.body.message]).toEqual([202, undefined]);
    const jobId = started.body.data.jobId as string;
    return waitFor(`job ${jobId} to settle`, async () => {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      return job && ['succeeded', 'failed'].includes(job.status) ? job : null;
    });
  }

  const exists = async (model: 'secret' | 'secretVersion' | 'secretAttachment' | 'mediaFolder' | 'mediaFolderFile' | 'backupRun' | 'storageObject' | 'secretType', where: object) =>
    ((await (system as any)[model].count({ where })) as number) > 0;

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
    system = app.get(PrismaSystemService).forSystem('purge');

    await createUser('admin', 'org_admin', true);
    await createUser('a', 'contributor', false);
    await createUser('b', 'contributor', false);

    const systemType = await prisma.secretType.create({
      data: { name: 'System Login', fields: [{ name: 'user', label: 'User', type: 'string' }], isSystem: true },
    });
    systemTypeId = systemType.id;
    // A's custom types: one nobody uses, one B's secret uses.
    typeUnusedId = (
      await prisma.secretType.create({ data: { name: 'A unused type', fields: [], createdById: ids.a } })
    ).id;
    typeUsedByBId = (
      await prisma.secretType.create({ data: { name: 'A shared type', fields: [], createdById: ids.a } })
    ).id;

    await addSecretWithAttachment('a', 'Alpha Login', systemTypeId);
    await addSecretWithAttachment('a', 'Alpha Card', systemTypeId);
    await addSecretWithAttachment('b', 'Beta Login', typeUsedByBId);
    await addMediaFolder('a', 'Alpha Folder');
    await addMediaFolder('b', 'Beta Folder');
    await addBackupRun('a');
    await addBackupRun('a', true);
    await addBackupRun('b');

    systemArchiveKey = 'system-backups/vault-backup-system.zip';
    storage.objects.set(systemArchiveKey, Buffer.from('zip'));
    systemRunId = (
      await prisma.backupRun.create({
        data: { status: 'succeeded', trigger: 'schedule', scope: 'system', storageKey: systemArchiveKey, finishedAt: new Date() },
      })
    ).id;
    await prisma.backupSchedule.create({ data: { id: 'default', enabled: true } });
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lists the Vault categories and the backups scope on the Danger Zone summary', async () => {
    const res = await http().get('/api/user-data/summary').set(as('a'));
    expect(res.status).toBe(200);
    const categories = Object.fromEntries(res.body.data.categories.map((c: { id: string; count: number }) => [c.id, c.count]));
    expect(categories).toMatchObject({ secrets: 2, secretTypes: 2, media: 1, backups: 2 });
    expect(res.body.data.scopes.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining(['backups', 'content', 'everything']),
    );
    expect(res.body.data.kept.join(' ')).toContain('scheduled-backup configuration');
  });

  it('the `backups` scope deletes only the caller\'s saved backups: rows and archive bytes', async () => {
    const wrong = await http().post('/api/user-data/deletions').set(as('b')).send({ scope: 'backups', confirmation: 'nope' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(await exists('backupRun', { ownerId: ids.b })).toBe(true);

    const job = await startAndSettle('/api/user-data/deletions', 'b', { scope: 'backups', confirmation: 'DELETE MY BACKUPS' });
    expect(job.status).toBe('succeeded');
    await waitFor('the delegate to delete the backups', async () => !(await exists('backupRun', { ownerId: ids.b })));

    for (const key of seeded.b.archiveKeys) expect(storage.objects.has(key)).toBe(false);
    // Nothing else of B's, and nothing of A's, moved.
    expect(await exists('secret', { createdById: ids.b })).toBe(true);
    expect(await exists('storageObject', { uploadedById: ids.b })).toBe(true);
    expect(await exists('mediaFolder', { userId: ids.b })).toBe(true);
    expect(await exists('backupRun', { ownerId: ids.a })).toBe(true);
    expect(storage.objects.has(seeded.a.archiveKeys[0])).toBe(true);
  });

  it('`everything` removes every row the user owns and every object behind it, and nothing of anybody else', async () => {
    const job = await startAndSettle('/api/user-data/deletions', 'a', { scope: 'everything', confirmation: 'DELETE MY DATA' });
    expect(job.status).toBe('succeeded');
    await waitFor('the delegate to delete the backups and types', async () => {
      const left = (await exists('backupRun', { ownerId: ids.a })) || (await exists('secretType', { id: typeUnusedId }));
      return !left;
    });

    // Secrets with their versions and attachment records (cascade), media folders and links.
    expect(await exists('secret', { createdById: ids.a })).toBe(false);
    for (const secretId of seeded.a.secrets) {
      expect(await exists('secretVersion', { secretId })).toBe(false);
      expect(await exists('secretAttachment', { secretId })).toBe(false);
    }
    expect(await exists('mediaFolder', { userId: ids.a })).toBe(false);
    expect(await exists('mediaFolderFile', { mediaFolderId: { in: seeded.a.folders } })).toBe(false);

    // Every object A uploaded: the row AND the bytes (attachment files and media files alike).
    expect(await exists('storageObject', { uploadedById: ids.a })).toBe(false);
    for (const objectId of seeded.a.objects) expect(await exists('storageObject', { id: objectId })).toBe(false);
    for (const key of seeded.a.keys) expect(storage.objects.has(key)).toBe(false);
    expect(job.payload).toMatchObject({ result: { storageObjectsFailed: 0 } });

    // Backups: rows (the soft-deleted one too) and archive bytes.
    for (const key of seeded.a.archiveKeys) expect(storage.objects.has(key)).toBe(false);

    // Custom types: the unused one goes, the one B's secret uses stays, system types are never touched.
    expect(await exists('secretType', { id: typeUnusedId })).toBe(false);
    expect(await exists('secretType', { id: typeUsedByBId })).toBe(true);
    expect(await exists('secretType', { id: systemTypeId })).toBe(true);

    // The account survives (the data reset is not account deletion), B and the system are untouched.
    expect(await prisma.user.count({ where: { id: ids.a } })).toBe(1);
    expect(await exists('secret', { createdById: ids.b })).toBe(true);
    expect(await exists('storageObject', { uploadedById: ids.b })).toBe(true);
    for (const key of seeded.b.keys) expect(storage.objects.has(key)).toBe(true);
    expect(await exists('backupRun', { id: systemRunId })).toBe(true);
    expect(storage.objects.has(systemArchiveKey)).toBe(true);
  });

  it('the factory reset deletes every user\'s data, every logical backup with its archive and every custom type; the system types, the schedule and the actor stay', async () => {
    const summary = await http().get('/api/admin/factory-reset/summary').set(as('admin'));
    expect(summary.status).toBe(200);
    expect(summary.body.data.deleted.join(' ')).toContain('logical');
    expect(summary.body.data.kept.join(' ')).toContain('scheduled-backup configuration');

    const job = await startAndSettle('/api/admin/factory-reset', 'admin', { confirmation: 'FACTORY RESET' });
    expect([job.status, job.lastError]).toEqual(['succeeded', null]);

    expect(await exists('secret', {})).toBe(false);
    expect(await exists('secretVersion', {})).toBe(false);
    expect(await exists('secretAttachment', {})).toBe(false);
    expect(await exists('mediaFolder', {})).toBe(false);
    expect(await exists('mediaFolderFile', {})).toBe(false);
    expect(await exists('backupRun', {})).toBe(false);
    expect(await exists('storageObject', {})).toBe(false);
    expect(storage.objects.size).toBe(0);

    expect(await exists('secretType', { isSystem: false })).toBe(false);
    expect(await exists('secretType', { id: systemTypeId })).toBe(true);
    expect(await prisma.backupSchedule.count({ where: { id: 'default' } })).toBe(1);

    expect(await prisma.user.count({ where: { id: ids.admin } })).toBe(1);
    expect(await prisma.user.count({ where: { id: { in: [ids.a, ids.b] } } })).toBe(0);
  });
});
