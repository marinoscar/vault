// =============================================================================
// The agent OAuth server over a real flow (issue #174, E14.2, epic #172)
// =============================================================================
//
// A migrated, seeded deployment (role, migrate, seed, as production does) with the OAuth server
// switched on, driven through the full app with the platform test kit:
//
//   - a real authorization-code + PKCE flow through the consent API yields an `oat_` access token
//     and a refresh token for the `agent` resource;
//   - `secret-egress`: no token, code, secret or hash in a grants response, an audit row or a log
//     line (the `oauth-server` suite's tenth check; test/conformance.spec.ts skips it with a pointer
//     here);
//   - route confinement: an `oat_` token is refused on `/api/secrets`, `/api/auth/me`, `/api/admin/*`;
//   - scope narrowing and step-up: a `vault:items_read` token reaches `whoami` but gets
//     `403 insufficient_scope` (with a `WWW-Authenticate` challenge) on a route that needs
//     `secrets:fill`; a `vault:items_fill` token passes it;
//   - with the server OFF the metadata documents answer 404.
//
// Like every `*.db.spec.ts` it runs through `npm run test:db` and skips when no Postgres superuser
// is reachable.
// =============================================================================

import '../../../src/app-registrations/registrations';

import { ConsoleLogger, Controller, Get, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import {
  Auth,
  AuthService,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PRINCIPAL_USER_INCLUDE,
} from '@marinoscar/platform-api/identity';
import {
  checkOAuthSecretEgress,
  createOAuthTestClient,
  exchangeOAuthCode,
  mintOAuthTestToken,
  runOAuthAuthorizationCodeFlow,
} from '@marinoscar/platform-api/identity/testing';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

import { AppModule } from '../../../src/app.module';
import { PERMISSION_OPTIONS } from '../../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../../src/settings/registry/default-system-settings';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../../helpers/app-role-database.helper';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

/** A stand-in for the fill route of E14.6: it needs `secrets:fill` under the agent prefix. */
@Controller('agent/v1/fill-probe')
class FillProbeController {
  @Get()
  @Auth({ permissions: ['secrets:fill'] })
  probe() {
    return { ok: true };
  }
}
@Module({ controllers: [FillProbeController] })
class FillProbeModule {}

describeWithDb('Vault agent OAuth (real Postgres, E14.2)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let userId: string;
  let orgId: string;
  let appUrl: string;
  let session: string;
  const savedEnv: Record<string, string | undefined> = {};
  const logLines: string[] = [];
  const secrets: string[] = [];
  let restoreLogger: () => void = () => undefined;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const setServer = async (enabled: boolean) => {
    await app.get(SystemSettingsService).patchSettings(
      { oauthServer: { enabled, allowedClientHosts: enabled ? ['client.example.test'] : [] } } as never,
      userId,
    );
    app.get(OAuthServerSettingsReader).invalidate();
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, FillProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const record = (level: string) => (...args: unknown[]) =>
      void logLines.push(`${level} ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
    Logger.overrideLogger({ log: record('log'), error: record('error'), warn: record('warn'), debug: record('debug'), verbose: record('verbose'), fatal: record('fatal') });
    restoreLogger = () => Logger.overrideLogger(new ConsoleLogger());
    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    jest.spyOn(app.get(OAuthRateLimitService), 'consume').mockImplementation(() => ({ allowed: true, retryAfterSeconds: 0 }));

    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    orgId = org.id;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({ data: { email: 'agent-owner@example.test', providerDisplayName: 'Person A', isActive: true } });
    userId = user.id;
    await prisma.membership.create({ data: { userId, orgId, roleId: role.id, status: 'active' } });
    const graph = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    session = (await app.get(AuthService).generateFullTokens(graph as never, { orgId })).accessToken;
    secrets.push(session);
    // `whoami` answers 403 AGENT_ACCESS_DISABLED while the deployment switch is off (E14.6).
    await app.get(SystemSettingsService).patchSettings({ agentAccess: { enabled: true } } as never, userId);
  }, 240_000);

  afterAll(async () => {
    restoreLogger();
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('the seed grants secrets:fill to exactly the roles that hold secrets:read', async () => {
    const holders = async (permission: string) =>
      (await prisma.rolePermission.findMany({ where: { permission: { name: permission } }, select: { role: { select: { name: true } } } }))
        .map((row) => row.role.name)
        .sort();
    expect(await holders('secrets:fill')).toEqual(await holders('secrets:read'));
    expect(await holders('secrets:fill')).toEqual(['contributor', 'org_admin', 'viewer']);
    expect(await holders('oauth_clients:read')).toEqual(['admin']);
  });

  it('with the server off the metadata documents answer 404 and the session still works', async () => {
    await http().get('/.well-known/oauth-authorization-server').expect(404);
    await http().get('/api/oauth/.well-known/authorization-server').expect(404);
    await http().get('/api/agent/v1/whoami').set(bearer(session)).expect(200);
    await http().get('/api/secrets').set(bearer(session)).expect(200);
  });

  it('a real authorization-code + PKCE flow yields an agent token that is confined, narrowed and stepped up', async () => {
    await setServer(true);
    const made = await createOAuthTestClient(prisma as never, { tokenEndpointAuthMethod: 'client_secret_post' });
    secrets.push(made.secret!);
    const resource = `${appUrl}/api/agent/v1`;

    const flow = await runOAuthAuthorizationCodeFlow(app, {
      client: made,
      user: { sessionToken: session },
      scopes: ['vault:items_read', 'offline_access'],
      resource,
    });
    secrets.push(flow.code!, flow.pkce.verifier);
    const exchanged = await exchangeOAuthCode(app, { client: made, code: flow.code!, verifier: flow.pkce.verifier });
    expect(exchanged.status).toBe(200);
    const access = exchanged.body.access_token as string;
    const refresh = exchanged.body.refresh_token as string;
    expect(access.startsWith('oat_')).toBe(true);
    expect(refresh).toEqual(expect.any(String));
    secrets.push(access, refresh);

    // Discovery documents answer once the server is on.
    const as = await http().get('/api/oauth/.well-known/authorization-server').expect(200);
    expect(as.body.issuer ?? as.body.data?.issuer).toBe(appUrl);
    const pr = await http().get('/api/oauth/.well-known/protected-resource/api/agent/v1').expect(200);
    expect(JSON.stringify(pr.body)).toContain('/api/agent/v1');

    // Inside the resource.
    const who = await http().get('/api/agent/v1/whoami').set(bearer(access)).expect(200);
    expect(who.body.data).toEqual({
      userId,
      scopes: ['vault:items_read', 'offline_access'],
      clientId: expect.any(String),
      // Contract 1.3 (#233): card and identity release are off by default, so only logins, totp and save_login.
      contract: { version: '1.3', features: ['logins', 'totp', 'save_login'] },
    });

    // Confinement: refused everywhere outside the resource.
    for (const path of ['/api/secrets', '/api/auth/me', '/api/admin/oauth/clients', '/api/backups/me']) {
      const res = await http().get(path).set(bearer(access));
      expect([401, 403]).toContain(res.status);
    }

    // Step-up: the user holds secrets:fill, the token's scopes do not grant it.
    const stepUp = await http().get('/api/agent/v1/fill-probe').set(bearer(access));
    expect(stepUp.status).toBe(403);
    expect(String(stepUp.headers['www-authenticate'])).toContain('insufficient_scope');

    // Secret egress over the evidence of this flow.
    const grants = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
    const auditRows = await prisma.auditEvent.findMany({ where: { action: { startsWith: 'oauth:' } } });
    expect(checkOAuthSecretEgress({ secrets, responses: [grants.body], auditRows, logLines })).toEqual([]);
  });

  it('a vault:items_fill token passes the fill probe; a vault:items_read token does not reach write', async () => {
    const fill = await mintOAuthTestToken(prisma as never, { userId, resourceId: 'agent', scopes: ['vault:items_fill'], appUrl, orgId });
    await http().get('/api/agent/v1/fill-probe').set(bearer(fill.token)).expect(200);
    const read = await mintOAuthTestToken(prisma as never, { userId, resourceId: 'agent', scopes: ['vault:items_read'], appUrl, orgId });
    const denied = await http().get('/api/agent/v1/fill-probe').set(bearer(read.token));
    expect(denied.status).toBe(403);
    expect(String(denied.headers['www-authenticate'])).toContain('insufficient_scope');
    await http().get('/api/secrets').set(bearer(read.token)).expect((res) => expect([401, 403]).toContain(res.status));
    await setServer(false);
  });
});
