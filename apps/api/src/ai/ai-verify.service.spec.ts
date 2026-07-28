import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/mocks/prisma.mock';
import {
  buildVerifyModelResult,
  createMockAiVisionProvider,
} from '../../test/mocks/ai-vision-provider.mock';

import {
  AI_VERIFY_ACTION,
  AI_CARD_EXTRACT_ACTION,
  AI_ERROR_CODES,
  OPENAI_VERIFY_TIMEOUT_MS,
  VERIFY_BURST_MAX_IN_WINDOW,
} from './ai.constants';
import { AiBurstLimiterService } from './ai-burst-limiter.service';
import { AiConfigService } from './ai-config.service';
import { AiVerifyService } from './ai-verify.service';
import { AiException } from './ai.errors';
import {
  AI_VISION_PROVIDER,
  AiProviderError,
  AiVisionProvider,
} from './providers/vision-provider.interface';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const API_KEY = 'sk-live-SUPERSECRETKEY-9999';
const MODEL = 'gpt-5.4-mini';

const admin: RequestUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  roles: ['Admin'],
  permissions: ['system_settings:write'],
  isActive: true,
};

async function rejection(promise: Promise<unknown>): Promise<AiException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiException);
    return error as AiException;
  }
  throw new Error('Expected the call to reject');
}

// -----------------------------------------------------------------------------

