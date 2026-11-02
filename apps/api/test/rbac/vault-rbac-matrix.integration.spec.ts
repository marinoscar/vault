// =============================================================================
// RBAC matrix over every Vault domain route (issue #77, E3.2)
// =============================================================================
//
// The platform identity slice's REAL guards (`JwtAuthGuard`, `PermissionsGuard`)
// run over the full `AppModule` with a mocked Prisma client. For each of the
// three roles and for no credential at all, every Vault route (secrets, secret
// types, media, admin and user backups, card extraction, exports, storage
// objects, settings) is called and the answer checked:
//
//   anonymous                        401
//   a role without the permission    403
//   a role with it                   anything but 401 / 403 (the handler runs;
//                                    the mocked database answers however it answers)
//
// THE ORACLE IS WRITTEN BY HAND, not derived from the registry the guards read:
// `ROLE_PERMISSIONS` is today's seed (what contributors and viewers always had),
// and a separate test pins that the permission catalog the seed writes grants
// exactly that. A new route that is not in `ROUTES` fails the coverage test, so
// the matrix cannot go stale silently.
//
// The principal graph handed to the guard is the one production loads: `admin`
// in `user_roles` plus an `org_admin` membership; `contributor` and `viewer`
// only on the default-org membership (platform migration 0024 shape).
// =============================================================================

import '../../src/app-registrations/registrations';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import request from 'supertest';
import { buildPermissionCatalog, catalogGrants } from '@marinoscar/platform-api/core';
import { PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { discoverControllers } from '@marinoscar/platform-api/identity/testing';

import { AppModule } from '../../src/app.module';
import { BackupRunnerService } from '../../src/backups/backup-runner.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';

const ID = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const DEFAULT_ORG = '00000000-0000-4000-8000-0000000000d0';

type Role = 'admin' | 'contributor' | 'viewer';

// ---------------------------------------------------------------------------
// The oracle: what each role may do (today's seed, by hand)
// ---------------------------------------------------------------------------

const SECRETS_RW = [
  'secrets:read',
  'secrets:write',
  'secrets:delete',
  'secret_types:read',
  'secret_types:write',
  'secret_types:delete',
  'media:read',
  'media:write',
  'media:delete',
];
const USER_SETTINGS = ['user_settings:read', 'user_settings:write'];

/** Effective permissions per role. `admin` = system role grants + the `org_admin` membership's. */
const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  admin: [
    ...SECRETS_RW,
    ...USER_SETTINGS,
    'storage:read',
    'storage:write',
    'storage:delete_any',
    'secrets:read_any',
    'secrets:write_any',
    'secrets:delete_any',
    'media:read_any',
    'media:write_any',
    'media:delete_any',
    'system_settings:read',
    'system_settings:write',
    'users:read',
    'users:write',
    'allowlist:read',
    'allowlist:write',
    'rbac:manage',
    'jobs:read',
    'jobs:write',
    'nodes:read',
    'nodes:write',
  ],
  contributor: [...SECRETS_RW, ...USER_SETTINGS, 'storage:read', 'storage:write'],
  viewer: ['secrets:read', 'secret_types:read', 'media:read', ...USER_SETTINGS, 'storage:read'],
};

/** The scope of every permission the oracle mentions (org permissions come from the membership). */
const SYSTEM_PERMISSIONS = new Set([
  'storage:delete_any',
  'secrets:read_any',
  'secrets:write_any',
  'secrets:delete_any',
  'media:read_any',
  'media:write_any',
  'media:delete_any',
  'system_settings:read',
  'system_settings:write',
  'users:read',
  'users:write',
  'allowlist:read',
  'allowlist:write',
  'rbac:manage',
  'jobs:read',
  'jobs:write',
  'nodes:read',
  'nodes:write',
]);

// ---------------------------------------------------------------------------
// Every Vault route and the permission it enforces (`null` = any signed-in user)
// ---------------------------------------------------------------------------

type Route = readonly [method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, permission: string | null];

