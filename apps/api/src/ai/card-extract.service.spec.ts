import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/mocks/prisma.mock';
import {
  buildRawExtraction,
  createMockAiVisionProvider,
} from '../../test/mocks/ai-vision-provider.mock';

import {
  AI_CARD_EXTRACT_ACTION,
  AI_ERROR_CODES,
  BURST_MAX_IN_WINDOW,
  MAX_IMAGE_DATA_URL_LENGTH,
} from './ai.constants';
import { AiBurstLimiterService } from './ai-burst-limiter.service';
import { AiConfigService } from './ai-config.service';
import { AiException } from './ai.errors';
import { CardExtractService } from './card-extract.service';
import {
  AI_VISION_PROVIDER,
  AiProviderError,
  AiVisionProvider,
  CardCropBox,
} from './providers/vision-provider.interface';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const API_KEY = 'sk-live-SUPERSECRETKEY-9999';
const PAN = '4111111111111111';
const CARDHOLDER = 'ADA LOVELACE';

const FRONT_IMAGE = 'data:image/jpeg;base64,QUJDRA==';
const BACK_IMAGE = 'data:image/png;base64,RUZHSA==';

const user: RequestUser = {
  id: 'user-aaa',
  email: 'ada@example.com',
  roles: ['contributor'],
  permissions: ['secrets:write'],
  isActive: true,
};

function goodFront() {
  return buildRawExtraction(
    {
      cardholder_name: CARDHOLDER,
      number: '4111 1111 1111 1111',
      exp_month: '7',
      exp_year: '27',
      card_network: 'visa',
      card_kind: 'credit',
    },
    {
      cardholder_name: 0.92,
      number: 0.99,
      exp_month: 0.9,
      exp_year: 0.9,
      card_network: 0.95,
      card_kind: 0.6,
    },
  );
}

function box(overrides: Partial<CardCropBox> = {}): CardCropBox {
  return {
    x: 0.1,
    y: 0.2,
    width: 0.8,
    height: 0.5,
    quarterTurns: 0,
    confidence: 0.9,
    ...overrides,
  };
}

/** Extract the AiException from a rejected call. */
async function rejection(promise: Promise<unknown>): Promise<AiException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiException);
    return error as AiException;
  }
  throw new Error('Expected the call to reject');
}

