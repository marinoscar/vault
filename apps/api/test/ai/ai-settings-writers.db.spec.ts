// =============================================================================
// Real-Postgres test: the `ai` block survives every writer (issue #87, E8.1)
// =============================================================================
//
// The `ai` block of the `global` row has two writers: `PATCH /api/system-settings`
// (Vault's `cardExtractModel`) and the packaged admin AI routes (`PUT /api/admin/ai/config`,
// the key and model routes). Proves each leaves the other's fields alone, and that
// `GET /api/ai/status` carries the `features.cardExtract` flag the web reads.
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
import { AiProviderRegistry } from '@marinoscar/platform-api/ai';
import { FAKE_TEXT_MODEL_CAPABILITIES, FakeAiProvider } from '@marinoscar/platform-api/ai/testing';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';

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

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const DEPLOYMENT_KEY = 'sk-deployment-0123456789abcdefghijklmnop';
const MODEL = 'fake-model';
const PAN = '4111111111111111';
const CARDHOLDER = 'ADA LOVELACE';
// Recognisable base64 payloads: if either shows up in a row, bytes leaked.
const FRONT = `data:image/jpeg;base64,${Buffer.from('FRONT-IMAGE-BYTES-MARKER').toString('base64')}`;
const BACK = `data:image/png;base64,${Buffer.from('BACK-IMAGE-BYTES-MARKER').toString('base64')}`;
const IMAGE_MARKERS = ['RlJPTlQtSU1BR0UtQllURVMtTUFSS0VS', 'QkFDSy1JTUFHRS1CWVRFUy1NQVJLRVI'];

const scores = { cardholder_name: 0.9, number: 0.99, exp_month: 0.9, exp_year: 0.9, card_network: 0.9, card_kind: 0.6, issuing_bank: 0, notes: 0 };
const MODEL_ANSWER = {
  cardholder_name: CARDHOLDER,
  number: PAN,
  exp_month: '07',
  exp_year: '2030',
  card_network: 'Visa',
  card_kind: 'Credit',
  issuing_bank: null,
  notes: 'Customer service 555-0100\nCVV 123',
  // Not in the schema: a model that ignores the prompt and sends a code anyway.
  cvv: '123',
  confidence: scores,
  warnings: [],
  front_box: { x: 0, y: 0, width: 1, height: 1, quarter_turns: 0, confidence: 0.9 },
  back_box: null,
};

