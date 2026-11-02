// =============================================================================
// Real-Postgres test: card extraction over the platform AI slice (issue #87, E8.1)
// =============================================================================
//
// A migrated, seeded deployment (ordinary application role), the full app, and the
// AI test kit's `FakeAiProvider` standing in for the OpenAI adapter. Proves, end to end:
//
//   * import and renew: the scan route runs the whole platform gate pipeline under the
//     deployment key stored at ('ai', 'openai'), returns the normalized fields and never a
//     security code, and writes one `ai_usage_events` row under the `card_extract` feature;
//   * PRIVACY: no image byte, card number or cardholder name reaches `ai_usage_events`,
//     `ai_runs`, `audit_events` or `credentials`, and the key is never in a response;
//   * the platform caps replace the old budget: `ai.limits.perUser.requestsPerDay` answers
//     429 AI_QUOTA_EXCEEDED with Retry-After;
//   * the gates: AI off, no enabled model, a viewer, GET /api/ai/config staying open.
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

describeWithDb('card extraction over the platform AI slice (real Postgres, fake provider)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let fake: FakeAiProvider;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens: Record<'contributor' | 'viewer', string> = { contributor: '', viewer: '' };

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

  /** Reads the org-scoped AI tables the way the platform's system client does (transaction-local bypass). */
  async function asSystem<R>(fn: (tx: PrismaClient) => Promise<R>): Promise<R> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }

  async function createUser(who: keyof typeof tokens, orgRole: 'contributor' | 'viewer') {
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
            limits: { perUser: { requestsPerDay: 3 } },
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

  it('imports a card: normalized fields, crops, the model the admin chose, and no security code', async () => {
    const res = await extract();

    expect(res.status).toBe(200);
    expect(res.body.data.fields).toMatchObject({
      cardholder_name: CARDHOLDER,
      number: PAN,
      exp_month: '07',
      exp_year: '2030',
      card_network: 'Visa',
      cvv: null,
      security_code_2: null,
      notes: 'Customer service 555-0100',
    });
    expect(res.body.data.crops.front).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect(res.body.data.crops.back).toBeNull();
    expect(res.body.data.model).toBe(MODEL);
    expect(JSON.stringify(res.body)).not.toContain(DEPLOYMENT_KEY);

    const call = fake.calls.find((c) => c.method === 'responses.create');
    expect(call?.apiKey).toBe(DEPLOYMENT_KEY);
    expect(call?.request?.model).toBe(MODEL);
    const parts = (call!.request!.input as Array<{ content: Array<{ type: string; url?: string }> }>)[0].content;
    expect(parts.filter((p) => p.type === 'image').map((p) => p.url)).toEqual([FRONT, BACK]);
    expect(call!.request!.instructions).toContain('NEVER read, transcribe or return a card security code');
  });

  it('renews a card: a second scan with new photos is another governed call', async () => {
    const res = await extract('contributor', { front: BACK });
    expect(res.status).toBe(200);
    expect(res.body.data.fields.number).toBe(PAN);
    expect(res.body.data.crops.back).toBeNull();
  });

  it('records usage under the card_extract feature, and no image byte, card number or name anywhere', async () => {
    const usage = await asSystem((tx) => tx.aiUsageEvent.findMany());
    expect(usage.length).toBeGreaterThanOrEqual(2);
    expect(usage.every((row) => row.feature === 'card_extract' && row.provider === 'openai' && row.modelId === MODEL)).toBe(true);

    const everything = JSON.stringify({
      usage,
      runs: await asSystem((tx) => tx.aiRun.findMany()),
      audits: await prisma.auditEvent.findMany(),
      credentials: await prisma.credential.findMany(),
    });
    for (const secret of [PAN, CARDHOLDER, DEPLOYMENT_KEY, 'FRONT-IMAGE-BYTES-MARKER', ...IMAGE_MARKERS, 'data:image']) {
      expect(everything).not.toContain(secret);
    }
    expect(await asSystem((tx) => tx.aiRun.count())).toBe(0);
  });

  it('answers the platform per-user daily cap with 429 AI_QUOTA_EXCEEDED and Retry-After', async () => {
    const third = await extract();
    expect(third.status).toBe(200);

    const fourth = await extract();
    expect(fourth.status).toBe(429);
    expect(fourth.body.details?.reason ?? fourth.body.code).toBeDefined();
    expect(fourth.body.code).toBe('AI_QUOTA_EXCEEDED');
    expect(fourth.headers['retry-after']).toBeDefined();
  });

  it('refuses a viewer (no secrets:write, no ai:use) and an invalid payload', async () => {
    expect((await extract('viewer')).status).toBe(403);
    const bad = await extract('contributor', { front: 'not-an-image' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('AI_INVALID_IMAGE');
  });

  it('with AI switched off the route answers 403 AI_DISABLED and GET /api/ai/config says disabled', async () => {
    await setAi({ enabled: false });
    const res = await extract();
    expect(res.status).toBe(403);
    expect(res.body.details?.reason).toBe('AI_DISABLED');
    const config = await http().get('/api/ai/config').set(as('contributor'));
    expect(config.status).toBe(200);
    expect(config.body.data.enabled).toBe(false);
    await setAi({ enabled: true });
  }, 30_000);

  it('with the model not enabled in the catalogue the route answers 503 AI_NOT_CONFIGURED', async () => {
    await prisma.aiModel.updateMany({ where: { modelId: MODEL }, data: { enabled: false } });
    await setAi({ limits: {} });
    const res = await extract();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');
  }, 30_000);
});
