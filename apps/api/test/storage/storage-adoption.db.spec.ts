// =============================================================================
// Real-Postgres test: the platform storage slice serves what Vault stored before
// it (issue #84, E6.1, epic #61)
// =============================================================================
//
// Boots the full app against a migrated, seeded deployment (the ordinary application
// role, as in production) with a fake in-memory object store, and proves:
//
//   * an object created BEFORE adoption (a `storage_objects` row of the default
//     organization with the legacy key `uploads/<timestamp>/<uuid>.pdf`, no org segment)
//     is listed, read and DOWNLOADED through the platform's objects API, by its stored key;
//   * another user does not see it;
//   * a new upload gets the org-aware key `uploads/<orgId>/...` and the default org id;
//   * deleting a legacy object deletes the blob under its stored (legacy) key;
//   * attachment refcount deletion still holds against the real database under RLS: a blob
//     shared by two versions survives the first unlink and is deleted with the last;
//   * the boot-time import of the legacy environment makes the runtime configuration resolve
//     (`StorageConfigService`), and a second run is a no-op.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { runInOrg } from '@marinoscar/platform-api/core';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { STORAGE_PROVIDER, StorageConfigService } from '@marinoscar/platform-api/storage';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { StorageEnvImportService } from '../../src/platform/storage/storage-env-import.service';
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

/** An in-memory object store: records the keys the API asks it for. */
class FakeStorage {
  readonly kind = 's3';
  readonly signed: string[] = [];
  readonly deleted: string[] = [];
  readonly initiated: string[] = [];

  getBucket() {
    return 'fake-bucket';
  }
  async getSignedDownloadUrl(key: string) {
    this.signed.push(key);
    return `https://objects.example.test/${key}?signature=fake`;
  }
  async getSignedUploadUrl(key: string, _uploadId: string, partNumber: number) {
    return `https://objects.example.test/${key}?part=${partNumber}`;
  }
  async initMultipartUpload(key: string) {
    this.initiated.push(key);
    return { uploadId: 'upload-1', key };
  }
  async abortMultipartUpload() {
    return undefined;
  }
  async delete(key: string) {
    this.deleted.push(key);
  }
}

