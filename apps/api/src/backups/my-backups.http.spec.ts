import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MyBackupsController } from './my-backups.controller';
import { MyBackupsService } from './my-backups.service';

/**
 * RBAC of /api/backups/me over real HTTP, with the real permission guards
 * (only JWT validation is stubbed, as in backups.http.spec.ts).
 */
const ID = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const READ = 'secrets:read';

const asUser = (...permissions: string[]) => `Bearer perms:${permissions.join(',')}`;

describe('My backups routes (HTTP RBAC)', () => {
  let app: NestFastifyApplication;
  const service = {
    getConfig: jest.fn(),
    runNow: jest.fn(),
    listRuns: jest.fn(),
    getDownload: jest.fn(),
    deleteRun: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MyBackupsController],
      providers: [
        { provide: MyBackupsService, useValue: service },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const request = ctx.switchToHttp().getRequest();
          const header: string | undefined = request.headers.authorization;
          if (!header?.startsWith('Bearer perms:')) {
            throw new UnauthorizedException();
          }
          const perms = header.slice('Bearer perms:'.length).split(',').filter(Boolean);
          request.user = {
            id: 'user-1',
            email: 'person.a@example.test',
            isActive: true,
            userRoles: [
              { role: { name: 'Tester', rolePermissions: perms.map((name) => ({ permission: { name } })) } },
            ],
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset();
    service.getConfig.mockReturnValue({ storageConfigured: true, keepCount: 10 });
    service.runNow.mockResolvedValue({ id: ID, status: 'running' });
    service.listRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    service.getDownload.mockResolvedValue({ url: 'https://s.example.test/x', expiresAt: 'x', fileName: 'f.zip' });
    service.deleteRun.mockResolvedValue(undefined);
  });

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, authorization?: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/backups/me${url}`,
      headers: authorization ? { authorization } : {},
      ...(payload ? { payload: payload as never } : {}),
    });

  const routes = [
    { name: 'GET config', method: 'GET' as const, url: '/config', okStatus: 200, handler: 'getConfig' as const },
    { name: 'GET list', method: 'GET' as const, url: '', okStatus: 200, handler: 'listRuns' as const },
    {
      name: 'POST run',
      method: 'POST' as const,
      url: '',
      payload: { password: 'secret1' },
      okStatus: 202,
      handler: 'runNow' as const,
    },
    { name: 'GET download', method: 'GET' as const, url: `/${ID}/download`, okStatus: 200, handler: 'getDownload' as const },
    { name: 'DELETE', method: 'DELETE' as const, url: `/${ID}`, okStatus: 204, handler: 'deleteRun' as const },
  ];

  describe.each(routes)('$name', (route) => {
    it('401 without a token', async () => {
      expect((await call(route.method, route.url, undefined, route.payload)).statusCode).toBe(401);
      expect(service[route.handler]).not.toHaveBeenCalled();
    });

    it('403 without secrets:read (system_settings:write does not grant it)', async () => {
      const response = await call(route.method, route.url, asUser('system_settings:write'), route.payload);
      expect(response.statusCode).toBe(403);
      expect(service[route.handler]).not.toHaveBeenCalled();
    });

    it('succeeds with secrets:read', async () => {
      const response = await call(route.method, route.url, asUser(READ), route.payload);
      expect(response.statusCode).toBe(route.okStatus);
      expect(service[route.handler]).toHaveBeenCalledTimes(1);
    });
  });

  it('scopes every route to the authenticated user', async () => {
    await call('GET', '', asUser(READ));
    expect(service.listRuns).toHaveBeenCalledWith('user-1', { page: 1, pageSize: 20 });
    await call('GET', `/${ID}/download`, asUser(READ));
    expect(service.getDownload).toHaveBeenCalledWith(ID, 'user-1');
    await call('DELETE', `/${ID}`, asUser(READ));
    expect(service.deleteRun).toHaveBeenCalledWith(ID, 'user-1');
    await call('POST', '', asUser(READ), { password: 'secret1', includeMedia: true });
    expect(service.runNow).toHaveBeenCalledWith(
      { id: 'user-1', email: 'person.a@example.test' },
      { password: 'secret1', includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: true },
    );
  });

  it('config returns { storageConfigured, keepCount } wrapped by nothing here', async () => {
    const response = await call('GET', '/config', asUser(READ));
    expect(JSON.parse(response.body)).toEqual({ storageConfigured: true, keepCount: 10 });
  });

  it.each([
    ['a short password', { password: 'abc' }],
    ['includeSystem', { password: 'secret1', includeSystem: true }],
    ['nothing selected', { password: 'secret1', includeSecrets: false }],
  ])('POST answers 400 before the service for %s', async (_label, body) => {
    const response = await call('POST', '', asUser(READ), body);
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('"abc"');
    expect(service.runNow).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id with 400', async () => {
    expect((await call('DELETE', '/not-a-uuid', asUser(READ))).statusCode).toBe(400);
    expect(service.deleteRun).not.toHaveBeenCalled();
  });
});