const ROUTES: readonly Route[] = [
  // Secret types
  ['GET', '/api/secret-types', 'secret_types:read'],
  ['GET', `/api/secret-types/${ID}`, 'secret_types:read'],
  ['POST', '/api/secret-types', 'secret_types:write'],
  ['PUT', `/api/secret-types/${ID}`, 'secret_types:write'],
  ['DELETE', `/api/secret-types/${ID}`, 'secret_types:delete'],
  // Secrets
  ['GET', '/api/secrets', 'secrets:read'],
  ['GET', '/api/secrets/by-name/some-name', 'secrets:read'],
  ['GET', `/api/secrets/${ID}`, 'secrets:read'],
  ['POST', '/api/secrets', 'secrets:write'],
  ['PUT', `/api/secrets/${ID}`, 'secrets:write'],
  ['DELETE', `/api/secrets/${ID}`, 'secrets:delete'],
  ['GET', `/api/secrets/${ID}/versions`, 'secrets:read'],
  ['GET', `/api/secrets/${ID}/versions/${ID}`, 'secrets:read'],
  ['POST', `/api/secrets/${ID}/versions/${ID}/rollback`, 'secrets:write'],
  ['POST', `/api/secrets/${ID}/renew`, 'secrets:write'],
  ['POST', `/api/secrets/${ID}/attachments`, 'secrets:write'],
  ['GET', `/api/secrets/${ID}/attachments`, 'secrets:read'],
  ['DELETE', `/api/secrets/${ID}/attachments/${ID}`, 'secrets:write'],
  // Exports and card extraction
  ['POST', '/api/secrets/export', 'secrets:read'],
  ['POST', '/api/secrets/cards/extract', 'secrets:write'],
  // Media
  ['POST', '/api/media/folders', 'media:write'],
  ['GET', '/api/media/folders', 'media:read'],
  ['GET', `/api/media/folders/${ID}`, 'media:read'],
  ['PATCH', `/api/media/folders/${ID}`, 'media:write'],
  ['DELETE', `/api/media/folders/${ID}`, 'media:delete'],
  ['GET', `/api/media/folders/${ID}/files`, 'media:read'],
  ['POST', `/api/media/folders/${ID}/files`, 'media:write'],
  ['GET', `/api/media/folders/${ID}/files/${ID}`, 'media:read'],
  ['PATCH', `/api/media/folders/${ID}/files/${ID}`, 'media:write'],
  ['DELETE', `/api/media/folders/${ID}/files/${ID}`, 'media:delete'],
  ['GET', `/api/media/folders/${ID}/files/${ID}/download`, 'media:read'],
  // Admin backups
  ['GET', '/api/admin/backups/schedule', 'system_settings:read'],
  ['PUT', '/api/admin/backups/schedule', 'system_settings:write'],
  ['POST', '/api/admin/backups/run', 'system_settings:write'],
  ['POST', '/api/admin/backups/export', 'system_settings:write'],
  ['GET', '/api/admin/backups', 'system_settings:read'],
  ['GET', `/api/admin/backups/${ID}/download`, 'system_settings:write'],
  ['DELETE', `/api/admin/backups/${ID}`, 'system_settings:write'],
  // My backups
  ['GET', '/api/backups/me/config', 'secrets:read'],
  ['POST', '/api/backups/me', 'secrets:read'],
  ['GET', '/api/backups/me', 'secrets:read'],
  ['GET', `/api/backups/me/${ID}/download`, 'secrets:read'],
  ['DELETE', `/api/backups/me/${ID}`, 'secrets:read'],
  // AI
  ['GET', '/api/ai/status', null],
  ['POST', '/api/system-settings/ai/verify', 'system_settings:write'],
  // Storage objects (bare @Auth: ownership-scoped)
  ['GET', '/api/storage/objects', null],
  ['GET', `/api/storage/objects/${ID}`, null],
  ['GET', `/api/storage/objects/${ID}/download`, null],
  ['DELETE', `/api/storage/objects/${ID}`, null],
  ['PATCH', `/api/storage/objects/${ID}/metadata`, null],
  ['POST', '/api/storage/objects/upload/init', null],
  ['GET', `/api/storage/objects/${ID}/upload/status`, null],
  ['POST', `/api/storage/objects/${ID}/upload/complete`, null],
  ['DELETE', `/api/storage/objects/${ID}/upload/abort`, null],
  ['POST', '/api/storage/objects', null],
  // Settings (the platform settings slice since E4.1)
  ['GET', '/api/user-settings', 'user_settings:read'],
  ['PUT', '/api/user-settings', 'user_settings:write'],
  ['PATCH', '/api/user-settings', 'user_settings:write'],
  ['GET', '/api/system-settings', 'system_settings:read'],
  ['PUT', '/api/system-settings', 'system_settings:write'],
  ['PATCH', '/api/system-settings', 'system_settings:write'],
  // Jobs and worker nodes (E5.1: the platform's queue and fleet; system permissions, admin only)
  ['GET', '/api/admin/jobs/stats', 'jobs:read'],
  ['GET', '/api/admin/jobs/insights', 'jobs:read'],
  ['POST', '/api/admin/jobs/insights/reset-history', 'jobs:write'],
  ['POST', '/api/admin/jobs/retry-failed', 'jobs:write'],
  ['POST', '/api/admin/jobs/reset-stuck', 'jobs:write'],
  ['GET', '/api/admin/jobs', 'jobs:read'],
  ['POST', `/api/admin/jobs/${ID}/retry`, 'jobs:write'],
  ['DELETE', `/api/admin/jobs/${ID}`, 'jobs:write'],
  ['GET', '/api/admin/nodes/credentials', 'nodes:read'],
  ['DELETE', `/api/admin/nodes/credentials/${ID}`, 'nodes:write'],
  ['GET', '/api/admin/nodes', 'nodes:read'],
  ['GET', `/api/admin/nodes/${ID}`, 'nodes:read'],
  ['GET', `/api/admin/nodes/${ID}/events`, 'nodes:read'],
  ['DELETE', `/api/admin/nodes/${ID}`, 'nodes:write'],
  ['POST', '/api/nodes/register', 'nodes:write'],
  ['GET', '/api/nodes/job-types', 'nodes:read'],
  ['GET', '/api/nodes', 'nodes:read'],
  ['GET', `/api/nodes/${ID}`, 'nodes:read'],
  ['GET', `/api/nodes/${ID}/events`, 'nodes:read'],
  ['POST', `/api/nodes/${ID}/deregister`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/heartbeat`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/claim`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/jobs/${ID}/renew`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/jobs/${ID}/download-url`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/jobs/${ID}/upload-url`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/jobs/${ID}/secret`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/jobs/${ID}/result`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/jobs/${ID}/failure`, 'nodes:write'],
  ['POST', `/api/nodes/${ID}/telemetry`, 'nodes:write'],
  ['POST', '/api/node-credentials', 'nodes:write'],
  ['GET', '/api/node-credentials', 'nodes:read'],
  ['DELETE', `/api/node-credentials/${ID}`, 'nodes:write'],
];


