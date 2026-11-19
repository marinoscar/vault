// =============================================================================
// Vault runs its own conformance kit against the real /api/agent/v1 (issue #196)
// =============================================================================
//
// `@marinoscar/vault-contract/agent-testing` publishes a scenario list that agent runtimes run
// against the kit's fake Vault. This spec runs the SAME list against the real API: a migrated,
// seeded deployment (ordinary application role), the full app listening on a port, real OAuth
// (authorization code + PKCE through consent), the real settings route for the kill switch, the
// owner's real routes to close a login and revoke a grant. The runtime is the kit's reference
// runtime. The package's own test runs the list against the fake, so the fake and the real server
// cannot drift apart. Finally the kit's canary scan runs over everything the API logged.
//
// Only invented data: the kit's seed (`Person A`, `*.example.test`, random canary values).
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import {
  AuthService,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PRINCIPAL_USER_INCLUDE,
} from '@marinoscar/platform-api/identity';
import {
  createOAuthTestClient,
  exchangeOAuthCode,
  runOAuthAuthorizationCodeFlow,
} from '@marinoscar/platform-api/identity/testing';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';
import { AgentRateLimiter } from '@marinoscar/vault-api/agent';
import {
  AGENT_CONFORMANCE_SCENARIOS,
  createConformanceSeed,
  createReferenceSignIn,
  findCanaries,
  runAgentConformance,
  type AgentConformanceBucket,
  type AgentConformanceReport,
  type AgentConformanceTarget,
  type AgentTokens,
  type ConformanceFixture,
  type ConformanceLoginKey,
} from '@marinoscar/vault-contract/agent-testing';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const LOGIN_SCOPES = ['vault:items_read', 'vault:items_fill', 'offline_access'];

