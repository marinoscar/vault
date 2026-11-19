// =============================================================================
// Real-Postgres test: identity-document scanning over the platform AI slice (issue #210, IDOC-7)
// =============================================================================
//
// Mirrors `card-extract.db.spec.ts`: a migrated, seeded deployment (ordinary application role),
// the full app, and the AI test kit's `FakeAiProvider` standing in for the OpenAI adapter.
// Proves, end to end:
//
//   * one passport scan writes exactly one `ai_usage_events` row with feature `document_extract`,
//     on the model `ai.documentExtractModel` names;
//   * PRIVACY: no image byte and no extracted value (canaries) reaches `ai_usage_events`,
//     `ai_runs`, `audit_events`, `credentials` or the captured logs; nothing is persisted;
//   * the gates: a viewer, an invalid body (AI_INVALID_IMAGE), AI off (AI_DISABLED).
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
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
const MODEL = 'fake-document-model';
// Canary values (invented, ICAO specimen state UTO): none may reach a row or a log line.
const CANARY_NUMBER = 'L898902C3';
const CANARY_SURNAME = 'CANARYSURNAME';
const CANARY_PLACE = 'Canaryville';
const MRZ_LINES = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
const PAGE = `data:image/jpeg;base64,${Buffer.from('PAGE-IMAGE-BYTES-MARKER').toString('base64')}`;
const BACK = `data:image/png;base64,${Buffer.from('BACK-IMAGE-BYTES-MARKER').toString('base64')}`;
const IMAGE_MARKERS = [Buffer.from('PAGE-IMAGE-BYTES-MARKER').toString('base64'), Buffer.from('BACK-IMAGE-BYTES-MARKER').toString('base64')];

const conf = (names: string[], value: number) => Object.fromEntries(names.map((n) => [n, value]));
const MODEL_ANSWER = {
  surname: CANARY_SURNAME,
  given_names: 'ANNA MARIA',
  passport_number: CANARY_NUMBER,
  passport_type: 'P',
  issuing_country: 'UTO',
  nationality: 'UTO',
  date_of_birth: '1974-08-12',
  place_of_birth: CANARY_PLACE,
  sex: 'F',
  issue_date: null,
  expiry_date: '2012-04-15',
  issuing_authority: null,
  personal_number: null,
  mrz_lines: MRZ_LINES,
  confidence: {
    ...conf(['surname', 'given_names', 'passport_number', 'passport_type', 'issuing_country', 'nationality', 'date_of_birth', 'place_of_birth', 'sex', 'expiry_date', 'mrz_lines'], 0.9),
    ...conf(['issue_date', 'issuing_authority', 'personal_number'], 0),
  },
  warnings: [],
  data_page_box: { x: 0, y: 0, width: 1, height: 1, quarter_turns: 0, confidence: 0.9 },
  back_box: null,
};

// A driver license (issue #214): the model's reading and the values the browser decoded from the
// PDF417 barcode. Invented: Person A, a made-up license number, the placeholder state ZZ.
const BARCODE_NUMBER = 'X1234567';
const BARCODE_FAMILY = 'BARCODECANARY';
const LICENSE_ANSWER = {
  document_kind: 'Driver License',
  document_kind_confidence: 0.95,
  holder_name: 'PERSON BARCODECANARY',
  document_number: 'X1284567',
  issuing_country: 'USA',
  issuing_authority: 'ZZ',
  date_of_birth: null,
  issue_date: null,
  expiry_date: null,
  attributes: [],
  mrz_lines: null,
  barcode_present: true,
  confidence: { holder_name: 0.9, document_number: 0.9, issuing_country: 0.9, issuing_authority: 0.9, date_of_birth: 0, issue_date: 0, expiry_date: 0, mrz_lines: 0 },
  warnings: [],
  front_box: { x: 0, y: 0, width: 1, height: 1, quarter_turns: 0, confidence: 0.9 },
  back_box: null,
};
const BARCODE = {
  format: 'aamva',
  fields: { documentNumber: BARCODE_NUMBER, familyName: BARCODE_FAMILY, givenNames: 'PERSON', birthDate: '1990-01-31', state: 'ZZ' },
};
let modelAnswer: object = MODEL_ANSWER;

