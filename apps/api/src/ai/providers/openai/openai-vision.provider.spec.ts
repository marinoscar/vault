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
import {
  ONE_PIXEL_PNG_DATA_URL,
  OPENAI_PROBE_SCHEMA_NAME,
} from './openai-probe';
import { CARD_KINDS, CARD_NETWORKS } from '../../../common/constants/card.constants';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const API_KEY = 'sk-live-SUPERSECRETKEY-9999';
const IMAGE_DATA = 'data:image/jpeg;base64,QUJDRA==';
const BACK_IMAGE_DATA = 'data:image/png;base64,RUZHSA==';

const images: VisionImage[] = [{ side: 'front', dataUrl: IMAGE_DATA }];
const frontAndBackImages: VisionImage[] = [
  { side: 'front', dataUrl: IMAGE_DATA },
  { side: 'back', dataUrl: BACK_IMAGE_DATA },
];
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
    notes: null,
    confidence: {
      cardholder_name: 0.9,
      number: 0.99,
      exp_month: 0.9,
      exp_year: 0.9,
      card_network: 0.95,
      card_kind: 0.6,
      issuing_bank: 0.7,
      security_code_2: 0,
      notes: 0,
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

    it('sends a single-image request as a preamble text part followed by one label + image pair', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson()));

      await provider.extractCard(images, options);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const parts = body.messages[1].content;

      expect(parts[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('1 photo(s) of ONE payment card'),
      });
      expect(parts[1]).toEqual({
        type: 'text',
        text: 'Image 1: intended to be the FRONT of the card.',
      });
      expect(parts[2]).toEqual({
        type: 'image_url',
        image_url: { url: IMAGE_DATA, detail: 'high' },
      });
      expect(parts).toHaveLength(3);
    });

    it('interleaves a label and image part per side, in order, for a multi-image request', async () => {
      fetchMock.mockResolvedValue(okResponse(modelJson()));

      await provider.extractCard(frontAndBackImages, options);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const parts = body.messages[1].content;

      expect(parts[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('2 photo(s) of ONE payment card'),
      });
      expect(parts[1]).toEqual({
        type: 'text',
        text: 'Image 1: intended to be the FRONT of the card.',
      });
      expect(parts[2]).toEqual({
        type: 'image_url',
        image_url: { url: IMAGE_DATA, detail: 'high' },
      });
      expect(parts[3]).toEqual({
        type: 'text',
        text: 'Image 2: intended to be the BACK of the card.',
      });
      expect(parts[4]).toEqual({
        type: 'image_url',
        image_url: { url: BACK_IMAGE_DATA, detail: 'high' },
      });
      expect(parts).toHaveLength(5);

      // Both image_url parts are present, each preceded by its own label.
      const imageUrls = parts
        .filter((p: any) => p.type === 'image_url')
        .map((p: any) => p.image_url.url);
      expect(imageUrls).toEqual([IMAGE_DATA, BACK_IMAGE_DATA]);
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

    it('instructs the model that values must be read, never invented, but still sets confidence 0 for nulls', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain(
        'Never derive, complete, or invent',
      );
      expect(OPENAI_CARD_SYSTEM_PROMPT.toLowerCase()).toContain(
        'set the confidence to 0 for every field you return as null',
      );
    });

    it('permits card_kind to be classified from product knowledge, capped at 0.6 with a mandatory warning', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain('card_kind');
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain('0.6');
      expect(OPENAI_CARD_SYSTEM_PROMPT.toLowerCase()).toContain('inferred');
    });

    it('documents that modern/metal cards may print the number on the back', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT).toMatch(/BACK/);
      expect(OPENAI_CARD_SYSTEM_PROMPT).toMatch(/metal/i);
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

    it('includes notes as a nullable string field, required at both the root and confidence level', () => {
      expect(schema.properties.notes.type).toEqual(['string', 'null']);
      expect(schema.required).toContain('notes');
      expect(schema.properties.confidence.properties.notes).toEqual({
        type: 'number',
        description: expect.any(String),
      });
      expect(schema.properties.confidence.required).toContain('notes');
    });

    it('instructs the model to gather auxiliary card text into notes, banning the PAN and security codes from it', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain('`notes`: gather any other useful printed text');
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain(
        'NEVER put the card number or any security code there',
      );
    });

    it('requires per-character honesty: null only when a character is genuinely unreadable, not merely difficult', () => {
      expect(OPENAI_CARD_SYSTEM_PROMPT).toContain(
        'Return null for a field ONLY when one or more of its characters are genuinely impossible to read',
      );
      expect(OPENAI_CARD_SYSTEM_PROMPT).not.toContain('null if not fully legible');
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

    it('truncates an over-long notes value at 1000 characters, not 200', async () => {
      const longNotes = 'A'.repeat(1500);
      fetchMock.mockResolvedValue(
        okResponse(modelJson({ notes: longNotes })),
      );

      const result = await provider.extractCard(images, options);
      expect(result.fields.notes).toHaveLength(1000);
      expect(result.fields.notes).toBe('A'.repeat(1000));
    });

    it('still truncates an ordinary field like issuing_bank at 200 characters', async () => {
      const longBankName = 'B'.repeat(500);
      fetchMock.mockResolvedValue(
        okResponse(modelJson({ issuing_bank: longBankName })),
      );

      const result = await provider.extractCard(images, options);
      expect(result.fields.issuing_bank).toHaveLength(200);
      expect(result.fields.issuing_bank).toBe('B'.repeat(200));
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

  // ---------------------------------------------------------------------------
  // Adaptive parameter retry
  //
  // These tests are the executable specification of the behaviour described in
  // openai-chat.client.ts. If they are deleted, the retry becomes untested code
  // that looks removable - which is exactly how a model family that rejects an
  // explicit temperature ends up failing 100% of extractions in production.
  // ---------------------------------------------------------------------------

  describe('adaptive parameter retry', () => {
    const temperatureRejected = () =>
      errorResponse(
        400,
        JSON.stringify({
          error: {
            message:
              "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) is supported.",
            type: 'invalid_request_error',
            param: 'temperature',
            code: 'unsupported_value',
          },
        }),
      );

    it('retries once without temperature and succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(temperatureRejected())
        .mockResolvedValueOnce(okResponse(modelJson()));

      const result = await provider.extractCard(images, options);

      expect(result.fields.cardholder_name).toBe('ADA LOVELACE');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const first = JSON.parse(fetchMock.mock.calls[0][1].body);
      const second = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(first.temperature).toBe(0);
      expect(second).not.toHaveProperty('temperature');
    });

    it('keeps the schema and the image on the retry', async () => {
      fetchMock
        .mockResolvedValueOnce(temperatureRejected())
        .mockResolvedValueOnce(okResponse(modelJson()));

      await provider.extractCard(images, options);

      const second = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(second.model).toBe('gpt-4o-mini');
      expect(second.response_format.json_schema.strict).toBe(true);
      expect(second.messages[1].content).toContainEqual({
        type: 'image_url',
        image_url: { url: IMAGE_DATA, detail: 'high' },
      });
    });

    it('logs that it happened, at warn, naming the parameter', async () => {
      fetchMock
        .mockResolvedValueOnce(temperatureRejected())
        .mockResolvedValueOnce(okResponse(modelJson()));

      await provider.extractCard(images, options);

      const logged = logLines.join('\n');
      expect(logged).toContain("rejected the 'temperature' parameter");
      expect(logged).toContain('retrying once without it');
    });

    it('does NOT retry a second time', async () => {
      // The retried request is rejected again, naming another droppable
      // parameter. One adaptive retry is the whole budget: a second would make
      // this a loop, and a loop against a paid API behind a user-facing button
      // is how a bad config turns into a bill.
      fetchMock
        .mockResolvedValueOnce(temperatureRejected())
        .mockResolvedValueOnce(
          errorResponse(
            400,
            JSON.stringify({
              error: {
                message:
                  "Unsupported parameter: 'top_p' is not supported with this model.",
                type: 'invalid_request_error',
                param: 'top_p',
                code: 'unsupported_parameter',
              },
            }),
          ),
        );

      await rejection(provider.extractCard(images, options));

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['an invalid key', 401, '{"error":{"code":"invalid_api_key","message":"Incorrect API key provided: sk-x."}}'],
      ['a spent quota', 429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota."}}'],
      ['an unknown model', 404, '{"error":{"code":"model_not_found","message":"The model does not exist."}}'],
      ['a server error', 500, '{"error":{"message":"internal"}}'],
    ])('never retries %s', async (_label, status, body) => {
      fetchMock.mockResolvedValue(errorResponse(status, body));

      await rejection(provider.extractCard(images, options));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never retries a model that rejects the response_format', async () => {
      // Dropping response_format would "succeed" by silently returning free
      // text instead of schema-validated data.
      fetchMock.mockResolvedValue(
        errorResponse(
          400,
          JSON.stringify({
            error: {
              message:
                "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.",
              type: 'invalid_request_error',
              param: 'response_format',
              code: null,
            },
          }),
        ),
      );

      await rejection(provider.extractCard(images, options));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 400 whose cause it cannot identify', async () => {
      fetchMock.mockResolvedValue(errorResponse(400, '{"error":{"message":"upstream"}}'));

      const error = await rejection(provider.extractCard(images, options));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(error.kind).toBe('invalid_output');
    });
  });

  // ---------------------------------------------------------------------------
  // Capability probe
  // ---------------------------------------------------------------------------

  describe('verifyModel', () => {
    const probeOk = () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gpt-4o-mini-2024-07-18',
          choices: [
            { finish_reason: 'stop', message: { content: '{"ok":true}' } },
          ],
        }),
        text: async () => '{"ok":true}',
        headers: new Headers(),
      }) as unknown as Response;

    describe('the probe request', () => {
      it('sends one inline 1x1 PNG - it does not fetch an image from anywhere', async () => {
        fetchMock.mockResolvedValue(probeOk());

        await provider.verifyModel(options);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');

        const body = JSON.parse(init.body);
        const parts = body.messages[0].content;
        const image = parts.find((p: any) => p.type === 'image_url');
        expect(image.image_url.url).toBe(ONE_PIXEL_PNG_DATA_URL);
        expect(image.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
        // Small enough that the probe costs a fraction of a cent.
        expect(image.image_url.url.length).toBeLessThan(200);
      });

      it('exercises the same contract a real extraction depends on', async () => {
        fetchMock.mockResolvedValue(probeOk());

        await provider.verifyModel(options);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.model).toBe('gpt-4o-mini');
        expect(body.temperature).toBe(0);
        expect(body.response_format.type).toBe('json_schema');
        expect(body.response_format.json_schema.strict).toBe(true);
        expect(body.response_format.json_schema.name).toBe(
          OPENAI_PROBE_SCHEMA_NAME,
        );
      });

      it('sends no token-limit parameter of either spelling', async () => {
        // Guessing between max_tokens and max_completion_tokens turns a working
        // model into a 400. Omitting both is valid everywhere.
        fetchMock.mockResolvedValue(probeOk());

        await provider.verifyModel(options);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).not.toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('max_completion_tokens');
      });

      it('never mentions the model name in a capability decision', async () => {
        // Same probe body for any model string. No allowlist, no version sniff.
        fetchMock.mockResolvedValue(probeOk());

        for (const model of ['gpt-4o-mini', 'gpt-5.4-nano', 'future-model-9']) {
          fetchMock.mockClear();
          await provider.verifyModel({ ...options, model });
          const body = JSON.parse(fetchMock.mock.calls[0][1].body);
          expect(body.model).toBe(model);
          expect(Object.keys(body).sort()).toEqual([
            'messages',
            'model',
            'response_format',
            'temperature',
          ]);
        }
      });
    });

    describe('success', () => {
      it('reports the model the provider actually resolved to', async () => {
        fetchMock.mockResolvedValue(probeOk());

        await expect(provider.verifyModel(options)).resolves.toEqual({
          model: 'gpt-4o-mini-2024-07-18',
          droppedParameters: [],
        });
      });

      it('falls back to the requested model when the payload omits one', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '{}' } }] }),
          text: async () => '{}',
          headers: new Headers(),
        } as unknown as Response);

        const result = await provider.verifyModel(options);
        expect(result.model).toBe('gpt-4o-mini');
      });

      it('reports which parameters had to be dropped to make it work', async () => {
        fetchMock
          .mockResolvedValueOnce(
            errorResponse(
              400,
              JSON.stringify({
                error: {
                  message:
                    "Unsupported value: 'temperature' does not support 0 with this model.",
                  param: 'temperature',
                  code: 'unsupported_value',
                  type: 'invalid_request_error',
                },
              }),
            ),
          )
          .mockResolvedValueOnce(probeOk());

        const result = await provider.verifyModel(options);

        expect(result.droppedParameters).toEqual(['temperature']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      it('rejects a 200 that carried no completion', async () => {
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ model: 'x', choices: [] }),
          text: async () => '{}',
          headers: new Headers(),
        } as unknown as Response);

        const error = await rejection(provider.verifyModel(options));
        expect(error.kind).toBe('invalid_output');
      });
    });

    describe('failure detail', () => {
      const cases: Array<[string, number, string, string, string | undefined]> = [
        [
          'an invalid key',
          401,
          '{"error":{"message":"Incorrect API key provided: sk-live-xxx.","code":"invalid_api_key","type":"invalid_request_error","param":null}}',
          'auth',
          undefined,
        ],
        [
          'an unknown model',
          404,
          '{"error":{"message":"The model \'gpt-5.4-nano\' does not exist or you do not have access to it.","code":"model_not_found","type":"invalid_request_error","param":null}}',
          'unavailable',
          'model_not_found',
        ],
        [
          'a model that refuses images',
          400,
          '{"error":{"message":"Invalid content type. image_url is only supported by certain models.","code":"invalid_value","type":"invalid_request_error","param":"messages[0].content[1].type"}}',
          'unavailable',
          'model_no_image_support',
        ],
        [
          'a model that refuses structured outputs',
          400,
          '{"error":{"message":"Invalid parameter: \'response_format\' of type \'json_schema\' is not supported with this model.","code":null,"type":"invalid_request_error","param":"response_format"}}',
          'unavailable',
          'model_no_structured_output',
        ],
        [
          'a spent quota',
          429,
          '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","code":"insufficient_quota","type":"insufficient_quota","param":null}}',
          'rate_limited',
          'quota',
        ],
      ];

      it.each(cases)(
        'reports %s with a specific kind and detail',
        async (_label, status, body, kind, detail) => {
          fetchMock.mockResolvedValue(errorResponse(status, body));

          const error = await rejection(provider.verifyModel(options));

          expect(error.kind).toBe(kind);
          expect(error.detail).toBe(detail);
        },
      );

      it('distinguishes an unknown model from a model that cannot see', async () => {
        // The whole point of the feature: these two are both 4xx and both
        // "the model is wrong", but the admin has to change a different thing.
        fetchMock.mockResolvedValueOnce(
          errorResponse(
            404,
            '{"error":{"code":"model_not_found","message":"The model does not exist."}}',
          ),
        );
        const notFound = await rejection(provider.verifyModel(options));

        fetchMock.mockResolvedValueOnce(
          errorResponse(
            400,
            '{"error":{"message":"Invalid content type. image_url is only supported by certain models.","param":"messages[0].content[1].type"}}',
          ),
        );
        const noVision = await rejection(provider.verifyModel(options));

        expect(notFound.detail).toBe('model_not_found');
        expect(noVision.detail).toBe('model_no_image_support');
        expect(notFound.detail).not.toBe(noVision.detail);
      });

      it('reports a network failure as unavailable with no detail', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));

        const error = await rejection(provider.verifyModel(options));
        expect(error.kind).toBe('unavailable');
        expect(error.detail).toBeUndefined();
        expect(error.message).toContain('network error');
      });

      it('reports a timeout as unavailable', async () => {
        const timeout = new Error('The operation was aborted due to timeout');
        timeout.name = 'TimeoutError';
        fetchMock.mockRejectedValue(timeout);

        const error = await rejection(provider.verifyModel(options));
        expect(error.kind).toBe('unavailable');
        expect(error.message).toContain('timeout');
      });

      it('leaves an unfamiliar failure without a detail rather than guessing', async () => {
        fetchMock.mockResolvedValue(
          errorResponse(400, '{"error":{"message":"something new happened"}}'),
        );

        const error = await rejection(provider.verifyModel(options));
        expect(error.kind).toBe('invalid_output');
        expect(error.detail).toBeUndefined();
      });
    });

    describe('credential hygiene', () => {
      it('never logs or echoes the key, whatever the provider reflects back', async () => {
        // OpenAI echoes a masked form of the key in its own error text; a
        // future change or a proxy could echo more. Nothing derived from the
        // upstream body may carry it into a log line or a thrown message.
        fetchMock.mockResolvedValue(
          errorResponse(
            401,
            JSON.stringify({
              error: {
                message: `Incorrect API key provided: ${API_KEY}.`,
                code: 'invalid_api_key',
              },
            }),
          ),
        );

        const error = await rejection(provider.verifyModel(options));

        expect(error.message).not.toContain(API_KEY);
        expect(error.message).not.toContain('sk-live');
        expect(logLines.join('\n')).not.toContain(API_KEY);
      });

      it('sends the key only in the Authorization header, never in the body', async () => {
        fetchMock.mockResolvedValue(probeOk());

        await provider.verifyModel(options);

        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
        expect(init.body).not.toContain(API_KEY);
      });
    });
  });
});
