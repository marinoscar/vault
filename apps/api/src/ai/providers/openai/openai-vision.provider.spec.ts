import { Logger } from '@nestjs/common';

import {
  AiProviderError,
  ExtractCardOptions,
  VisionImage,
} from '../vision-provider.interface';
import { OpenAiVisionProvider } from './openai-vision.provider';
import {
  OPENAI_CARD_JSON_SCHEMA,
  OPENAI_CARD_SYSTEM_PROMPT,
} from './openai-card-schema';
import { CARD_KINDS, CARD_NETWORKS } from '../../../common/constants/card.constants';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const API_KEY = 'sk-live-SUPERSECRETKEY-9999';
const IMAGE_DATA = 'data:image/jpeg;base64,QUJDRA==';

const images: VisionImage[] = [{ side: 'front', dataUrl: IMAGE_DATA }];
const options: ExtractCardOptions = {
  apiKey: API_KEY,
  model: 'gpt-4o-mini',
  timeoutMs: 20_000,
};

function modelJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    cardholder_name: 'ADA LOVELACE',
    number: '4111 1111 1111 1111',
    exp_month: '07',
    exp_year: '27',
    card_network: 'Visa',
    card_kind: 'Credit',
    issuing_bank: 'Example Bank',
    security_code_2: null,
    confidence: {
      cardholder_name: 0.9,
      number: 0.99,
      exp_month: 0.9,
      exp_year: 0.9,
      card_network: 0.95,
      card_kind: 0.6,
      issuing_bank: 0.7,
      security_code_2: 0,
    },
    warnings: [],
    ...overrides,
  });
}

function okResponse(content: string, extras: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'gpt-4o-mini-2024-07-18',
      choices: [{ finish_reason: 'stop', message: { content } }],
      ...extras,
    }),
    text: async () => content,
    headers: new Headers(),
  } as unknown as Response;
}

function errorResponse(
  status: number,
  body = '{"error":{"message":"upstream"}}',
  headers: Record<string, string> = {},
) {
  return {
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

async function rejection(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiProviderError);
    return error as AiProviderError;
  }
  throw new Error('Expected the call to reject');
}

// -----------------------------------------------------------------------------

