// =============================================================================
// Real-Postgres test: the platform export never carries a secret value (issue #91, E9.3, epic #64)
// =============================================================================
//
// Plants distinctive markers in a real deployment and proves none of them reaches ANY export the
// platform offers a user:
//
//   * a DECRYPTED-VALUE marker: the plaintext the secret was encrypted from (a password, a card
//     number, a note), and a marker in the secret's description and in an attachment's storage key;
//   * the CIPHERTEXT: the `encrypted_data`, `iv` and `auth_tag` stored in `secret_versions`.
//
// Two paths are checked, both against the real application role and the real Prisma datamodel:
//
//   1. every registered `user` source (`user-data`, `vault-secrets`) through EVERY writer it offers
//      (json, csv zip, xlsx), the zips decompressed;
//   2. the full pipeline: `POST /api/exports` with the in-process worker, the file the job streams into
//      the (fake) object store, read back byte for byte.
//
// And that the metadata IS there (the export is useful): names, type, version count, timestamps. The
// values are in Vault's password-protected zip (`POST /api/secrets/export`), which is not an export
// of this slice.
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
import { exportSourceRegistry, writersFor, type ExportContext } from '@marinoscar/platform-api/exports';
import { collectExportOutput, exportFileText } from '@marinoscar/platform-api/exports/testing';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';
import { Prisma } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { CryptoService } from '../../src/common/services/crypto.service';
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

/** The decrypted value, distinctive enough that a substring match cannot be a coincidence. */
const PLAINTEXT_MARKER = 'PLAINTEXT-Zk93-hunter2-4111111111111111';
const DESCRIPTION_MARKER = 'DESCRIPTION-MARKER-q81x';
const STORAGE_KEY_MARKER = 'STORAGEKEY-MARKER-m27d';
const SECRET_NAME = 'Alpha Server Login';
const TYPE_NAME = 'Alpha Custom Type';
const FOLDER_NAME = 'Alpha Folder';

class FakeStorage {
  readonly kind = 's3';
  readonly objects = new Map<string, Buffer>();

  getBucket() {
    return 'fake-bucket';
  }

