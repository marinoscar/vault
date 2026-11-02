import { Logger } from '@nestjs/common';

import { AiError } from '@marinoscar/platform-api/ai';
import { RequestUser } from '@marinoscar/platform-api/identity';

import { AI_ERROR_CODES, CARD_EXTRACT_FEATURE, MAX_IMAGE_DATA_URL_LENGTH } from './ai.constants';
import { AiException } from './ai.errors';
import { CardExtractService } from './card-extract.service';
import type { CardExtractionModelOutput } from './card-extraction.schema';

const PAN = '4111111111111111';
const FRONT_IMAGE = 'data:image/jpeg;base64,QUJDRA==';
const BACK_IMAGE = 'data:image/png;base64,RUZHSA==';

const user: RequestUser = {
  id: 'user-aaa',
  email: 'ada@example.test',
  roles: ['contributor'],
  permissions: ['secrets:write', 'ai:use'],
  isActive: true,
  activeOrgId: 'org-1',
};

const zeroScores = {
  cardholder_name: 0,
  number: 0,
  exp_month: 0,
  exp_year: 0,
  card_network: 0,
  card_kind: 0,
  issuing_bank: 0,
  notes: 0,
};

function modelOutput(overrides: Partial<CardExtractionModelOutput> = {}): CardExtractionModelOutput {
  return {
    cardholder_name: 'ADA LOVELACE',
    number: PAN,
    exp_month: '7',
    exp_year: '27',
    card_network: 'Visa',
    card_kind: 'Credit',
    issuing_bank: null,
    notes: null,
    confidence: { ...zeroScores, cardholder_name: 0.9, number: 0.99, exp_month: 0.9, exp_year: 0.9, card_network: 0.9, card_kind: 0.6 },
    warnings: [],
    front_box: { x: 0.1, y: 0.2, width: 0.8, height: 0.5, quarter_turns: 0, confidence: 0.9 },
    back_box: { x: 0, y: 0, width: 1, height: 1, quarter_turns: 5, confidence: 0.8 },
    ...overrides,
  };
}

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
  let respondStructured: jest.Mock;
  let forUser: jest.Mock;
  let logLines: string[];

  beforeEach(() => {
    respondStructured = jest.fn().mockResolvedValue({ parsed: modelOutput(), model: 'gpt-4o-mini' });
    forUser = jest.fn().mockReturnValue({ respondStructured });
    service = new CardExtractService({ forUser } as never, { getNamespace: jest.fn() } as never);

    logLines = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map((a) => String(a)).join(' '));
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  describe('the platform call', () => {
    it('runs as the user, in the active organization, under the card_extract feature', async () => {
      await service.extract({ front: FRONT_IMAGE }, user);
      expect(forUser).toHaveBeenCalledWith('user-aaa', { orgId: 'org-1', feature: CARD_EXTRACT_FEATURE });
    });

    it('sends every image in ONE call, as image parts of a single user message', async () => {
      await service.extract({ front: FRONT_IMAGE, back: BACK_IMAGE }, user);

      expect(respondStructured).toHaveBeenCalledTimes(1);
      const req = respondStructured.mock.calls[0][0];
      const parts = req.input[0].content;
      expect(parts.filter((p: { type: string }) => p.type === 'image').map((p: { url: string }) => p.url)).toEqual([
        FRONT_IMAGE,
        BACK_IMAGE,
      ]);
      expect(req.instructions).toContain('NEVER read, transcribe or return a card security code');
    });

    it('does not name a model: the target resolver picks it', async () => {
      await service.extract({ front: FRONT_IMAGE }, user);
      expect(respondStructured.mock.calls[0][0].model).toBeUndefined();
    });
  });

  describe('results', () => {
    it('normalizes the answer and repairs the boxes', async () => {
      const result = await service.extract({ front: FRONT_IMAGE, back: BACK_IMAGE }, user);

      expect(result.fields.number).toBe(PAN);
      expect(result.fields.card_network).toBe('Visa');
      expect(result.crops.front).toEqual({ x: 0.1, y: 0.2, width: 0.8, height: 0.5, quarterTurns: 0, confidence: 0.9 });
      expect(result.crops.back?.quarterTurns).toBe(1);
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.partial).toBe(false);
    });

    it('nulls the back box when no back image was sent', async () => {
      const result = await service.extract({ front: FRONT_IMAGE }, user);
      expect(result.crops.back).toBeNull();
    });

    it('never returns a security code, even when the model sent one in a field or in notes', async () => {
      respondStructured.mockResolvedValue({
        parsed: {
          ...modelOutput({ notes: 'Support 555-0100\nCVV 123' }),
          cvv: '123',
          security_code_2: '9999',
        },
        model: 'gpt-4o-mini',
      });

      const result = await service.extract({ front: FRONT_IMAGE }, user);

      expect(result.fields.cvv).toBeNull();
      expect(result.fields.security_code_2).toBeNull();
      expect(result.fields.notes).toBe('Support 555-0100');
      expect(JSON.stringify(result)).not.toContain('123"');
    });

    it('marks an all-null answer partial', async () => {
      respondStructured.mockResolvedValue({
        parsed: modelOutput({
          cardholder_name: null,
          number: null,
          exp_month: null,
          exp_year: null,
          card_network: null,
          card_kind: null,
          confidence: zeroScores,
          front_box: null,
          back_box: null,
        }),
        model: 'gpt-4o-mini',
      });
      const result = await service.extract({ front: FRONT_IMAGE }, user);
      expect(result.partial).toBe(true);
      expect(result.crops.front).toBeNull();
    });
  });

  describe('input validation', () => {
    it.each([
      ['no body', undefined],
      ['a non-image data URL', { front: 'data:text/plain;base64,QUJD' }],
      ['an http URL', { front: 'https://example.test/card.jpg' }],
      ['an oversize image', { front: `data:image/jpeg;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH)}` }],
    ])('rejects %s with AI_INVALID_IMAGE before any AI call', async (_name, body) => {
      const err = await rejection(service.extract(body, user));
      expect(err.code).toBe(AI_ERROR_CODES.INVALID_IMAGE);
      expect(err.getStatus()).toBe(400);
      expect(forUser).not.toHaveBeenCalled();
    });

    it('names the offending fields but never echoes image bytes', async () => {
      const err = await rejection(service.extract({ front: 'data:text/plain;base64,SECRETBYTES' }, user));
      expect(err.message).toContain('front');
      expect(err.message).not.toContain('SECRETBYTES');
    });
  });

  describe('error mapping', () => {
    const failWith = (error: unknown) => respondStructured.mockRejectedValue(error);

    it.each(['AI_DISABLED', 'AI_PROVIDER_DISABLED', 'AI_KEY_REQUIRED', 'AI_MODEL_NOT_ENABLED', 'AI_MODEL_NOT_REACHABLE'] as const)(
      'maps %s to 503 AI_NOT_CONFIGURED',
      async (code) => {
        failWith(new AiError(code, 'x'));
        const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
        expect(err.code).toBe(AI_ERROR_CODES.NOT_CONFIGURED);
        expect(err.getStatus()).toBe(503);
      },
    );

    it('maps a per-day cap to 429 AI_QUOTA_EXCEEDED with Retry-After', async () => {
      failWith(new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 90_000, details: { limit: 'perUser.requestsPerDay' } }));
      const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      expect(err.code).toBe(AI_ERROR_CODES.QUOTA_EXCEEDED);
      expect(err.getStatus()).toBe(429);
      expect(err.retryAfterSeconds).toBe(90);
    });

    it('maps a per-minute cap to 429 AI_RATE_LIMITED', async () => {
      failWith(new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 20_000, details: { limit: 'perUser.requestsPerMinute' } }));
      const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      expect(err.code).toBe(AI_ERROR_CODES.RATE_LIMITED);
      expect(err.retryAfterSeconds).toBe(20);
    });

    it('maps a provider throttle (no platform limit named) to AI_UPSTREAM_RATE_LIMITED', async () => {
      failWith(new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 5_000 }));
      const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      expect(err.code).toBe(AI_ERROR_CODES.UPSTREAM_RATE_LIMITED);
    });

    it('maps a rejected key to 502 AI_UPSTREAM_AUTH, never 401/403', async () => {
      failWith(new AiError('AI_KEY_INVALID', 'x'));
      const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      expect(err.code).toBe(AI_ERROR_CODES.UPSTREAM_AUTH);
      expect(err.getStatus()).toBe(502);
    });

    it.each(['AI_STRUCTURED_OUTPUT_INVALID', 'AI_CONTENT_FILTERED'] as const)('maps %s to 422 AI_EXTRACTION_FAILED', async (code) => {
      failWith(new AiError(code, 'x'));
      const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      expect(err.code).toBe(AI_ERROR_CODES.EXTRACTION_FAILED);
      expect(err.getStatus()).toBe(422);
    });

    it('maps an unavailable provider and an unclassified error to 502 AI_UPSTREAM_UNAVAILABLE', async () => {
      failWith(new AiError('AI_PROVIDER_UNAVAILABLE', 'x'));
      expect((await rejection(service.extract({ front: FRONT_IMAGE }, user))).code).toBe(AI_ERROR_CODES.UPSTREAM_UNAVAILABLE);

      failWith(new Error('socket hang up with SECRETBYTES'));
      const err = await rejection(service.extract({ front: FRONT_IMAGE }, user));
      expect(err.code).toBe(AI_ERROR_CODES.UPSTREAM_UNAVAILABLE);
      expect(err.message).not.toContain('SECRETBYTES');
    });
  });

  describe('privacy', () => {
    it('logs neither image bytes nor card values on a failure', async () => {
      respondStructured.mockRejectedValue(new AiError('AI_STRUCTURED_OUTPUT_INVALID', `bad ${PAN} ${FRONT_IMAGE}`));
      await rejection(service.extract({ front: FRONT_IMAGE }, user));
      const logs = logLines.join('\n');
      expect(logs).not.toContain(PAN);
      expect(logs).not.toContain('QUJDRA');
    });
  });
});