describe('AiVerifyService', () => {
  let service: AiVerifyService;
  let prisma: MockPrismaService;
  let aiConfig: jest.Mocked<Pick<AiConfigService, 'resolveForVerification'>>;
  let vision: jest.Mocked<AiVisionProvider>;
  let burstLimiter: AiBurstLimiterService;
  let logLines: string[];

  beforeEach(async () => {
    prisma = createMockPrismaService();
    aiConfig = { resolveForVerification: jest.fn() } as any;
    vision = createMockAiVisionProvider();

    // No test in this file may reach the network: the provider is a mock bound
    // at the token, exactly as the app binds the real one.
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AiVerifyService,
        AiBurstLimiterService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiConfigService, useValue: aiConfig },
        { provide: AI_VISION_PROVIDER, useValue: vision },
      ],
    }).compile();

    service = moduleRef.get(AiVerifyService);
    burstLimiter = moduleRef.get(AiBurstLimiterService);
    burstLimiter.reset();

    aiConfig.resolveForVerification.mockResolvedValue({
      model: MODEL,
      maxCallsPerUserPerDay: 50,
      apiKey: API_KEY,
    });
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as any);

    logLines = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logLines.push(args.map((a) => String(a)).join(' '));
        });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  // ---------------------------------------------------------------------------
  // Success
  // ---------------------------------------------------------------------------

  describe('a working key and model', () => {
    it('returns ok with the resolved model and proven image support', async () => {
      vision.verifyModel.mockResolvedValue(
        buildVerifyModelResult({ model: 'gpt-5.4-mini-2026-03-01' }),
      );

      const result = await service.verify(admin);

      expect(result).toMatchObject({
        ok: true,
        model: 'gpt-5.4-mini-2026-03-01',
        imageSupport: true,
        adaptedParameters: [],
      });
      expect((result as any).durationMs).toBeGreaterThanOrEqual(0);
    });

    it('probes with the configured model and the verify timeout', async () => {
      await service.verify(admin);

      expect(vision.verifyModel).toHaveBeenCalledWith({
        apiKey: API_KEY,
        model: MODEL,
        timeoutMs: OPENAI_VERIFY_TIMEOUT_MS,
      });
    });

    it('surfaces parameters the adaptive retry had to drop', async () => {
      vision.verifyModel.mockResolvedValue(
        buildVerifyModelResult({ droppedParameters: ['temperature'] }),
      );

      const result = await service.verify(admin);

      expect(result).toMatchObject({ ok: true, adaptedParameters: ['temperature'] });
    });
  });

  // ---------------------------------------------------------------------------
  // Model override
  // ---------------------------------------------------------------------------

  describe('model override', () => {
    const CANDIDATE = 'gpt-5.4-nano';

    it('probes the supplied model instead of the stored one', async () => {
      await service.verify(admin, { model: CANDIDATE });

      expect(vision.verifyModel).toHaveBeenCalledWith({
        apiKey: API_KEY,
        model: CANDIDATE,
        timeoutMs: OPENAI_VERIFY_TIMEOUT_MS,
      });
    });

    it('falls back to the stored model when no override is given', async () => {
      await service.verify(admin, {});

      expect(vision.verifyModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: MODEL }),
      );
    });

    it('falls back to the stored model when there is no body at all', async () => {
      // The controller's parameter is optional in practice - a bodyless POST
      // reaches the service as `undefined` if the pipe is ever bypassed.
      await service.verify(admin);

      expect(vision.verifyModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: MODEL }),
      );
    });

    it('probes the override against the STORED key, not some other credential', async () => {
      await service.verify(admin, { model: CANDIDATE });

      expect(vision.verifyModel).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: API_KEY }),
      );
    });

    it('does not persist the override', async () => {
      // "Test before saving" is the whole point: a probe must leave the stored
      // configuration untouched, whether it succeeds or fails.
      await service.verify(admin, { model: CANDIDATE });
      vision.verifyModel.mockRejectedValue(new AiProviderError('auth', 'no'));
      await service.verify(admin, { model: CANDIDATE });

      expect(prisma.systemSettings.update).not.toHaveBeenCalled();
      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
      expect(prisma.systemSettings.create).not.toHaveBeenCalled();
    });

    it('echoes the model that was actually probed, never the stored one', async () => {
      // A result that named the stored model while having probed a different
      // one would be read as a verdict on the wrong model.
      vision.verifyModel.mockResolvedValue(
        buildVerifyModelResult({ model: `${CANDIDATE}-2026-05-01` }),
      );

      const result = await service.verify(admin, { model: CANDIDATE });

      expect(result).toMatchObject({ ok: true, model: `${CANDIDATE}-2026-05-01` });
      expect((result as any).model).not.toBe(MODEL);
    });

    it('echoes the overridden name on a failure, not the stored one', async () => {
      vision.verifyModel.mockRejectedValue(
        new AiProviderError('unavailable', 'no', undefined, 'model_not_found'),
      );

      const result = await service.verify(admin, { model: CANDIDATE });

      expect(result).toMatchObject({
        ok: false,
        reason: 'model_not_found',
        model: CANDIDATE,
      });
    });

    it('sends an unfamiliar-looking name upstream rather than second-guessing it', async () => {
      // No pattern, prefix or allowlist check exists in this path on purpose:
      // the next model family will not look like today's, and an unknown name
      // deserves the provider's `model_not_found`, not our 400.
      const odd = 'some-provider::weird_model.v9@preview';

      await service.verify(admin, { model: odd });

      expect(vision.verifyModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: odd }),
      );
    });

    it('spends the same burst allowance as a stored-model check', async () => {
      for (let i = 0; i < VERIFY_BURST_MAX_IN_WINDOW; i++) {
        await service.verify(admin, { model: `candidate-${i}` });
      }

      const error = await rejection(service.verify(admin, { model: CANDIDATE }));

      expect(error.getStatus()).toBe(429);
    });
  });

  // ---------------------------------------------------------------------------
  // Failure reasons
  // ---------------------------------------------------------------------------

  describe('failure reasons', () => {
    const providerError = (
      kind: 'auth' | 'rate_limited' | 'unavailable' | 'invalid_output',
      detail?: any,
    ) => new AiProviderError(kind, 'upstream said no', undefined, detail);

    it.each([
      ['invalid key', providerError('auth'), 'invalid_key'],
      ['unknown model', providerError('unavailable', 'model_not_found'), 'model_not_found'],
      [
        'model without vision',
        providerError('unavailable', 'model_no_image_support'),
        'model_no_image_support',
      ],
      [
        'model without structured outputs',
        providerError('unavailable', 'model_no_structured_output'),
        'model_no_structured_output',
      ],
      ['spent quota', providerError('rate_limited', 'quota'), 'quota'],
      ['plain rate limit', providerError('rate_limited'), 'quota'],
      ['network failure', providerError('unavailable'), 'network'],
      ['unrecognised upstream failure', providerError('invalid_output'), 'unknown'],
      ['a non-provider error', new Error('boom'), 'unknown'],
    ])('maps a %s onto its own reason', async (_label, thrown, reason) => {
      vision.verifyModel.mockRejectedValue(thrown);

      const result = await service.verify(admin);

      expect(result).toMatchObject({ ok: false, reason, model: MODEL });
      expect((result as any).message.length).toBeGreaterThan(0);
    });

    it('answers with HTTP 200, never a 401, when the key is rejected', async () => {
      // Load-bearing: apps/web/src/services/api.ts treats any 401 as an expired
      // session and will refresh, retry, and can log the user out. An admin
      // pasting a bad OpenAI key must not be able to sign themselves out.
      vision.verifyModel.mockRejectedValue(providerError('auth'));

      const result = await service.verify(admin);

      expect(result.ok).toBe(false);
      expect(result).not.toBeInstanceOf(AiException);
    });

    it('gives a different, actionable message for each reason', async () => {
      const messages = new Set<string>();

      for (const thrown of [
        providerError('auth'),
        providerError('unavailable', 'model_not_found'),
        providerError('unavailable', 'model_no_image_support'),
        providerError('unavailable', 'model_no_structured_output'),
        providerError('rate_limited', 'quota'),
        providerError('unavailable'),
        providerError('invalid_output'),
      ]) {
        vision.verifyModel.mockRejectedValue(thrown);
        const result = await service.verify(admin);
        messages.add((result as any).message);
        burstLimiter.reset();
      }

      expect(messages.size).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // Gating
  // ---------------------------------------------------------------------------

  describe('gating', () => {
    it('propagates the 503 when nothing is configured', async () => {
      const notConfigured = new AiException(
        503 as any,
        AI_ERROR_CODES.NOT_CONFIGURED,
        'nope',
      );
      aiConfig.resolveForVerification.mockRejectedValue(notConfigured);

      await expect(service.verify(admin)).rejects.toBe(notConfigured);
      expect(vision.verifyModel).not.toHaveBeenCalled();
    });

    it('rate limits repeated presses of the button', async () => {
      for (let i = 0; i < VERIFY_BURST_MAX_IN_WINDOW; i++) {
        await service.verify(admin);
      }

      const error = await rejection(service.verify(admin));

      expect(error.getStatus()).toBe(429);
      expect(error.retryAfterSeconds).toBeGreaterThan(0);
      expect(vision.verifyModel).toHaveBeenCalledTimes(VERIFY_BURST_MAX_IN_WINDOW);
    });

    it('does not spend the provider call when rate limited', async () => {
      for (let i = 0; i < VERIFY_BURST_MAX_IN_WINDOW; i++) {
        await service.verify(admin);
      }
      vision.verifyModel.mockClear();

      await rejection(service.verify(admin));

      expect(vision.verifyModel).not.toHaveBeenCalled();
    });

    it('limits each admin independently', async () => {
      for (let i = 0; i < VERIFY_BURST_MAX_IN_WINDOW; i++) {
        await service.verify(admin);
      }

      await expect(
        service.verify({ ...admin, id: 'admin-2' }),
      ).resolves.toMatchObject({ ok: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  describe('audit', () => {
    it('records who, when, the model and the outcome', async () => {
      await service.verify(admin);

      expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.auditEvent.create.mock.calls[0][0];
      expect(data.actorUserId).toBe(admin.id);
      expect(data.action).toBe(AI_VERIFY_ACTION);
      expect(data.meta).toMatchObject({ model: MODEL, outcome: 'ok' });
      expect((data.meta as any).durationMs).toBeGreaterThanOrEqual(0);
    });

    it('marks a stored-model check as such', async () => {
      await service.verify(admin);

      const { data } = prisma.auditEvent.create.mock.calls[0][0];
      expect(data.meta).toMatchObject({ model: MODEL, modelSource: 'stored' });
    });

    it('records the tested name and flags it as an override', async () => {
      // An admin trying five candidate names must leave a trail that says
      // which five, not five rows that look like checks of the saved config.
      await service.verify(admin, { model: 'gpt-5.4-nano' });

      const { data } = prisma.auditEvent.create.mock.calls[0][0];
      expect(data.meta).toMatchObject({
        model: 'gpt-5.4-nano',
        modelSource: 'override',
        outcome: 'ok',
      });
    });

    it('leaves one distinguishable row per candidate name', async () => {
      for (const candidate of ['model-a', 'model-b', 'model-c']) {
        await service.verify(admin, { model: candidate });
      }

      const audited = prisma.auditEvent.create.mock.calls.map(
        (call: any) => call[0].data.meta,
      );
      expect(audited).toHaveLength(3);
      expect(audited.map((m: any) => m.model)).toEqual([
        'model-a',
        'model-b',
        'model-c',
      ]);
      expect(audited.every((m: any) => m.modelSource === 'override')).toBe(true);
    });

    it('records the override on a failed check too', async () => {
      vision.verifyModel.mockRejectedValue(
        new AiProviderError('unavailable', 'no', undefined, 'model_not_found'),
      );

      await service.verify(admin, { model: 'gpt-5.4-nano' });

      const { data } = prisma.auditEvent.create.mock.calls[0][0];
      expect(data.meta).toMatchObject({
        model: 'gpt-5.4-nano',
        modelSource: 'override',
        outcome: 'model_not_found',
      });
    });

    it('records the reason on a failure', async () => {
      vision.verifyModel.mockRejectedValue(
        new AiProviderError('unavailable', 'no', undefined, 'model_not_found'),
      );

      await service.verify(admin);

      const { data } = prisma.auditEvent.create.mock.calls[0][0];
      expect(data.meta).toMatchObject({ outcome: 'model_not_found' });
    });

    it('does NOT use the card-extraction action, so it cannot eat a user budget', async () => {
      // CardExtractService counts AI_CARD_EXTRACT_ACTION rows to enforce the
      // daily spend budget. An admin testing a key ten times must not consume
      // ten card scans.
      await service.verify(admin);

      const { data } = prisma.auditEvent.create.mock.calls[0][0];
      expect(data.action).not.toBe(AI_CARD_EXTRACT_ACTION);
    });

    it('still answers the admin when the audit write fails', async () => {
      prisma.auditEvent.create.mockRejectedValue(new Error('db down'));

      await expect(service.verify(admin)).resolves.toMatchObject({ ok: true });
      expect(logLines.join('\n')).toContain('Failed to record AI verification');
    });
  });

  // ---------------------------------------------------------------------------
  // Credential hygiene
  // ---------------------------------------------------------------------------

  describe('credential hygiene', () => {
    const forbidden = [API_KEY, 'sk-live', 'SUPERSECRETKEY', '9999'];

    it('never puts key material in a successful response', async () => {
      const body = JSON.stringify(await service.verify(admin));

      for (const secret of forbidden) {
        expect(body).not.toContain(secret);
      }
    });

    it('never puts key material in a failure response', async () => {
      for (const thrown of [
        new AiProviderError('auth', `Incorrect API key provided: ${API_KEY}`),
        new AiProviderError('unavailable', 'no', undefined, 'model_not_found'),
        new Error(`upstream echoed ${API_KEY}`),
      ]) {
        vision.verifyModel.mockRejectedValue(thrown);

        const body = JSON.stringify(await service.verify(admin));

        for (const secret of forbidden) {
          expect(body).not.toContain(secret);
        }
        burstLimiter.reset();
      }
    });

    it('never puts key material in the audit payload', async () => {
      vision.verifyModel.mockRejectedValue(
        new AiProviderError('auth', `Incorrect API key provided: ${API_KEY}`),
      );

      await service.verify(admin);

      const payload = JSON.stringify(
        prisma.auditEvent.create.mock.calls[0][0],
      );
      for (const secret of forbidden) {
        expect(payload).not.toContain(secret);
      }
    });

    it('never puts key material in a log line', async () => {
      vision.verifyModel.mockRejectedValue(
        new AiProviderError('auth', `Incorrect API key provided: ${API_KEY}`),
      );

      await service.verify(admin);

      const logged = logLines.join('\n');
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain('sk-live');
      expect(logged).not.toContain('SUPERSECRETKEY');
    });

    it('never echoes the upstream message back to the caller', async () => {
      // OpenAI reflects request fragments in its errors. The response message
      // must come from our fixed table, not from the provider.
      const upstream = 'Incorrect API key provided: sk-live-OTHERKEY-1234.';
      vision.verifyModel.mockRejectedValue(
        new AiProviderError('auth', upstream),
      );

      const result = await service.verify(admin);

      expect((result as any).message).not.toContain(upstream);
      expect((result as any).message).not.toContain('sk-live');
    });
  });
});