describeWithDb('document scanning over the platform AI slice (real Postgres, fake provider)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let fake: FakeAiProvider;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens: Record<'contributor' | 'viewer', string> = { contributor: '', viewer: '' };
  const logLines: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const extract = (who: keyof typeof tokens = 'contributor', body: object = { documentType: 'passport', images: { data_page: PAGE, back: BACK } }) =>
    http().post('/api/secrets/documents/extract').set(as(who)).send(body);

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
            cardExtractModel: 'fake-card-model',
            documentExtractModel: MODEL,
            limits: {},
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

    fake = new FakeAiProvider({
      id: 'openai',
      models: [MODEL],
      validKeys: [DEPLOYMENT_KEY],
      responses: () => ({ outputText: JSON.stringify(modelAnswer) }),
    });
    (app.get(AiProviderRegistry, { strict: false }) as unknown as { adapters: Map<string, unknown> }).adapters.set('openai', fake);

    await app.get(CredentialsService, { strict: false }).setSecret('ai', 'openai', DEPLOYMENT_KEY, {
      label: 'AI provider key (OpenAI)',
    });

    // Capture every Nest log line from here on.
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
  }, 240_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('scans a passport on the document model and writes exactly one document_extract usage row', async () => {
    const before = await asSystem((tx) => tx.aiUsageEvent.count());
    const res = await extract();

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ documentType: 'passport', model: MODEL, partial: false });
    expect(res.body.data.fields).toMatchObject({ passport_number: CANARY_NUMBER, mrz: MRZ_LINES.join('\n') });
    expect(res.body.data.checks).toEqual([{ id: 'mrz', ok: true, failed: [] }]);
    expect(res.body.data.crops.back).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(DEPLOYMENT_KEY);

    const call = fake.calls.find((c) => c.method === 'responses.create');
    expect(call?.apiKey).toBe(DEPLOYMENT_KEY);
    expect(call?.request?.model).toBe(MODEL);

    const usage = await asSystem((tx) => tx.aiUsageEvent.findMany());
    expect(usage.length - before).toBe(1);
    expect(usage.at(-1)).toMatchObject({ feature: 'document_extract', provider: 'openai', modelId: MODEL });
  });

  it('cross-checks a decoded driver license barcode, which never reaches the provider (issue #214)', async () => {
    modelAnswer = LICENSE_ANSWER;
    try {
      const callsBefore = fake.calls.length;
      const res = await extract('contributor', { documentType: 'id_document', images: { front: PAGE, back: BACK }, barcode: BARCODE });
      expect(res.status).toBe(200);
      expect(res.body.data.fields).toMatchObject({ document_number: BARCODE_NUMBER, date_of_birth: '1990-01-31' });
      expect(res.body.data.checks).toEqual([{ id: 'aamva', ok: false, failed: ['document_number'] }]);
      expect(res.body.data.barcodePresent).toBe(true);
      const sent = JSON.stringify(fake.calls.slice(callsBefore).map((c) => c.request));
      expect(sent).not.toContain(BARCODE_NUMBER);
      expect(sent).not.toContain('1990-01-31');
    } finally {
      modelAnswer = MODEL_ANSWER;
    }
  });

  it('persists no image byte and no extracted value anywhere, and logs none', async () => {
    const everything = JSON.stringify({
      usage: await asSystem((tx) => tx.aiUsageEvent.findMany()),
      runs: await asSystem((tx) => tx.aiRun.findMany()),
      audits: await prisma.auditEvent.findMany(),
      credentials: await prisma.credential.findMany(),
      logs: logLines,
    });
    for (const canary of [CANARY_NUMBER, CANARY_SURNAME, CANARY_PLACE, MRZ_LINES[1], BARCODE_NUMBER, BARCODE_FAMILY, DEPLOYMENT_KEY, 'PAGE-IMAGE-BYTES-MARKER', ...IMAGE_MARKERS, 'data:image']) {
      expect(everything).not.toContain(canary);
    }
    expect(await asSystem((tx) => tx.aiRun.count())).toBe(0);
    expect(await prisma.secret.count()).toBe(0);
  });

  it('refuses a viewer and an invalid body (a passport without its data page)', async () => {
    expect((await extract('viewer')).status).toBe(403);
    const bad = await extract('contributor', { documentType: 'passport', images: { back: BACK } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('AI_INVALID_IMAGE');
  });

  it('with AI switched off the route answers 403 AI_DISABLED', async () => {
    await setAi({ enabled: false });
    const res = await extract();
    expect(res.status).toBe(403);
    expect(res.body.details?.reason).toBe('AI_DISABLED');
    await setAi({ enabled: true });
  }, 30_000);
});