// ---------------------------------------------------------------------------
// Principal graphs, as production loads them
// ---------------------------------------------------------------------------

const grant = (name: string) => ({
  permission: { id: `perm-${name}`, name, description: null, scope: SYSTEM_PERMISSIONS.has(name) ? 'system' : 'org' },
});

function roleGraph(roleName: string, scope: 'system' | 'org', permissions: readonly string[]) {
  return { id: `role-${roleName}`, name: roleName, description: null, scope, rolePermissions: permissions.map(grant) };
}

function principalGraph(id: string, role: Role, overrides: { isActive?: boolean } = {}) {
  const systemPermissions = ROLE_PERMISSIONS[role].filter((p) => SYSTEM_PERMISSIONS.has(p));
  const orgPermissions = ROLE_PERMISSIONS[role].filter((p) => !SYSTEM_PERMISSIONS.has(p));
  const orgRole = role === 'admin' ? 'org_admin' : role;
  return {
    id,
    email: `${role}@example.test`,
    displayName: null,
    providerDisplayName: null,
    profileImageUrl: null,
    providerProfileImageUrl: null,
    isActive: overrides.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    userRoles: role === 'admin' ? [{ role: roleGraph('admin', 'system', systemPermissions) }] : [],
    memberships: [
      {
        orgId: DEFAULT_ORG,
        status: 'active',
        lastActiveAt: null,
        createdAt: new Date(),
        org: { id: DEFAULT_ORG, isDefault: true },
        role: roleGraph(orgRole, 'org', orgPermissions),
      },
    ],
  };
}

const USERS: Record<Role, string> = {
  admin: '11111111-1111-4111-8111-111111111111',
  contributor: '22222222-2222-4222-8222-222222222222',
  viewer: '33333333-3333-4333-8333-333333333333',
};
const INACTIVE_USER = '44444444-4444-4444-8444-444444444444';

