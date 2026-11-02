import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

/**
 * RBAC of the backups routes over real HTTP.
 *
 * Only the JWT guard is stubbed (no header -> 401, otherwise the permissions
 * named in the header are attached to the user the way the real strategy
 * does). RolesGuard and PermissionsGuard are the REAL guards, so a route
 * decorated with the wrong permission fails here.
 */
const ID = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const READ = 'system_settings:read';
const WRITE = 'system_settings:write';

const asUser = (...permissions: string[]) => `Bearer perms:${permissions.join(',')}`;

function fakeAuthenticatedUser(permissions: string[]) {
  return {
    id: 'admin-1',
    email: 'admin@example.test',
    isActive: true,
    userRoles: [
      {
        role: {
          name: 'Tester',
          rolePermissions: permissions.map((name) => ({ permission: { name } })),
        },
      },
    ],
  };
}

const validBody = {
  enabled: false,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'UTC',
  keepCount: 7,
  includeAttachments: true,
  includeVersions: false,
};

describe('Backups routes (HTTP RBAC)', () => {
  let app: NestFastifyApplication;
  const service = {
    getSchedule: jest.fn(),
    updateSchedule: jest.fn(),
    runNow: jest.fn(),
    listRuns: jest.fn(),
    getDownload: jest.fn(),
    deleteRun: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BackupsController],
      providers: [
        { provide: BackupsService, useValue: service },
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
          request.user = fakeAuthenticatedUser(perms);
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
    service.getSchedule.mockResolvedValue({ enabled: false });
    service.updateSchedule.mockResolvedValue({ enabled: false });
    service.runNow.mockResolvedValue({ id: ID, status: 'running' });
    service.listRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    service.getDownload.mockResolvedValue({ url: 'https://s.example.test/x', expiresAt: 'x', fileName: 'f.zip' });
    service.deleteRun.mockResolvedValue(undefined);
  });

  const call = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    authorization?: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url: `/api/admin/backups${url}`,
      headers: authorization ? { authorization } : {},
      ...(payload ? { payload: payload as never } : {}),
    });

  type Route = {
    name: string;
    method: 'GET' | 'PUT' | 'POST' | 'DELETE';
    url: string;
    permission: string;
    payload?: Record<string, unknown>;
    okStatus: number;
    handler: keyof typeof service;
  };

  const routes: Route[] = [
    { name: 'GET schedule', method: 'GET', url: '/schedule', permission: READ, okStatus: 200, handler: 'getSchedule' },
    { name: 'GET list', method: 'GET', url: '', permission: READ, okStatus: 200, handler: 'listRuns' },
    {
      name: 'PUT schedule',
      method: 'PUT',
      url: '/schedule',
      permission: WRITE,
      payload: validBody,
      okStatus: 200,
      handler: 'updateSchedule',
    },
    { name: 'POST run', method: 'POST', url: '/run', permission: WRITE, okStatus: 202, handler: 'runNow' },
    {
      name: 'GET download',
      method: 'GET',
      url: `/${ID}/download`,
      permission: WRITE,
      okStatus: 200,
      handler: 'getDownload',
    },
    { name: 'DELETE run', method: 'DELETE', url: `/${ID}`, permission: WRITE, okStatus: 204, handler: 'deleteRun' },
  ];

  describe.each(routes)('$name', (route) => {
    it('returns 401 without a token and never reaches the service', async () => {
      const response = await call(route.method, route.url, undefined, route.payload);
      expect(response.statusCode).toBe(401);
      expect(service[route.handler]).not.toHaveBeenCalled();
    });

    it('returns 403 for a user with no relevant permission', async () => {
      const response = await call(route.method, route.url, asUser('users:read'), route.payload);
      expect(response.statusCode).toBe(403);
      expect(service[route.handler]).not.toHaveBeenCalled();
    });

    it(`succeeds with ${route.permission}`, async () => {
      const response = await call(route.method, route.url, asUser(route.permission), route.payload);
      expect(response.statusCode).toBe(route.okStatus);
      expect(service[route.handler]).toHaveBeenCalledTimes(1);
    });
  });

  describe('read versus write', () => {
    it.each(routes.filter((r) => r.permission === WRITE))(
      'system_settings:read alone is refused on $name',
      async (route) => {
        const response = await call(route.method, route.url, asUser(READ), route.payload);
        expect(response.statusCode).toBe(403);
        expect(service[route.handler]).not.toHaveBeenCalled();
      },
    );

    it.each(routes.filter((r) => r.permission === READ))(
      'system_settings:write alone is refused on $name',
      async (route) => {
        const response = await call(route.method, route.url, asUser(WRITE), route.payload);
        expect(response.statusCode).toBe(403);
      },
    );

    it('a user holding both permissions can use every route', async () => {
      for (const route of routes) {
        const response = await call(route.method, route.url, asUser(READ, WRITE), route.payload);
        expect(response.statusCode).toBe(route.okStatus);
      }
    });
  });

  describe('wiring', () => {
    it('passes the authenticated user id to the write routes', async () => {
      await call('POST', '/run', asUser(WRITE));
      expect(service.runNow).toHaveBeenCalledWith('admin-1');
      await call('DELETE', `/${ID}`, asUser(WRITE));
      expect(service.deleteRun).toHaveBeenCalledWith(ID, 'admin-1');
      await call('GET', `/${ID}/download`, asUser(WRITE));
      expect(service.getDownload).toHaveBeenCalledWith(ID, 'admin-1');
    });

    it('answers 400 before the service on an invalid schedule body', async () => {
      const response = await call('PUT', '/schedule', asUser(WRITE), { ...validBody, keepCount: 0 });
      expect(response.statusCode).toBe(400);
      expect(service.updateSchedule).not.toHaveBeenCalled();
    });

    it('answers 400 on a weekly schedule without dayOfWeek', async () => {
      const response = await call('PUT', '/schedule', asUser(WRITE), { ...validBody, frequency: 'weekly' });
      expect(response.statusCode).toBe(400);
    });

    it('does not echo the submitted password in a 400', async () => {
      const response = await call('PUT', '/schedule', asUser(WRITE), {
        ...validBody,
        password: 'abc',
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('"abc"');
    });

    it('forwards a valid body, including the password, to the service', async () => {
      await call('PUT', '/schedule', asUser(WRITE), { ...validBody, password: 'hunter22' });
      expect(service.updateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hunter22', frequency: 'daily' }),
        'admin-1',
      );
    });

    it('rejects a non-uuid id with 400', async () => {
      const response = await call('DELETE', '/not-a-uuid', asUser(WRITE));
      expect(response.statusCode).toBe(400);
      expect(service.deleteRun).not.toHaveBeenCalled();
    });

    it('applies list paging defaults and rejects out-of-range pageSize', async () => {
      await call('GET', '', asUser(READ));
      expect(service.listRuns).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
      const response = await call('GET', '?pageSize=101', asUser(READ));
      expect(response.statusCode).toBe(400);
    });
  });
});