describe('CardExtractService', () => {
  let service: CardExtractService;
  let prisma: MockPrismaService;
  let vision: jest.Mocked<AiVisionProvider>;
  let limiter: AiBurstLimiterService;
  let config: jest.Mocked<Pick<AiConfigService, 'resolveForExtraction' | 'isReady'>>;

  /** Every string passed to any Nest logger during a test. */
  let logLines: string[];

  beforeEach(async () => {
    prisma = createMockPrismaService();
    vision = createMockAiVisionProvider();
    limiter = new AiBurstLimiterService();
    config = {
      resolveForExtraction: jest.fn().mockResolvedValue({
        model: 'gpt-4o-mini',
        maxCallsPerUserPerDay: 50,
        apiKey: API_KEY,
      }),
      isReady: jest.fn().mockResolvedValue(true),
    } as any;

    prisma.auditEvent.count.mockResolvedValue(0 as never);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
    prisma.auditEvent.findUnique.mockResolvedValue({
      meta: { imageCount: 1, model: 'gpt-4o-mini', outcome: 'started' },
    } as never);
    prisma.auditEvent.update.mockResolvedValue({ id: 'audit-1' } as never);

    logLines = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logLines.push(args.map((a) => String(a)).join(' '));
        });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CardExtractService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiConfigService, useValue: config },
        { provide: AiBurstLimiterService, useValue: limiter },
        { provide: AI_VISION_PROVIDER, useValue: vision },
      ],
    }).compile();

    service = module.get(CardExtractService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns normalized fields, confidence, warnings, model and partial', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.fields).toMatchObject({
        cardholder_name: CARDHOLDER,
        number: PAN,
        exp_month: '07',
        exp_year: '2027',
        card_network: 'Visa',
        card_kind: 'Credit',
      });
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.partial).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(result.confidence.number).toBeCloseTo(0.99);
    });

    it('never returns a cvv field', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(Object.keys(result.fields)).not.toContain('cvv');
      expect(Object.keys(result.confidence)).not.toContain('cvv');
    });

    it('calls the provider exactly once with both sides when a back image is supplied', async () => {
      vision.extractCard.mockResolvedValue(
        buildRawExtraction(
          {
            cardholder_name: CARDHOLDER,
            number: '4111 1111 1111 1111',
            issuing_bank: 'Example Bank',
          },
          {
            cardholder_name: 0.92,
            number: 0.99,
            issuing_bank: 0.88,
          },
        ),
      );

      const result = await service.extract(
        { front: FRONT_IMAGE, back: BACK_IMAGE },
        user,
      );

      expect(vision.extractCard).toHaveBeenCalledTimes(1);
      expect(vision.extractCard).toHaveBeenCalledWith(
        [
          { side: 'front', dataUrl: FRONT_IMAGE },
          { side: 'back', dataUrl: BACK_IMAGE },
        ],
        expect.objectContaining({ apiKey: API_KEY, model: 'gpt-4o-mini' }),
      );

      expect(result.fields.cardholder_name).toBe(CARDHOLDER);
      expect(result.fields.number).toBe(PAN);
      expect(result.fields.issuing_bank).toBe('Example Bank');
    });

    it('calls the provider exactly once with just the front when no back image is supplied', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      await service.extract({ front: FRONT_IMAGE }, user);

      expect(vision.extractCard).toHaveBeenCalledTimes(1);
      expect(vision.extractCard).toHaveBeenCalledWith(
        [{ side: 'front', dataUrl: FRONT_IMAGE }],
        expect.objectContaining({ apiKey: API_KEY, model: 'gpt-4o-mini' }),
      );
    });

    it('persists no card data - the only row written is the audit event', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      await service.extract({ front: FRONT_IMAGE }, user);

      expect(prisma.secret.create).not.toHaveBeenCalled();
      expect(prisma.secretVersion.create).not.toHaveBeenCalled();
      expect(prisma.storageObject.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Degraded results
  // ---------------------------------------------------------------------------

  describe('degraded results', () => {
    it('marks partial when every field came back null', async () => {
      vision.extractCard.mockResolvedValue(buildRawExtraction());

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.partial).toBe(true);
      expect(Object.values(result.fields).every((v) => v === null)).toBe(true);
      expect(result.warnings.join(' ')).toContain('Nothing could be read');
    });

    it('handles a photo that is not a card at all', async () => {
      vision.extractCard.mockResolvedValue(
        buildRawExtraction({}, {}, {
          warnings: ['This image does not appear to be a payment card.'],
        }),
      );

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.partial).toBe(true);
      expect(result.warnings).toContain(
        'This image does not appear to be a payment card.',
      );
    });

  });

  // ---------------------------------------------------------------------------
  // Crop boxes
  // ---------------------------------------------------------------------------

  describe('crop boxes', () => {
    it('surfaces the front box on the result', async () => {
      vision.extractCard.mockResolvedValue(
        buildRawExtraction({}, {}, { frontBox: box() }),
      );

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.crops.front).toEqual(box());
    });

    it('forces the back box to null when only a front image was sent, even if the provider returned one', async () => {
      // A back box for an image that was never sent would be a hallucination
      // by definition - the client has nothing to crop it against.
      vision.extractCard.mockResolvedValue(
        buildRawExtraction({}, {}, { frontBox: box(), backBox: box({ x: 0.4 }) }),
      );

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.crops.back).toBeNull();
    });

    it('passes the back box through when both sides were sent', async () => {
      vision.extractCard.mockResolvedValue(
        buildRawExtraction({}, {}, {
          frontBox: box(),
          backBox: box({ x: 0.4, quarterTurns: 2 }),
        }),
      );

      const result = await service.extract(
        { front: FRONT_IMAGE, back: BACK_IMAGE },
        user,
      );

      expect(result.crops.back).toEqual(box({ x: 0.4, quarterTurns: 2 }));
    });

    it('leaves both crops null when the model located no card in either image', async () => {
      vision.extractCard.mockResolvedValue(buildRawExtraction());

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.crops).toEqual({ front: null, back: null });
    });
  });

  // ---------------------------------------------------------------------------
  // Configuration failures
  // ---------------------------------------------------------------------------

  describe('configuration failures', () => {
    it('propagates AI_NOT_CONFIGURED without calling the provider', async () => {
      const notConfigured = new AiException(
        503,
        AI_ERROR_CODES.NOT_CONFIGURED,
        'off',
      );
      config.resolveForExtraction.mockRejectedValue(notConfigured);

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(503);
      expect(error.code).toBe(AI_ERROR_CODES.NOT_CONFIGURED);
      expect(vision.extractCard).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it('propagates AI_KEY_UNREADABLE without calling the provider', async () => {
      config.resolveForExtraction.mockRejectedValue(
        new AiException(503, AI_ERROR_CODES.KEY_UNREADABLE, 'bad key'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(503);
      expect(error.code).toBe(AI_ERROR_CODES.KEY_UNREADABLE);
      expect(vision.extractCard).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  describe('input validation', () => {
    const badBodies: Array<[string, unknown]> = [
      ['missing front', {}],
      ['not an object', 'nope'],
      ['pdf data url', { front: 'data:application/pdf;base64,QUJDRA==' }],
      ['gif data url', { front: 'data:image/gif;base64,QUJDRA==' }],
      ['bare base64, no data url prefix', { front: 'QUJDRA==' }],
      ['http url instead of a data url', { front: 'https://example.com/card.jpg' }],
      ['non-base64 characters', { front: 'data:image/jpeg;base64,!!!!' }],
      ['bad back while front is fine', { front: FRONT_IMAGE, back: 'nope' }],
    ];

    it.each(badBodies)('400 AI_INVALID_IMAGE for %s', async (_label, body) => {
      const error = await rejection(service.extract(body, user));

      expect(error.getStatus()).toBe(400);
      expect(error.code).toBe(AI_ERROR_CODES.INVALID_IMAGE);
      expect(vision.extractCard).not.toHaveBeenCalled();
    });

    it('400 AI_INVALID_IMAGE for an oversized image string', async () => {
      const prefix = 'data:image/jpeg;base64,';
      const oversized =
        prefix + 'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH - prefix.length + 1);

      const error = await rejection(service.extract({ front: oversized }, user));

      expect(error.getStatus()).toBe(400);
      expect(error.code).toBe(AI_ERROR_CODES.INVALID_IMAGE);
    });

    it('does not echo image bytes back in the error message', async () => {
      const error = await rejection(
        service.extract(
          { front: 'data:image/jpeg;base64,SECRET_IMAGE_BYTES!!' },
          user,
        ),
      );

      expect(error.code).toBe(AI_ERROR_CODES.INVALID_IMAGE);
      expect(JSON.stringify(error.getResponse())).not.toContain(
        'SECRET_IMAGE_BYTES',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('429 AI_RATE_LIMITED with a Retry-After hint once the burst window fills', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
        await service.extract({ front: FRONT_IMAGE }, user);
      }

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(429);
      expect(error.code).toBe(AI_ERROR_CODES.RATE_LIMITED);
      expect(error.retryAfterSeconds).toBeGreaterThan(0);
      expect(vision.extractCard).toHaveBeenCalledTimes(BURST_MAX_IN_WINDOW);
    });

    it('the burst window is per user', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
        await service.extract({ front: FRONT_IMAGE }, user);
      }

      await expect(
        service.extract({ front: FRONT_IMAGE }, { ...user, id: 'user-bbb' }),
      ).resolves.toBeDefined();
    });

    it('429 AI_QUOTA_EXCEEDED when the durable daily budget is spent', async () => {
      prisma.auditEvent.count.mockResolvedValue(50 as never);

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(429);
      expect(error.code).toBe(AI_ERROR_CODES.QUOTA_EXCEEDED);
      expect(vision.extractCard).not.toHaveBeenCalled();
    });

    it('counts the daily budget from audit_events for this user in the last 24h', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      await service.extract({ front: FRONT_IMAGE }, user);

      expect(prisma.auditEvent.count).toHaveBeenCalledWith({
        where: {
          actorUserId: user.id,
          action: AI_CARD_EXTRACT_ACTION,
          createdAt: { gte: expect.any(Date) },
        },
      });

      const { createdAt } = (prisma.auditEvent.count as jest.Mock).mock
        .calls[0][0].where;
      const ageMs = Date.now() - (createdAt.gte as Date).getTime();
      expect(ageMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5_000);
      expect(ageMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
    });

    it('429 AI_QUOTA_EXCEEDED when an admin has set the budget to zero', async () => {
      config.resolveForExtraction.mockResolvedValue({
        model: 'gpt-4o-mini',
        maxCallsPerUserPerDay: 0,
        apiKey: API_KEY,
      });

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.code).toBe(AI_ERROR_CODES.QUOTA_EXCEEDED);
      expect(prisma.auditEvent.count).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Upstream failure taxonomy
  // ---------------------------------------------------------------------------

  describe('upstream failure taxonomy', () => {
    it('fails the whole request when the single provider call rejects, even with a back image supplied', async () => {
      // There is no per-side fallback anymore: front and back go out in ONE
      // call, so a rejection there fails the whole extraction.
      vision.extractCard.mockRejectedValue(
        new AiProviderError('unavailable', 'boom'),
      );

      const error = await rejection(
        service.extract({ front: FRONT_IMAGE, back: BACK_IMAGE }, user),
      );

      expect(vision.extractCard).toHaveBeenCalledTimes(1);
      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe(AI_ERROR_CODES.UPSTREAM_UNAVAILABLE);
    });

    it('upstream 401/403 becomes 502 AI_UPSTREAM_AUTH, never a client 401', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('auth', 'Invalid API key provided: sk-live-***'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      // The regression this guards: apps/web treats a 401 as an expired
      // session, refreshes, retries and can sign the user out.
      expect(error.getStatus()).not.toBe(401);
      expect(error.getStatus()).not.toBe(403);
      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe(AI_ERROR_CODES.UPSTREAM_AUTH);
    });

    it('upstream 429 stays a 429 and carries the provider Retry-After', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('rate_limited', 'slow down', 42),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(429);
      expect(error.code).toBe(AI_ERROR_CODES.UPSTREAM_RATE_LIMITED);
      expect(error.retryAfterSeconds).toBe(42);
    });

    it('upstream 5xx becomes 502 AI_UPSTREAM_UNAVAILABLE', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('unavailable', 'Vision provider is temporarily unavailable'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe(AI_ERROR_CODES.UPSTREAM_UNAVAILABLE);
    });

    it('network failure becomes 502 AI_UPSTREAM_UNAVAILABLE', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('unavailable', 'Vision provider unreachable (network error)'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe(AI_ERROR_CODES.UPSTREAM_UNAVAILABLE);
    });

    it('timeout becomes 502 AI_UPSTREAM_UNAVAILABLE', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('unavailable', 'Vision provider unreachable (timeout)'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe(AI_ERROR_CODES.UPSTREAM_UNAVAILABLE);
    });

    it('unparseable model output becomes 422 AI_EXTRACTION_FAILED', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError(
          'invalid_output',
          'Vision provider returned data that did not match the requested schema',
        ),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe(AI_ERROR_CODES.EXTRACTION_FAILED);
    });

    it('a model refusal becomes 422 AI_EXTRACTION_FAILED', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('invalid_output', 'The model declined to read this image'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe(AI_ERROR_CODES.EXTRACTION_FAILED);
    });

    it('an unclassified throw becomes 502, never a leaked 500 message', async () => {
      vision.extractCard.mockRejectedValue(
        new Error('ECONNRESET at 10.0.0.5:443 while sending sk-live-...'),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));

      expect(error.getStatus()).toBe(502);
      expect(JSON.stringify(error.getResponse())).not.toContain('ECONNRESET');
      expect(JSON.stringify(error.getResponse())).not.toContain('sk-live');
    });

    it('never echoes the upstream error body to the client', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError(
          'invalid_output',
          `Provider said: {"error":{"message":"invalid image data:image/jpeg;base64,${'A'.repeat(50)}"}}`,
        ),
      );

      const error = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      const body = JSON.stringify(error.getResponse());

      expect(body).not.toContain('data:image');
      expect(body).not.toContain('Provider said');
    });
  });

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  describe('audit', () => {
    it('records the attempt before the provider is called so budget is reserved', async () => {
      const order: string[] = [];
      prisma.auditEvent.create.mockImplementation((async () => {
        order.push('audit');
        return { id: 'audit-1' };
      }) as never);
      vision.extractCard.mockImplementation(async () => {
        order.push('provider');
        return goodFront();
      });

      await service.extract({ front: FRONT_IMAGE }, user);

      expect(order).toEqual(['audit', 'provider']);
    });

    it('writes imageCount, model, durationMs and outcome, and nothing else', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      await service.extract({ front: FRONT_IMAGE, back: BACK_IMAGE }, user);

      const created = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0];
      expect(created.data).toMatchObject({
        actorUserId: user.id,
        action: AI_CARD_EXTRACT_ACTION,
      });
      expect(created.data.meta).toMatchObject({
        imageCount: 2,
        model: 'gpt-4o-mini',
      });

      const updated = (prisma.auditEvent.update as jest.Mock).mock.calls[0][0];
      expect(updated.data.meta).toMatchObject({
        outcome: 'success',
        durationMs: expect.any(Number),
      });
      expect(Object.keys(updated.data.meta).sort()).toEqual([
        'durationMs',
        'imageCount',
        'model',
        'outcome',
      ]);
    });

    it('records outcome=partial when nothing was legible', async () => {
      vision.extractCard.mockResolvedValue(buildRawExtraction());

      await service.extract({ front: FRONT_IMAGE }, user);

      const updated = (prisma.auditEvent.update as jest.Mock).mock.calls[0][0];
      expect(updated.data.meta.outcome).toBe('partial');
    });

    it('records the failure outcome and error code on an upstream failure', async () => {
      vision.extractCard.mockRejectedValue(new AiProviderError('auth', 'nope'));

      await rejection(service.extract({ front: FRONT_IMAGE }, user));

      const updated = (prisma.auditEvent.update as jest.Mock).mock.calls[0][0];
      expect(updated.data.meta).toMatchObject({
        outcome: 'upstream_error',
        errorCode: AI_ERROR_CODES.UPSTREAM_AUTH,
      });
    });

    it('never writes an image, a card value or the API key into audit meta', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      await service.extract({ front: FRONT_IMAGE, back: BACK_IMAGE }, user);

      const written = JSON.stringify([
        (prisma.auditEvent.create as jest.Mock).mock.calls,
        (prisma.auditEvent.update as jest.Mock).mock.calls,
      ]);

      for (const forbidden of [
        API_KEY,
        'sk-live',
        PAN,
        '4111',
        CARDHOLDER,
        'data:image',
        FRONT_IMAGE,
        BACK_IMAGE,
        'Visa',
        '2027',
      ]) {
        expect(written).not.toContain(forbidden);
      }
    });

    it('still returns a result if the audit write fails', async () => {
      prisma.auditEvent.create.mockRejectedValue(new Error('db down') as never);
      vision.extractCard.mockResolvedValue(goodFront());

      await expect(
        service.extract({ front: FRONT_IMAGE }, user),
      ).resolves.toMatchObject({ fields: { number: PAN } });
    });
  });

  // ---------------------------------------------------------------------------
  // Logging hygiene
  // ---------------------------------------------------------------------------

  describe('logging hygiene', () => {
    it('logs no key, image or card value on a successful extraction', async () => {
      vision.extractCard.mockResolvedValue(goodFront());

      await service.extract({ front: FRONT_IMAGE, back: BACK_IMAGE }, user);

      const logged = logLines.join('\n');
      for (const forbidden of [
        API_KEY,
        'sk-live',
        PAN,
        CARDHOLDER,
        'data:image',
      ]) {
        expect(logged).not.toContain(forbidden);
      }
    });

    it('logs no key on an upstream auth failure', async () => {
      vision.extractCard.mockRejectedValue(
        new AiProviderError('auth', `Incorrect API key provided: ${API_KEY}`),
      );

      await rejection(service.extract({ front: FRONT_IMAGE }, user));

      const logged = logLines.join('\n');
      expect(logged).toContain('rejected the configured API key');
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain('sk-live');
    });
  });
});