describe('OpenAiVisionProvider', () => {
  let provider: OpenAiVisionProvider;
  let fetchMock: jest.Mock;
  let logLines: string[];
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new OpenAiVisionProvider();
    fetchMock = jest.fn();
    // No test in this file is permitted to reach the network.
    global.fetch = fetchMock as unknown as typeof fetch;

    logLines = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logLines.push(args.map((a) => String(a)).join(' '));
        });
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Request shape
  // ---------------------------------------------------------------------------

  describe('request', () => {
    it('posts to the chat completions endpoint with a bearer token', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson()));

      await provider.extractCard(images, options);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('sends temperature 0 and a strict json_schema response format', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson()));

      await provider.extractCard(images, options);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.temperature).toBe(0);
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.response_format.json_schema.name).toBe('card_extraction');
    });

    it('sends the image as an image_url content part', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson()));

      await provider.extractCard(images, options);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const parts = body.messages[1].content;
      expect(parts).toContainEqual({
        type: 'image_url',
        image_url: { url: IMAGE_DATA, detail: 'high' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Schema contract
  // ---------------------------------------------------------------------------

  describe('json schema', () => {
    const schema = OPENAI_CARD_JSON_SCHEMA as any;

    it('never asks for a cvv', () => {
      const serialized = JSON.stringify(schema).toLowerCase();
      expect(Object.keys(schema.properties)).not.toContain('cvv');
      expect(Object.keys(schema.properties.confidence.properties)).not.toContain(
        'cvv',
      );
      expect(serialized).not.toContain('"cvv"');
    });

    it('instructs the model never to output a CVV', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain('NEVER output a CVV');
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain('security_code_2` is NOT the CVV');
    });

    it('instructs the model to return null rather than guess', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT.toLowerCase()).toContain(
        'return null for it rather than guessing',
      );
    });

    it('uses the shared CARD_NETWORKS / CARD_KINDS constants as the enums', () => {
      // A drift here means the user reviews an extraction and then eats a 400
      // from /api/secrets on save, because the seeded select options differ.
      expect(schema.properties.card_network.enum).toEqual([
        ...CARD_NETWORKS,
        null,
      ]);
      expect(schema.properties.card_kind.enum).toEqual([...CARD_KINDS, null]);
    });

    it('satisfies the strict-mode rules at every object level', () => {
      const assertStrict = (node: any, path: string) => {
        if (node?.type !== 'object') return;
        expect([path, node.additionalProperties]).toEqual([path, false]);
        expect([path, [...node.required].sort()]).toEqual([
          path,
          Object.keys(node.properties).sort(),
        ]);
        for (const [key, child] of Object.entries(node.properties)) {
          assertStrict(child, `${path}.${key}`);
        }
      };

      assertStrict(schema, 'root');
    });

    it('expresses nullable fields as type unions, not by omission', () => {
      for (const name of [
        'cardholder_name',
        'number',
        'exp_month',
        'exp_year',
        'card_network',
        'card_kind',
        'issuing_bank',
        'security_code_2',
      ]) {
        expect(schema.properties[name].type).toEqual(['string', 'null']);
        expect(schema.required).toContain(name);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Success
  // ---------------------------------------------------------------------------

  describe('success', () => {
    it('returns the parsed fields, confidence and warnings', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson()));

      const result = await provider.extractCard(images, options);

      expect(result.fields.cardholder_name).toBe('ADA LOVELACE');
      expect(result.fields.number).toBe('4111 1111 1111 1111');
      expect(result.fields.security_code_2).toBeNull();
      expect(result.confidence.number).toBeCloseTo(0.99);
      expect(result.warnings).toEqual([]);
      expect(result.model).toBe('gpt-4o-mini-2024-07-18');
    });

    it('normalizes empty strings to null', async () => {
      fetchMock.mockResolvedValue(
        okResponse(modelJson({ issuing_bank: '   ' })),
      );

      const result = await provider.extractCard(images, options);
      expect(result.fields.issuing_bank).toBeNull();
    });

    it('clamps out-of-range confidence scores', async () => {
      fetchMock.mockResolvedValue(
        okResponse(
          modelJson({
            confidence: {
              cardholder_name: 5,
              number: -3,
              exp_month: 0.5,
              exp_year: 0.5,
              card_network: 0.5,
              card_kind: 0.5,
              issuing_bank: 0.5,
              security_code_2: 0.5,
            },
          }),
        ),
      );

      const result = await provider.extractCard(images, options);
      expect(result.confidence.cardholder_name).toBe(1);
      expect(result.confidence.number).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Failure classification
  // ---------------------------------------------------------------------------

  describe('failure classification', () => {
    it.each([401, 403])('upstream %s classifies as auth', async (status) => {
      fetchMock.mockResolvedValue(errorResponse(status));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('auth');
    });

    it('upstream 429 classifies as rate_limited and reads Retry-After', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(429, '{"error":"slow down"}', { 'retry-after': '30' }),
      );

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('rate_limited');
      expect(error.retryAfterSeconds).toBe(30);
    });

    it.each([500, 502, 503])(
      'upstream %s classifies as unavailable',
      async (status) => {
        fetchMock.mockResolvedValue(errorResponse(status));

        const error = await rejection(provider.extractCard(images, options));
        expect(error.kind).toBe('unavailable');
      },
    );

    it('a network failure classifies as unavailable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('unavailable');
      expect(error.message).toContain('network error');
    });

    it('a timeout classifies as unavailable', async () => {
      const timeout = new Error('The operation was aborted due to timeout');
      timeout.name = 'TimeoutError';
      fetchMock.mockRejectedValue(timeout);

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('unavailable');
      expect(error.message).toContain('timeout');
    });

    it('an upstream 400 classifies as invalid_output, not auth', async () => {
      fetchMock.mockResolvedValue(errorResponse(400));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
    });
  });

  // ---------------------------------------------------------------------------
  // Malformed model output
  // ---------------------------------------------------------------------------

  describe('malformed model output', () => {
    it('rejects a refusal', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { refusal: 'I cannot help with that.' } }],
        }),
        text: async () => '',
        headers: new Headers(),
      } as unknown as Response);

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
      expect(error.message).toContain('declined');
    });

    it('rejects a truncated completion', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ finish_reason: 'length', message: { content: '{"num' } }],
        }),
        text: async () => '',
        headers: new Headers(),
      } as unknown as Response);

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
      expect(error.message).toContain('truncated');
    });

    it('rejects a non-JSON completion body', async () => {
      fetchMock.mockResolvedValue(okResponse('not json at all'));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
      expect(error.message).toContain('malformed JSON');
    });

    it('rejects JSON that is missing a required field', async () => {
      const partial = JSON.parse(modelJson());
      delete partial.number;
      fetchMock.mockResolvedValue(okResponse(JSON.stringify(partial)));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
      expect(error.message).toContain('did not match');
    });

    it('rejects JSON where a field has the wrong type', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson({ number: 4111 })));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
    });

    it('rejects an empty completion', async () => {
      fetchMock.mockResolvedValue(okResponse(''));

      const error = await rejection(provider.extractCard(images, options));
      expect(error.kind).toBe('invalid_output');
    });

    it('tolerates a missing confidence score by degrading it to 0', async () => {
      const loose = JSON.parse(modelJson());
      delete loose.confidence.issuing_bank;
      fetchMock.mockResolvedValue(okResponse(JSON.stringify(loose)));

      const result = await provider.extractCard(images, options);
      expect(result.confidence.issuing_bank).toBe(0);
      expect(result.fields.issuing_bank).toBe('Example Bank');
    });
  });

  // ---------------------------------------------------------------------------
  // Logging hygiene
  // ---------------------------------------------------------------------------

  describe('logging hygiene', () => {
    it('never logs the API key', async () => {
      fetchMock.mockResolvedValue(errorResponse(401, '{"error":"bad key"}'));

      await rejection(provider.extractCard(images, options));

      expect(logLines.join('\n')).not.toContain(API_KEY);
      expect(logLines.join('\n')).not.toContain('sk-live');
    });

    it('scrubs a reflected image out of a logged upstream error body', async () => {
      const reflected = JSON.stringify({
        error: {
          message: `Invalid image: data:image/jpeg;base64,${'Q'.repeat(400)}`,
        },
      });
      fetchMock.mockResolvedValue(errorResponse(400, reflected));

      await rejection(provider.extractCard(images, options));

      const logged = logLines.join('\n');
      expect(logged).toContain('[image redacted]');
      expect(logged).not.toContain('Q'.repeat(200));
      expect(logged).not.toContain('data:image/jpeg;base64,QQQ');
    });

    it('scrubs a long bare base64 blob out of a logged upstream error body', async () => {
      const blob = 'Z'.repeat(300);
      fetchMock.mockResolvedValue(errorResponse(500, `{"raw":"${blob}"}`));

      await rejection(provider.extractCard(images, options));

      expect(logLines.join('\n')).not.toContain(blob);
    });

    it('logs only the failing paths, never the values, on a schema mismatch', async () => {
      fetchMock.mockResolvedValue(
        okResponse(modelJson({ number: 4111111111111111 })),
      );

      await rejection(provider.extractCard(images, options));

      const logged = logLines.join('\n');
      expect(logged).toContain('number');
      expect(logged).not.toContain('4111111111111111');
      expect(logged).not.toContain('ADA LOVELACE');
    });
  });
});
