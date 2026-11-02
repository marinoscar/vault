import request from 'supertest';
import { registerPlatformDocs } from '@marinoscar/platform-api/host';

import { APP_OPENAPI } from '../../src/openapi/document';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

/**
 * The platform host core as Vault mounts it (issue #76): the `{ data, meta }`
 * envelope, request ids, the host-owned admin routes with Vault's RBAC, and the
 * OpenAPI document / Scalar page generated from Vault's controllers.
 */
describe('Platform host core (Integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    // The same call main.ts makes, after setGlobalPrefix('api'). A route cannot
    // be added to an initialised Fastify instance, so a second app is used.
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  });

  describe('response envelope and request ids', () => {
    it('wraps a success body in { data, meta.timestamp }', async () => {
      const res = await request(context.app.getHttpServer()).get('/api/health/live').expect(200);

      expect(res.body).toEqual({
        data: { status: 'ok', timestamp: expect.any(String) },
        meta: { timestamp: expect.any(String) },
      });
    });

    it('answers an error in the standard error body', async () => {
      const res = await request(context.app.getHttpServer()).get('/api/does-not-exist').expect(404);

      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: expect.any(String), path: '/api/does-not-exist' });
      expect(res.body).not.toHaveProperty('stack');
    });

    it('echoes a supplied x-request-id and generates one otherwise', async () => {
      const supplied = await request(context.app.getHttpServer()).get('/api/health/live').set('x-request-id', 'req-123');
      expect(supplied.headers['x-request-id']).toBe('req-123');

      const generated = await request(context.app.getHttpServer()).get('/api/health/live');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('admin routes mounted by the host (Vault RBAC through the host decorators)', () => {
    it.each(['/api/admin/maintenance', '/api/admin/doctor', '/api/admin/about'])('%s answers 401 without a token', async (url) => {
      await request(context.app.getHttpServer()).get(url).expect(401);
    });

    it.each(['/api/admin/maintenance', '/api/admin/doctor', '/api/admin/about'])('%s answers 403 without system_settings:read', async (url) => {
      const viewer = await createMockViewerUser(context);
      await request(context.app.getHttpServer()).get(url).set(authHeader(viewer.accessToken)).expect(403);
    });

    it('GET /api/admin/maintenance returns the closed window by default', async () => {
      const admin = await createMockAdminUser(context);
      context.prismaMock.systemSettings.findUnique.mockResolvedValue(null);

      const res = await request(context.app.getHttpServer())
        .get('/api/admin/maintenance')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(res.body.data).toMatchObject({ enabled: false });
    });

    it('GET /api/admin/about reports the API version and a database fact', async () => {
      const admin = await createMockAdminUser(context);

      const res = await request(context.app.getHttpServer())
        .get('/api/admin/about')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(JSON.stringify(res.body.data)).toMatch(/version/i);
    });

    it('GET /api/admin/doctor runs and includes Vault\'s checks', async () => {
      const admin = await createMockAdminUser(context);

      const res = await request(context.app.getHttpServer())
        .get('/api/admin/doctor')
        .set(authHeader(admin.accessToken))
        .expect(200);

      const ids = JSON.stringify(res.body.data);
      expect(ids).toContain('vault.encryption_key');
      expect(ids).toContain('vault.backup_schedule');
      expect(ids).toContain('db.connection');
    });
  });

  describe('API reference (registerPlatformDocs)', () => {
    it('serves /api/openapi.json and the Scalar page, with Vault\'s routes', async () => {
      const { Test } = await import('@nestjs/testing');
      const { FastifyAdapter } = await import('@nestjs/platform-fastify');
      const { AppModule } = await import('../../src/app.module');
      const { PrismaService } = await import('../../src/prisma/prisma.service');
      const { prismaMock } = await import('../mocks/prisma.mock');

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prismaMock)
        .compile();
      const app = moduleRef.createNestApplication(new FastifyAdapter());
      app.setGlobalPrefix('api');
      expect(registerPlatformDocs(app, APP_OPENAPI)).toBe(true);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      try {
        const json = await request(app.getHttpServer()).get('/api/openapi.json').expect(200);
        expect(json.body.openapi).toMatch(/^3\./);
        expect(json.body.info.title).toBe('Vault API');
        expect(Object.keys(json.body.paths)).toEqual(
          expect.arrayContaining(['/api/health/live', '/api/health/ready', '/api/admin/doctor', '/api/secrets/export', '/api/admin/backups/export']),
        );

        const page = await request(app.getHttpServer()).get('/api/docs').expect(200);
        expect(page.headers['content-type']).toMatch(/text\/html/);
      } finally {
        await app.close();
      }
    });
  });
});