describeWithDb('the platform storage slice over pre-adoption data (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  const storage = new FakeStorage();
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = { a: '', b: '' };
  const ids = { a: '', b: '' };
  let defaultOrg: string;

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(who: keyof typeof tokens) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({ data: { email: `${who}-storage@example.test`, providerDisplayName: `Person ${who.toUpperCase()}` } });
    await prisma.membership.create({ data: { userId: user.id, orgId: defaultOrg, roleId: role.id, status: 'active' } });
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

  /** A row exactly as Vault's own ObjectsService wrote it before adoption. */
  async function insertLegacyObject(uploadedById: string, name: string) {
    const id = randomUUID();
    const storageKey = `uploads/1717000000000/${id}.pdf`;
    await runInOrg(prisma, { orgId: defaultOrg }, (tx) =>
      tx.storageObject.create({
        data: {
          id,
          orgId: defaultOrg,
          name,
          size: 2048n,
          mimeType: 'application/pdf',
          storageKey,
          storageProvider: 's3',
          bucket: 'legacy-bucket',
          status: 'ready',
          uploadedById,
        },
      }),
    );
    return { id, storageKey };
  }

  const rowOf = (id: string) =>
    runInOrg(prisma, { orgId: defaultOrg }, (tx) => tx.storageObject.findUnique({ where: { id } }));

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
    defaultOrg = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;

    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'JOBS_WORKER_MODE', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'STORAGE_PROVIDER']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env, { JOBS_WORKER_MODE: 'off' });
    for (const key of ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'STORAGE_PROVIDER']) delete process.env[key];
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

    await createUser('a');
    await createUser('b');
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

  describe('an object created before adoption', () => {
    let legacy: { id: string; storageKey: string };

    beforeAll(async () => {
      legacy = await insertLegacyObject(ids.a, 'passport-scan.pdf');
    });

    it('is listed for its uploader and read through the platform API', async () => {
      const list = await http().get('/api/storage/objects').set(as('a'));
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).toContain(legacy.id);

      const one = await http().get(`/api/storage/objects/${legacy.id}`).set(as('a'));
      expect(one.status).toBe(200);
      expect(one.body.data).toMatchObject({ id: legacy.id, name: 'passport-scan.pdf', status: 'ready', mimeType: 'application/pdf' });
    });

    it('downloads by its STORED (legacy) key, not a rebuilt one', async () => {
      const response = await http().get(`/api/storage/objects/${legacy.id}/download`).set(as('a'));
      expect(response.status).toBe(200);
      expect(response.body.data.url).toBe(`https://objects.example.test/${legacy.storageKey}?signature=fake`);
      expect(storage.signed).toContain(legacy.storageKey);
    });

    it('is invisible to another user', async () => {
      const response = await http().get(`/api/storage/objects/${legacy.id}/download`).set(as('b'));
      expect([403, 404]).toContain(response.status);
      const list = await http().get('/api/storage/objects').set(as('b'));
      expect(JSON.stringify(list.body)).not.toContain(legacy.id);
    });

    it('deletes the blob under its stored key and removes the row', async () => {
      const doomed = await insertLegacyObject(ids.a, 'old-note.pdf');
      const response = await http().delete(`/api/storage/objects/${doomed.id}`).set(as('a'));
      expect(response.status).toBe(204);
      expect(storage.deleted).toContain(doomed.storageKey);
      expect(await rowOf(doomed.id)).toBeNull();
    });
  });

  it('gives a NEW upload the org-aware key and the default organization', async () => {
    const response = await http()
      .post('/api/storage/objects/upload/init')
      .set(as('a'))
      .send({ name: 'new-scan.pdf', size: 12 * 1024 * 1024, mimeType: 'application/pdf' });
    expect(response.status).toBe(201);

    const row = await rowOf(response.body.data.objectId);
    expect(row?.orgId).toBe(defaultOrg);
    expect(row?.storageKey).toMatch(new RegExp(`^uploads/${defaultOrg}/\\d+/[0-9a-f-]{36}\\.pdf$`));
    expect(storage.initiated).toContain(row?.storageKey);
  });

  describe('attachment refcount deletion (RLS, real database)', () => {
    it('keeps a blob shared by two versions until its last reference is removed', async () => {
      const shared = await insertLegacyObject(ids.a, 'shared-card-front.pdf');
      const type = await prisma.secretType.create({
        data: { name: `Attachable ${randomUUID()}`, fields: [], allowAttachments: true, createdById: ids.a },
      });
      const secret = await prisma.secret.create({ data: { name: 'Doc', typeId: type.id, createdById: ids.a } });
      const v1 = await prisma.secretVersion.create({
        data: { secretId: secret.id, version: 1, encryptedData: 'x', iv: 'y', authTag: 'z', isCurrent: false },
      });
      const v2 = await prisma.secretVersion.create({
        data: { secretId: secret.id, version: 2, encryptedData: 'x', iv: 'y', authTag: 'z', isCurrent: true },
      });
      const first = await prisma.secretAttachment.create({
        data: { secretId: secret.id, secretVersionId: v1.id, storageObjectId: shared.id, label: 'doc' },
      });
      const second = await prisma.secretAttachment.create({
        data: { secretId: secret.id, secretVersionId: v2.id, storageObjectId: shared.id, label: 'doc' },
      });

      const keep = await http().delete(`/api/secrets/${secret.id}/attachments/${first.id}`).set(as('a'));
      expect(keep.status).toBe(204);
      expect(await rowOf(shared.id)).not.toBeNull();
      expect(storage.deleted).not.toContain(shared.storageKey);

      const last = await http().delete(`/api/secrets/${secret.id}/attachments/${second.id}`).set(as('a'));
      expect(last.status).toBe(204);
      expect(await rowOf(shared.id)).toBeNull();
      expect(storage.deleted).toContain(shared.storageKey);
    });
  });

  describe('runtime configuration', () => {
    it('answers the storage status and the admin configuration routes', async () => {
      const status = await http().get('/api/storage/status').set(as('a'));
      expect(status.status).toBe(200);
      // A contributor may not read the admin configuration.
      const denied = await http().get('/api/admin/storage-config').set(as('a'));
      expect(denied.status).toBe(403);
    });

    it('imports the legacy environment once at boot, then resolves it as the runtime configuration', async () => {
      const config = app.get(StorageConfigService);
      config.invalidateCache();
      expect((await config.resolve({ fresh: true })).configured).toBe(false);

      Object.assign(process.env, {
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'vault-prod-bucket',
        S3_REGION: 'eu-west-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYexamplekey',
      });
      const service = app.get(StorageEnvImportService);
      await service.onApplicationBootstrap();

      const resolved = await config.resolve({ fresh: true });
      expect(resolved.configured).toBe(true);
      expect(await config.activeProvider({ fresh: true })).toBe('s3');
      expect(await prisma.auditEvent.count({ where: { action: 'storage.config.imported' } })).toBe(1);

      // A second boot is a no-op: nothing more is written.
      await service.onApplicationBootstrap();
      expect(await prisma.auditEvent.count({ where: { action: 'storage.config.imported' } })).toBe(1);
    });
  });
});