describeWithDb('Vault agent conformance kit against the real /api/agent/v1 (real Postgres, #196)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let orgId = '';
  let appUrl = '';
  let session = '';
  let adminSession = '';
  let baseUrl = '';
  let target: AgentConformanceTarget;
  let report: AgentConformanceReport;
  const savedEnv: Record<string, string | undefined> = {};
  const lines: string[] = [];
  const restores: Array<() => void> = [];
  const seed = createConformanceSeed();

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const field = (name: string, required: boolean, sensitive = false) => ({ name, label: name, type: 'string', required, sensitive });

  async function createUser(email: string, systemAdmin = false) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: systemAdmin ? 'org_admin' : 'contributor' } });
    const user = await prisma.user.create({ data: { email, providerDisplayName: systemAdmin ? 'Admin A' : 'Person A', isActive: true } });
    await prisma.membership.create({ data: { userId: user.id, orgId, roleId: role.id, status: 'active' } });
    if (systemAdmin) {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    }
    const graph = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId });
    return { id: user.id, session: tokens.accessToken };
  }

  const adminPatch = async (body: object) => {
    const res = await http().patch('/api/system-settings').set(bearer(adminSession)).send(body);
    expect(res.status).toBe(200);
  };

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
    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'INITIAL_ADMIN_EMAIL']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env, { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' });
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Everything the process prints from here on: the Nest logger and raw stdout/stderr (Pino).
    const record = (level: string) => (...args: unknown[]) =>
      void lines.push(`${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    Logger.overrideLogger({ log: record('log'), error: record('error'), warn: record('warn'), debug: record('debug'), verbose: record('verbose'), fatal: record('fatal') });
    restores.push(() => Logger.overrideLogger(new ConsoleLogger()));
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        lines.push(`raw ${String(chunk)}`);
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      restores.push(() => void (stream.write = original as typeof stream.write));
    }

    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    jest.spyOn(app.get(OAuthRateLimitService), 'consume').mockImplementation(() => ({ allowed: true, retryAfterSeconds: 0 }));

    // `throttleNext`: the next call counted in a bucket is refused with the given Retry-After,
    // through the real pipeline (the limiter is the only thing replaced, and only for that call).
    const limiter = app.get(AgentRateLimiter);
    const consume = limiter.consume.bind(limiter);
    const pending = new Map<string, number>();
    jest.spyOn(limiter, 'consume').mockImplementation((key: string, limit: number, windowMs?: number) => {
      const bucket = key.split(':')[0]!;
      const forced = pending.get(bucket);
      if (forced !== undefined) {
        pending.delete(bucket);
        return { allowed: false, retryAfterSeconds: forced };
      }
      return consume(key, limit, windowMs);
    });

    orgId = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    const personA = await createUser('person-a@example.test');
    session = personA.session;
    ({ session: adminSession } = await createUser('admin-a@example.test', true));

    const credTypeId = (
      await prisma.secretType.create({
        data: {
          name: 'Credential', isSystem: true, createdById: personA.id,
          fields: [field('username', true), field('password', true, true), field('url', false), field('notes', false), field('additional_urls', false), field('totp', false, true)],
        },
      })
    ).id;

    await adminPatch({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } });
    app.get(OAuthServerSettingsReader).invalidate();
    await adminPatch({ agentAccess: { enabled: true } });

    // The kit's seed, created through the real routes by Person A.
    const ids = {} as ConformanceFixture['ids'];
    for (const login of Object.values(seed.logins)) {
      const created = await http()
        .post('/api/secrets')
        .set(bearer(session))
        .send({
          name: login.name, typeId: credTypeId,
          data: { username: login.username, password: login.password, url: login.origins[0], ...(login.totpSeed ? { totp: login.totpSeed } : {}) },
        });
      expect(created.status).toBe(201);
      ids[login.key] = created.body.data.id;
      if (login.open) {
        await http().patch(`/api/secrets/${ids[login.key]}/agent-access`).set(bearer(session)).send({ agentAccess: 'fill' }).expect(200);
      }
    }
    const fixture: ConformanceFixture = { ...seed, ids };

    const client = await createOAuthTestClient(prisma as never, { name: 'Conformance Runtime A', tokenEndpointAuthMethod: 'client_secret_post' });
    target = {
      baseUrl,
      fixture,
      async connect(): Promise<AgentTokens> {
        const flow = await runOAuthAuthorizationCodeFlow(app, {
          client, user: { sessionToken: session }, scopes: LOGIN_SCOPES, resource: `${appUrl}/api/agent/v1`,
        });
        const exchanged = await exchangeOAuthCode(app, { client, code: flow.code!, verifier: flow.pkce.verifier });
        expect(exchanged.status).toBe(200);
        return {
          accessToken: String(exchanged.body.access_token),
          refreshToken: exchanged.body.refresh_token ? String(exchanged.body.refresh_token) : undefined,
          scopes: String(exchanged.body.scope).split(' '),
        };
      },
      async revokeGrants() {
        const grants = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
        for (const grant of grants.body.data as Array<{ id: string }>) {
          await http().delete(`/api/oauth/grants/${grant.id}`).set(bearer(session)).expect((r) => expect([200, 204]).toContain(r.status));
        }
      },
      async setAgentAccess(enabled: boolean) {
        await adminPatch({ agentAccess: { enabled } });
      },
      async setLoginOpen(key: ConformanceLoginKey, open: boolean) {
        await http().patch(`/api/secrets/${ids[key]}/agent-access`).set(bearer(session)).send({ agentAccess: open ? 'fill' : 'none' }).expect(200);
      },
      async throttleNext(bucket: AgentConformanceBucket, retryAfterSeconds: number) {
        pending.set(bucket, retryAfterSeconds);
      },
    };
  }, 240_000);

  afterAll(async () => {
    restores.forEach((restore) => restore());
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('runs the whole scenario list (server and runtime) against the real API with the reference runtime', async () => {
    report = await runAgentConformance({
      target,
      signIn: createReferenceSignIn(),
      // The "runtime's artifacts" here are the API's own logs of the run.
      artifacts: () => [{ label: 'API logs', content: lines.join('\n') }],
      timeoutMs: 30_000,
    });
    const notPassed = report.results.filter((r) => r.status !== 'passed');
    expect(notPassed.map((r) => ({ id: r.id, status: r.status, problems: r.problems }))).toEqual([]);
    const ran = report.results.map((r) => r.id);
    expect(ran).toEqual(AGENT_CONFORMANCE_SCENARIOS.map((s) => s.id));
  }, 180_000);

  it('canary scan: no seeded value reached the API logs during the run', () => {
    expect(report).toBeDefined();
    expect(lines.length).toBeGreaterThan(0);
    expect(findCanaries(seed.canaries, lines.join('\n'))).toEqual([]);
  });
});