describe('Vault RBAC matrix (platform identity guards over the full app)', () => {
  let app: NestFastifyApplication;
  let jwt: JwtService;

  const tokenFor = (userId: string, role: Role, extra: Record<string, unknown> = { org: DEFAULT_ORG }) =>
    jwt.sign({ sub: userId, email: `${role}@example.test`, roles: role === 'admin' ? ['admin'] : [], ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      // No route of the matrix may start a real backup.
      .overrideProvider(BackupRunnerService)
      .useValue(new Proxy({}, { get: (_target, key) => (key === 'then' ? undefined : async () => undefined) }))
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    jwt = moduleRef.get(JwtService);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetPrismaMock();
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const role = (Object.keys(USERS) as Role[]).find((r) => USERS[r] === where.id);
      if (role) return principalGraph(where.id, role);
      if (where.id === INACTIVE_USER) return principalGraph(where.id, 'admin', { isActive: false });
      return null;
    });
  });

  const call = (method: Route[0], path: string, token?: string) => {
    let req = request(app.getHttpServer())[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    return method === 'GET' || method === 'DELETE' ? req : req.send({});
  };

  describe('coverage', () => {
    it('lists every route of the Vault domain controllers, with the permission it enforces', () => {
      const controllerNames = new Set([
        'SecretsController',
        'SecretTypesController',
        'MediaController',
        'BackupsController',
        'MyBackupsController',
        'CardExtractController',
        'AiController',
        'AiVerifyController',
        'ObjectsController',
        'UserSettingsController',
        'SystemSettingsController',
        'JobAdminController',
        'NodesAdminController',
        'NodesController',
        'NodeCredentialController',
      ]);
      const discovered = new Map<string, string | null>();
      for (const controller of discoverControllers(AppModule)) {
        if (!controllerNames.has(controller.name)) continue;
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          if (typeof handler !== 'function' || name === 'constructor') continue;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
          if (verb === undefined) continue;
          const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string).replace(/^\/+|\/+$/g, '');
          const permissions = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? Reflect.getMetadata(PERMISSIONS_KEY, controller)) as
            | string[]
            | undefined;
          discovered.set(`${RequestMethod[verb]} /api/${[base, sub].filter(Boolean).join('/')}`, permissions?.[0] ?? null);
        }
      }

      const normalised = (path: string) => path.split(ID).join(':id').replace(/\/by-name\/[^/]+/, '/by-name/:name');
      const declared = new Map(ROUTES.map(([m, p, perm]) => [`${m} ${normalised(p)}`, perm] as const));

      // Compare shapes: parameter names differ (`:folderId`), so collapse every `:param`.
      const shape = (key: string) => key.replace(/:[A-Za-z]+/g, ':p');
      const discoveredShapes = new Map([...discovered].map(([k, v]) => [shape(k), v] as const));
      const declaredShapes = new Map([...declared].map(([k, v]) => [shape(k), v] as const));

      expect([...discoveredShapes.keys()].filter((k) => !declaredShapes.has(k))).toEqual([]);
      expect([...declaredShapes.keys()].filter((k) => !discoveredShapes.has(k))).toEqual([]);
      for (const [key, permission] of declaredShapes) {
        expect({ key, permission: discoveredShapes.get(key) }).toEqual({ key, permission });
      }
    });

    it('is the permission set the seed writes: the catalog grants exactly the hand-written oracle', () => {
      const grants = catalogGrants(buildPermissionCatalog());
      const heldBy = (roleNames: string[]) =>
        grants.filter((g) => roleNames.includes(g.role)).map((g) => g.permission);
      const mine = (permissions: readonly string[]) => permissions.filter((p) => /^(secrets|secret_types|media|jobs|nodes):/.test(p));

      expect(mine(heldBy(['admin', 'org_admin'])).sort()).toEqual(mine(ROLE_PERMISSIONS.admin).sort());
      expect(mine(heldBy(['contributor'])).sort()).toEqual(mine(ROLE_PERMISSIONS.contributor).sort());
      expect(mine(heldBy(['viewer'])).sort()).toEqual(mine(ROLE_PERMISSIONS.viewer).sort());
    });
  });

  describe.each(ROUTES.map((route) => [`${route[0]} ${route[1]}`, route] as const))('%s', (_label, [method, path, permission]) => {
    it('answers 401 without a credential', async () => {
      const response = await call(method, path);
      expect(response.status).toBe(401);
    });

    it.each(['admin', 'contributor', 'viewer'] as Role[])('%s', async (role) => {
      const allowed = permission === null || ROLE_PERMISSIONS[role].includes(permission);
      const response = await call(method, path, tokenFor(USERS[role], role));

      if (allowed) {
        expect([401, 403]).not.toContain(response.status);
      } else {
        expect(response.status).toBe(403);
      }
    });
  });

  describe('credentials', () => {
    it('accepts an access token minted before the identity slice (no `org` claim) while the process is young', async () => {
      const response = await call('GET', '/api/secrets', tokenFor(USERS.contributor, 'contributor', {}));
      expect([401, 403]).not.toContain(response.status);
    });

    it('rejects a disabled user at once, whatever the role', async () => {
      const response = await call('GET', '/api/secrets', tokenFor(INACTIVE_USER, 'admin'));
      expect(response.status).toBe(401);
    });

    it('rejects a token for a user that does not exist', async () => {
      const response = await call('GET', '/api/secrets', tokenFor('99999999-9999-4999-8999-999999999999', 'viewer'));
      expect(response.status).toBe(401);
    });

    it('rejects a garbage bearer token', async () => {
      const response = await call('GET', '/api/secrets', 'not-a-token');
      expect(response.status).toBe(401);
    });

    it('serves the public provider list and health without a credential', async () => {
      expect((await call('GET', '/api/auth/providers')).status).toBe(200);
      expect((await call('GET', '/api/health/live')).status).toBe(200);
    });
  });
});
