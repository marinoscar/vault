import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { PLATFORM_PRISMA, encryptSecret } from '@marinoscar/platform-api/core';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from '@marinoscar/platform-api/identity';

import { AiBurstLimiterService } from '../../src/ai/ai-burst-limiter.service';
import { AiConfigService } from '../../src/ai/ai-config.service';
import { CardExtractController } from '../../src/ai/card-extract.controller';
import { CardExtractService } from '../../src/ai/card-extract.service';
import { AI_VISION_PROVIDER } from '../../src/ai/providers/vision-provider.interface';
import { PrismaService } from '../../src/prisma/prisma.service';
import '../../src/platform/credentials/credentials.config';
import { buildRawExtraction } from '../mocks/ai-vision-provider.mock';

// Card extraction over real HTTP, on the REAL AiConfigService / CredentialsService
// with the platform cipher (SECRETS_ENCRYPTION_KEY from .env.test). Only Prisma,
// the settings service (the `ai` namespace), the guards and the OpenAI provider are
// stubbed. Issue #80 (E4.2). The admin side (PATCH/GET /api/system-settings, the
// write-only key) is covered by test/settings/settings-routes.db.spec.ts and
// src/platform/settings/ai-key-projection.interceptor.spec.ts (E4.1).

const PLAINTEXT = 'sk-test-0123456789abcdefghijklmnop';
const LEGACY_CIPHERTEXT = 'legacy-ciphertext-must-not-appear';
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

describe('AI key in the credential store (HTTP)', () => {
  let app: NestFastifyApplication;
  let credentialRow: { secret: string; hint: string | null; label: string | null; updatedAt: Date } | null;
  let settingsValue: Record<string, unknown>;
  let extractCard: jest.Mock;
  let prisma: Record<string, any>;

  const admin = {
    id: 'admin-1',
    email: 'admin@example.test',
    roles: ['Admin'],
    permissions: ['system_settings:read', 'system_settings:write', 'secrets:write'],
    isActive: true,
  };

  const settingsRow = () => ({
    id: 'settings-1',
    key: 'global',
    value: settingsValue,
    version: 1,
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    updatedByUser: null,
  });

  beforeEach(async () => {
    credentialRow = null;
    settingsValue = {
      ai: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxCallsPerUserPerDay: 50,
        apiKey: null,
      },
    };
    extractCard = jest.fn().mockResolvedValue(buildRawExtraction({ cardNumber: '4242424242424242' } as never));

    prisma = {
      systemSettings: {
        findUnique: jest.fn().mockImplementation(async () => settingsRow()),
        update: jest.fn().mockImplementation(async (args: any) => {
          settingsValue = args.data.value;
          return { ...settingsRow(), version: 2 };
        }),
      },
      credential: {
        findUnique: jest.fn().mockImplementation(async (args: any) => {
          if (!credentialRow) return null;
          return args.select?.secret
            ? { secret: credentialRow.secret }
            : { purpose: 'ai', name: 'openai', createdAt: new Date(), updatedByUserId: null, ...credentialRow };
        }),
        upsert: jest.fn().mockImplementation(async (args: any) => {
          credentialRow = {
            secret: args.create.secret,
            hint: args.create.hint,
            label: args.create.label,
            updatedAt: new Date('2026-04-01T00:00:00Z'),
          };
        }),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = credentialRow ? 1 : 0;
          credentialRow = null;
          return { count };
        }),
      },
      auditEvent: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CardExtractController],
      providers: [
        { provide: SystemSettingsService, useValue: { getNamespace: async () => settingsValue.ai } },
        AiConfigService,
        AiBurstLimiterService,
        CardExtractService,
        CredentialsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PLATFORM_PRISMA, useValue: prisma },
        { provide: AI_VISION_PROVIDER, useValue: { extractCard } },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = admin;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const extract = () =>
    app.inject({
      method: 'POST',
      url: '/api/secrets/cards/extract',
      payload: { front: IMAGE },
    });

  it('card extraction resolves the key from the credential store and hands it to the provider', async () => {
    credentialRow = {
      secret: encryptSecret(PLAINTEXT, 'ai'),
      hint: '••••mnop',
      label: null,
      updatedAt: new Date(),
    };

    const res = await extract();

    expect(res.statusCode).toBe(200);
    expect(extractCard).toHaveBeenCalledTimes(1);
    expect(extractCard.mock.calls[0][1]).toMatchObject({ apiKey: PLAINTEXT, model: 'gpt-4o-mini' });
    // ...and the key does not come back in the response.
    expect(res.body).not.toContain(PLAINTEXT);
  });

  it('card extraction is "not configured" (503) while the key still sits in the legacy block', async () => {
    (settingsValue.ai as any).apiKey = {
      ciphertext: LEGACY_CIPHERTEXT,
      iv: 'iv',
      authTag: 'tag',
      last4: 'zzzz',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const res = await extract();

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AI_NOT_CONFIGURED');
    expect(extractCard).not.toHaveBeenCalled();
  });

  it('card extraction answers AI_KEY_UNREADABLE (503) when the credential will not decrypt', async () => {
    credentialRow = {
      secret: encryptSecret(PLAINTEXT, 'some-other-purpose'),
      hint: '••••mnop',
      label: null,
      updatedAt: new Date(),
    };

    const res = await extract();

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AI_KEY_UNREADABLE');
    expect(res.body).not.toContain(PLAINTEXT);
  });
});
