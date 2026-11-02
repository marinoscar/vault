// =============================================================================
// How Vault boots for the platform AI conformance suites (issue #87, E8.1)
// =============================================================================
//
// The suites (`ai-kill-switch`, `ai-rbac-matrix`, `ai-secret-egress`, `ai-key-policy`,
// `ai-jobs-server-only`) drive THIS app's real router. `aiConformanceFixture` answers
// what they need:
//
//   createAiApp     the real `AppModule` over the mocked database, with the AI runtime
//                   harness wired in: `AiService`, `AiRunsService`, `AiConfigService` and
//                   `AiOutputWriter` are replaced by the harness's instances (the real
//                   classes over a scripted fake provider and in-memory tables). The
//                   controllers, guards, job handlers and the key/usage services are the
//                   app's own wiring.
//   createContext   the same app WITHOUT the harness, for the admin surface.
//   createUser      a user shaped like production (system role plus org-role membership),
//                   with permissions from the SAME catalog the seed writes.
//   openApiDocument the document the routes are DISCOVERED from, never hand-listed.
//
// Vault's own `/api/ai/status` alias (a bare `@Auth()` compatibility route, not behind the
// kill switch by design: it is how the web learns AI is off) is left out of the discovered
// document, like KVox leaves out its own routes; it is pinned by `src/ai/ai-status.controller.spec.ts`.
// =============================================================================

import {
  AiConfigService,
  AiOutputWriter,
  AiRunsService,
  AiService,
} from '@marinoscar/platform-api/ai';
import {
  createAiRuntimeHarness,
  HARNESS_OTHER_USER,
  HARNESS_USER,
  HARNESS_USER_KEY,
  type AiConformanceApp,
  type AiConformanceContext,
  type AiConformanceFixture,
  type AiConformanceNestApp,
  type AiConformanceOpenApiDocument,
  type AiRuntimeHarness,
  type AiRuntimeHarnessOptions,
} from '@marinoscar/platform-api/ai/testing';
import {
  buildPermissionCatalog,
  catalogGrants,
  permissionRegistry,
} from '@marinoscar/platform-api/core';
import { createOpenApiDocument } from '@marinoscar/platform-api/host';
import { JwtService } from '@nestjs/jwt';

import { APP_OPENAPI } from '../../src/openapi/document';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';

/** The organization the minted users belong to (a plain string, as the harness expects). */
export const AI_CONFORMANCE_ORG_ID = 'org-default';

const OWN_ROUTES = new Set(['/api/ai/status']);

/** What each role holds, from the catalog the seed writes (`admin` also holds `org_admin`'s). */
function catalogPermissionsOf(roleName: string): string[] {
  return catalogGrants(buildPermissionCatalog())
    .filter((grant) => grant.role === roleName)
    .map((grant) => grant.permission);
}

export const AI_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  admin: [...new Set([...catalogPermissionsOf('admin'), ...catalogPermissionsOf('org_admin')])],
  contributor: catalogPermissionsOf('contributor'),
  viewer: catalogPermissionsOf('viewer'),
};

// ---------------------------------------------------------------------------
// Users: the principal graph production loads
// ---------------------------------------------------------------------------

const users = new Map<string, Record<string, unknown>>();

const scopeOf = (permission: string) => permissionRegistry.get(permission)?.scope ?? 'org';

function roleGraph(roleName: string, scope: 'system' | 'org') {
  const permissions = catalogPermissionsOf(roleName).filter((p) => scopeOf(p) === scope);
  return {
    id: `role-${roleName}`,
    name: roleName,
    description: null,
    scope,
    rolePermissions: permissions.map((name) => ({
      permission: { id: `perm-${name}`, name, description: null, scope },
    })),
  };
}

function installUserLookup(): void {
  // `forSystem(prisma, reason)` (the retention purges' bypass client) extends the client; over the
  // mock the extension is the mock itself, so `aiUsageEvent` / `aiRun` are the suite's own spies.
  (prismaMock.$extends as jest.Mock).mockImplementation(() => prismaMock);
  (prismaMock.user.findUnique as jest.Mock).mockImplementation(
    async ({ where }: { where: { id?: string; email?: string } }) =>
      (where.id ? users.get(where.id) : [...users.values()].find((u) => u.email === where.email)) ?? null,
  );
}

function withoutOwnRoutes(document: AiConformanceOpenApiDocument): AiConformanceOpenApiDocument {
  const paths = Object.fromEntries(
    Object.entries(document.paths ?? {}).filter(([path]) => !OWN_ROUTES.has(path)),
  );
  return { ...document, paths };
}

type HarnessSnapshot = { policy: string; script: unknown; delayMs: number };

