import { Readable } from 'stream';

import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { BackupsService } from '@marinoscar/vault-api/backups';
import { PrismaService } from '../../src/prisma/prisma.service';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

/**
 * POST /api/admin/backups/export through the FULL app, so the platform `{ data }`
 * envelope is in the pipeline: the raw zip must come out untouched (issue #76).
 */
describe('POST /api/admin/backups/export (raw zip through the platform envelope)', () => {
  let app: NestFastifyApplication;
  let moduleRef: TestingModule;
  const backups = { exportNow: jest.fn() };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(BackupsService)
      .useValue(backups)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    backups.exportNow.mockReset();
    backups.exportNow.mockImplementation(async () => ({
      fileName: 'vault-backup-2026-07-01_000000.zip',
      userCount: 3,
      secretCount: 4,
      attachmentCount: 5,
      mediaFileCount: 6,
      stream: Readable.from([ZIP_MAGIC, Buffer.from('rest-of-archive')]),
    }));
  });

  it('streams the zip with the export headers and no JSON wrapper', async () => {
    const admin = await createMockAdminUser({ app, module: moduleRef, prismaMock, isMocked: true } as never);

    const res = await request(app.getHttpServer())
      .post('/api/admin/backups/export')
      .set(authHeader(admin.accessToken))
      .send({ password: 'secret1' })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^application\/zip/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="vault-backup-2026-07-01_000000.zip"');
    expect(res.headers['x-vault-export-users']).toBe('3');
    expect(res.headers['x-vault-export-secrets']).toBe('4');
    expect(res.headers['x-vault-export-attachments']).toBe('5');
    expect(res.headers['x-vault-export-media-files']).toBe('6');
    expect(res.headers['cache-control']).toBe('no-store');

    const body = res.body as Buffer;
    expect(body.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
    expect(body.toString('utf8')).not.toContain('"data"');
    expect(body.toString('utf8')).toContain('rest-of-archive');
  });

  it('still answers a validation error in the standard error body', async () => {
    const admin = await createMockAdminUser({ app, module: moduleRef, prismaMock, isMocked: true } as never);

    const res = await request(app.getHttpServer())
      .post('/api/admin/backups/export')
      .set(authHeader(admin.accessToken))
      .send({})
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', path: '/api/admin/backups/export' });
    expect(backups.exportNow).not.toHaveBeenCalled();
  });
});