describeWithDb('the ai block across its writers (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let fake: FakeAiProvider;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens: Record<'admin' | 'contributor' | 'viewer', string> = { admin: '', contributor: '', viewer: '' };

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const extract = (who: keyof typeof tokens = 'contributor', body: object = { front: FRONT, back: BACK }) =>
    http().post('/api/secrets/cards/extract').set(as(who)).send(body);

  async function setAi(patch: Record<string, unknown>) {
    const row = await prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });
    const value = row.value as Record<string, any>;
    await prisma.systemSettings.update({
      where: { key: 'global' },
      data: { value: { ...value, ai: { ...value.ai, ...patch } } },
    });
    // The policy is cached for five seconds; the admin routes invalidate it, a direct write does not.
    await new Promise((resolve) => setTimeout(resolve, 5_200));
  }

  async function createUser(who: keyof typeof tokens, orgRole: 'org_admin' | 'contributor' | 'viewer', systemAdmin = false) {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDefault: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: orgRole } });
    const user = await prisma.user.create({ data: { email: `${who}@example.test`, providerDisplayName: 'Person A' } });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, roleId: role.id, status: 'active' } });
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: {
        userId: user.id,
        name: `${who} token`,
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(0, 8),
        durationValue: 30,
        durationUnit: 'days',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
    if (systemAdmin) {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    }
    tokens[who] = raw;
  }

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();

    const input = platformSeedInputFrom(
      { permissions: platformPermissionCatalog(PERMISSION_OPTIONS), settings: DEFAULT_SYSTEM_SETTINGS },
      { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' },
    );
    await seedPlatform(prisma as unknown as SeedPrisma, input);

    await prisma.systemSettings.update({
      where: { key: 'global' },
      data: {
        value: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: {
            enabled: true,
            keyPolicy: 'byok_with_org_fallback',
            providers: { openai: { enabled: true } },
            cardExtractModel: MODEL,
            limits: { perUser: { requestsPerDay: 3, requestsPerMinute: 9 } },
            defaults: { allowBackgroundRuns: false, allowRealtime: false },
            usageRetentionDays: 77,
          },
        },
      },
    });
    await prisma.aiModel.create({
      data: {
        provider: 'openai',
        modelId: MODEL,
        capabilities: FAKE_TEXT_MODEL_CAPABILITIES as never,
        capabilitySource: 'admin_override',
        enabled: true,
      },
    });
    await createUser('admin', 'org_admin', true);
    await createUser('contributor', 'contributor');
    await createUser('viewer', 'viewer');

    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
      savedEnv[key] = process.env[key];
    }
    Object.assign(process.env, deployment.env);
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // The fake stands in for the OpenAI adapter (the registry has no unregister).
    fake = new FakeAiProvider({
      id: 'openai',
      models: [MODEL],
      validKeys: [DEPLOYMENT_KEY],
      responses: () => ({ outputText: JSON.stringify(MODEL_ANSWER) }),
    });
    (app.get(AiProviderRegistry, { strict: false }) as unknown as { adapters: Map<string, unknown> }).adapters.set('openai', fake);

    // The deployment key, at the address Vault has stored it since E4.2.
    await app.get(CredentialsService, { strict: false }).setSecret('ai', 'openai', DEPLOYMENT_KEY, {
      label: 'AI provider key (OpenAI)',
    });
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

  const aiBlock = async () => ((await prisma.systemSettings.findUniqueOrThrow({ where: { key: 'global' } })).value as Record<string, any>).ai;

  it('PATCH /api/system-settings { ai: { cardExtractModel } } changes only that field', async () => {
    // The served policy (stored values over the defaults) before and after.
    const before = (await http().get('/api/system-settings').set(as('admin'))).body.data.ai;

    const res = await http().patch('/api/system-settings').set(as('admin')).send({ ai: { cardExtractModel: 'gpt-4o-mini' } });

    expect(res.status).toBe(200);
    const after = (await http().get('/api/system-settings').set(as('admin'))).body.data.ai;
    expect(after.cardExtractModel).toBe('gpt-4o-mini');
    expect({ ...after, cardExtractModel: before.cardExtractModel }).toEqual(before);
    expect(await aiBlock()).toMatchObject({
      enabled: true,
      keyPolicy: 'byok_with_org_fallback',
      providers: { openai: { enabled: true } },
      limits: { perUser: { requestsPerDay: 3, requestsPerMinute: 9 } },
      defaults: { allowBackgroundRuns: false },
      usageRetentionDays: 77,
    });
    expect(res.body.data.ai.cardExtractModel).toBe('gpt-4o-mini');
  });

  it('PUT /api/admin/ai/config (the packaged AI config page) keeps cardExtractModel, and changes what it is sent', async () => {
    const get = await http().get('/api/admin/ai/config').set(as('admin'));
    expect(get.status).toBe(200);
    const view = get.body.data;
    // What the page sends back: the editable policy, not the response-only descriptors.
    const body = {
      enabled: view.enabled,
      keyPolicy: view.keyPolicy,
      logPromptContent: view.logPromptContent,
      defaults: view.defaults,
      usageRetentionDays: 120,
      hostedTools: view.hostedTools,
      limits: { ...view.limits, perUser: { ...view.limits.perUser, requestsPerDay: 11 } },
      deploymentKeyServesOrgs: view.deploymentKeyServesOrgs,
      providers: Object.fromEntries(
        (view.providers as Array<{ id: string; enabled: boolean }>).map((p) => [p.id, { enabled: p.enabled }]),
      ),
    };

    const put = await http().put('/api/admin/ai/config').set(as('admin')).send(body);

    expect(put.status).toBe(200);
    const after = await aiBlock();
    expect(after.cardExtractModel).toBe('gpt-4o-mini');
    expect(after).toMatchObject({ usageRetentionDays: 120, limits: { perUser: { requestsPerDay: 11 } } });
  });

  it('the other admin AI writes (provider key, model toggle) leave the block, cardExtractModel included, alone', async () => {
    const before = await aiBlock();

    const key = await http().put('/api/admin/ai/providers/openai/key').set(as('admin')).send({ apiKey: DEPLOYMENT_KEY });
    expect([200, 201, 204]).toContain(key.status);

    const model = await prisma.aiModel.findFirstOrThrow({ where: { modelId: MODEL } });
    const patch = await http().patch(`/api/admin/ai/models/${model.id}`).set(as('admin')).send({ enabled: true });
    expect(patch.status).toBe(200);

    expect(await aiBlock()).toEqual(before);
  });

  it('GET /api/ai/status carries features.cardExtract, the flag the web reads', async () => {
    const res = await http().get('/api/ai/status').set(as('contributor'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: true, features: { cardExtract: true } });
  });
});