function fakeInternals(harness: AiRuntimeHarness): {
  script: unknown;
  scriptCursor: number;
  options: { delayMs?: number };
} {
  return harness.fake as unknown as { script: unknown; scriptCursor: number; options: { delayMs?: number } };
}

async function createAiApp(options: AiRuntimeHarnessOptions = {}): Promise<AiConformanceApp> {
  const harness = createAiRuntimeHarness(options);
  const internals = fakeInternals(harness);
  const initial: HarnessSnapshot = {
    policy: JSON.stringify(harness.policy),
    script: internals.script,
    delayMs: internals.options.delayMs ?? 0,
  };
  const initialOrgKey = options.orgKey === true;

  const context = await createTestApp({
    useMockDatabase: true,
    overrideProviders: [
      { provide: AiService, useValue: harness.ai },
      { provide: AiRunsService, useValue: harness.runs },
      { provide: AiConfigService, useValue: harness.aiConfig },
      { provide: AiOutputWriter, useValue: harness.outputs },
    ],
  });

  await context.app.listen(0, '127.0.0.1');
  const baseUrl = await context.app.getUrl();

  return {
    context: context as unknown as AiConformanceContext,
    harness,
    baseUrl,
    script(next) {
      internals.script = next;
      internals.scriptCursor = 0;
    },
    setDelay(ms) {
      internals.options.delayMs = ms;
    },
    reset() {
      users.clear();
      resetPrismaMock();
      setupBaseMocks();
      installUserLookup();

      harness.fake.reset();
      internals.script = initial.script;
      internals.scriptCursor = 0;
      internals.options.delayMs = initial.delayMs;

      harness.usageEvents.length = 0;
      harness.runRows.length = 0;
      harness.enqueued.length = 0;
      harness.setPolicy(JSON.parse(initial.policy));

      for (const userId of [HARNESS_USER, HARNESS_OTHER_USER]) harness.removeUserKeys(userId);
      if (options.userKey ?? true) {
        harness.addUserKey(HARNESS_USER, HARNESS_USER_KEY, options.reachable ?? defaultReachable(options));
      }
      harness.setOrgKey(initialOrgKey ? 'sk-org-admin-key-9999' : null);
      harness.clearOrgPolicies();
      harness.clearTenantKeys();
      harness.clearAiConfigWriters();
      harness.storage.reset();
      harness.storage.setConfigured(true);
      harness.orgKeys.getKey.mockClear();
    },
    async close() {
      users.clear();
      await closeTestApp(context);
    },
  };
}

function defaultReachable(options: AiRuntimeHarnessOptions): string[] {
  if (options.models) {
    return options.models.filter((model) => (model.provider ?? 'openai') === 'openai').map((model) => model.modelId);
  }
  return [
    'fake-model',
    'fake-embedding-model',
    'fake-image-model',
    'fake-transcription-model',
    'fake-speech-model',
    'fake-realtime-model',
  ];
}

let counter = 0;

export const aiConformanceFixture: AiConformanceFixture = {
  createAiApp,
  createContext: async (contextOptions) => {
    const context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: contextOptions?.overrideProviders as never,
    });
    installUserLookup();
    return context as unknown as AiConformanceContext;
  },
  closeContext: (context) => closeTestApp(context as unknown as TestContext),
  async createUser(context, { id, roleName }) {
    installUserLookup();
    const userId = id ?? `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
    const email = `${roleName}-${userId}@example.test`;
    const orgRole = roleName === 'admin' ? 'org_admin' : roleName;
    users.set(userId, {
      id: userId,
      email,
      displayName: null,
      providerDisplayName: null,
      profileImageUrl: null,
      providerProfileImageUrl: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      userRoles: roleName === 'admin' ? [{ role: roleGraph('admin', 'system') }] : [],
      memberships: [
        {
          orgId: AI_CONFORMANCE_ORG_ID,
          status: 'active',
          lastActiveAt: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          org: { id: AI_CONFORMANCE_ORG_ID, isDefault: true },
          role: roleGraph(orgRole, 'org'),
        },
      ],
    });
    const accessToken = (context as unknown as TestContext).module.get(JwtService).sign({
      sub: userId,
      email,
      roles: roleName === 'admin' ? ['admin'] : [],
      org: AI_CONFORMANCE_ORG_ID,
    });
    return { id: userId, accessToken };
  },
  openApiDocument: (app: AiConformanceNestApp) =>
    withoutOwnRoutes(createOpenApiDocument(app as never, APP_OPENAPI) as unknown as AiConformanceOpenApiDocument),
  defaultOrgId: AI_CONFORMANCE_ORG_ID,
  rolePermissions: AI_ROLE_PERMISSIONS,
};