  async upload(key: string, stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    this.objects.set(key, Buffer.concat(chunks));
    return { key, bucket: 'fake-bucket' };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async abortMultipartUpload() {
    return undefined;
  }
}

describeWithDb('the platform export carries no secret value (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  // The bypass client; its model delegates are typed loosely by the platform.
  let system: any;
  const storage = new FakeStorage();
  const savedEnv: Record<string, string | undefined> = {};
  let token = '';
  let userId = '';
  let cipher = { ciphertext: '', iv: '', authTag: '' };

  const http = () => request(app.getHttpServer());

  async function waitFor<T>(what: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
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
    system = app.get(PrismaSystemService).forSystem('export');
    const crypto = app.get(CryptoService);

    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({ data: { email: 'a-export@example.test', providerDisplayName: 'Person A' } });
    userId = user.id;
    await prisma.membership.create({ data: { userId, orgId: org.id, roleId: role.id, status: 'active' } });
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId,
        name: 'token',
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(0, 8),
        durationValue: 30,
        durationUnit: 'days',
        expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
    token = raw;

    const type = await prisma.secretType.create({
      data: { name: TYPE_NAME, fields: [{ name: 'password', label: 'Password', type: 'password' }], createdById: userId },
    });
    const secret = await prisma.secret.create({
      data: { name: SECRET_NAME, description: DESCRIPTION_MARKER, typeId: type.id, createdById: userId },
    });
    cipher = crypto.encrypt(JSON.stringify({ password: PLAINTEXT_MARKER }));
    await prisma.secretVersion.create({
      data: { secretId: secret.id, version: 1, encryptedData: cipher.ciphertext, iv: cipher.iv, authTag: cipher.authTag, createdById: userId, isCurrent: false },
    });
    const v2 = await prisma.secretVersion.create({
      data: { secretId: secret.id, version: 2, encryptedData: cipher.ciphertext, iv: cipher.iv, authTag: cipher.authTag, createdById: userId, isCurrent: true },
    });
    const object = await system.storageObject.create({
      data: {
        name: 'front.png',
        size: BigInt(4),
        mimeType: 'image/png',
        storageKey: `uploads/${org.id}/1717000000000/${STORAGE_KEY_MARKER}.png`,
        status: 'ready',
        uploadedById: userId,
        orgId: org.id,
      },
    });
    await system.secretAttachment.create({
      data: { secretId: secret.id, secretVersionId: v2.id, storageObjectId: object.id, role: 'card_front', label: 'Front of the card' },
    });
    await prisma.mediaFolder.create({ data: { name: FOLDER_NAME, userId } });
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

  /**
   * What must never appear in an export. The storage KEY of an attached file is not a secret and the platform's
   * `user-data` source lists the user's own file manifest (name, size, type, key) by design, so it is forbidden
   * only in the `vault-secrets` source, which reads no storage column at all.
   */
  const forbidden = (sourceId: string) => [
    PLAINTEXT_MARKER,
    DESCRIPTION_MARKER,
    cipher.ciphertext,
    cipher.iv,
    cipher.authTag,
    ...(sourceId === 'vault-secrets' ? [STORAGE_KEY_MARKER] : []),
  ];

  const context = (): ExportContext => ({
    exportId: 'export-1',
    scope: 'user',
    subjectId: userId,
    requestedById: userId,
    db: system as never,
    datamodel: Prisma.dmmf.datamodel as never,
    pageSize: 2,
    now: new Date(),
    timeZone: 'UTC',
  });

  it('offers the platform user-data source and Vault\'s secrets-metadata source', () => {
    const userSources = exportSourceRegistry.list().filter((source) => source.scope === 'user').map((source) => source.id);
    expect(userSources).toEqual(['user-data', 'vault-secrets']);
  });

  it.each(['user-data', 'vault-secrets'])('%s: no decrypted value, no ciphertext, no storage key, through every writer', async (sourceId) => {
    const source = exportSourceRegistry.get(sourceId)!;
    const writers = writersFor(source);
    expect(writers.map((writer) => writer.id)).toEqual(expect.arrayContaining(['json', 'csv', 'xlsx']));

    for (const writer of writers) {
      const { bytes } = await collectExportOutput(writer, source.collect(context(), {} as never), source.id);
      const text = exportFileText(bytes);
      for (const marker of forbidden(source.id)) {
        expect({ source: source.id, writer: writer.id, leaked: text.includes(marker) ? marker : null }).toEqual({
          source: source.id,
          writer: writer.id,
          leaked: null,
        });
      }
    }
  });

  it('the metadata is there: name, type, version count and attachment label', async () => {
    const source = exportSourceRegistry.get('vault-secrets')!;
    const { bytes } = await collectExportOutput(writersFor(source)[0], source.collect(context(), {} as never), source.id);
    const file = JSON.parse(bytes.toString('utf8')) as {
      datasets: Record<string, { rows: Record<string, unknown>[] }>;
    };
    const secrets = file.datasets['secrets'].rows;
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ name: SECRET_NAME, type: TYPE_NAME, versionCount: 2, currentVersion: 2, attachmentCount: 1 });
    expect(file.datasets['secret_attachments'].rows[0]).toMatchObject({ role: 'card_front', label: 'Front of the card', version: 2 });
  });

  it('the platform user-data export lists the media folder and the custom type, but no secret or version row', async () => {
    const source = exportSourceRegistry.get('user-data')!;
    const { bytes } = await collectExportOutput(writersFor(source)[0], source.collect(context(), {} as never), source.id);
    const text = bytes.toString('utf8');
    expect(text).toContain(FOLDER_NAME);
    expect(text).toContain(TYPE_NAME);
    expect(text).not.toContain(SECRET_NAME);
  });

  it.each([
    ['vault-secrets', 'json'],
    ['vault-secrets', 'csv'],
    ['user-data', 'xlsx'],
  ])('the stored file of a real %s/%s export job holds no value and no ciphertext', async (source, format) => {
    const started = await http().post('/api/exports').set({ Authorization: `Bearer ${token}` }).send({ source, format, request: {} });
    expect([started.status, started.body.message]).toEqual([202, undefined]);
    const id = started.body.data.id as string;

    const job = await waitFor(`export ${id} to settle`, async () => {
      const row = await prisma.job.findUnique({ where: { id } });
      return row && ['succeeded', 'failed'].includes(row.status) ? row : null;
    });
    expect([job.status, job.lastError]).toEqual(['succeeded', null]);

    const keys = [...storage.objects.keys()].filter((key) => key.startsWith(`exports/users/${userId}/${id}`));
    expect(keys).toHaveLength(1);
    const text = exportFileText(storage.objects.get(keys[0])!);
    expect(text.length).toBeGreaterThan(50);
    for (const marker of forbidden(source)) expect(text).not.toContain(marker);
  });
});
