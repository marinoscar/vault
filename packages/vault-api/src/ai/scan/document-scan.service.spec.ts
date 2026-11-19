import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { AiError } from '@marinoscar/platform-api/ai';
import { RequestUser } from '@marinoscar/platform-api/identity';

import { AI_ERROR_CODES } from '../ai.constants';
import { AiException } from '../ai.errors';
import { DocumentScanService } from './document-scan.service';
import type { ScanProfile } from './scan-profile';
import { ScanProfileRegistry } from './scan-profile.registry';

// Invented fixtures only.
const SECRET_VALUE = 'UTO-SPECIMEN-0000';
const PAGE_IMAGE = 'data:image/jpeg;base64,UEFHRUJZVEVT';
const EXTRA_IMAGE = 'data:image/png;base64,RVhUUkFCWVRFUw==';
const LAST_IMAGE = 'data:image/webp;base64,TEFTVEJZVEVT';

const user: RequestUser = {
  id: 'user-aaa',
  email: 'person.a@example.test',
  roles: ['contributor'],
  permissions: ['secrets:write', 'ai:use'],
  isActive: true,
  activeOrgId: 'org-alpha',
};

const modelSchema = z.object({ value: z.string().nullable() });
type Model = z.infer<typeof modelSchema>;

const testProfile: ScanProfile<Model, { value: string | null; slots: string[]; model: string }> = {
  id: 'test_doc',
  aiFeature: 'test_doc_extract',
  imageSlots: [
    { key: 'page', required: true, label: 'Page' },
    { key: 'extra', required: false, label: 'Extra' },
    { key: 'last', required: false, label: 'Last' },
  ],
  schemaName: 'test_doc_extraction',
  systemPrompt: 'Read the test document.',
  modelSchema,
  userText: (images) => `Slots: ${Object.keys(images).join(',')}`,
  toRaw: (output, { model }) => ({ value: output.value?.trim() ?? null, model }),
  normalize: (raw, { providedSlots, model }) => ({
    value: (raw as { value: string | null }).value,
    slots: providedSlots,
    model,
  }),
  timeoutMs: 12_345,
  recordOutcome: (metrics, outcome) => metrics.cardExtracted(outcome),
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

describe('DocumentScanService', () => {
  let respondStructured: jest.Mock;
  let forUser: jest.Mock;
  let metrics: { cardExtracted: jest.Mock };
  let service: DocumentScanService;
  let logLines: string[];

  beforeEach(() => {
    respondStructured = jest.fn().mockResolvedValue({ parsed: { value: ` ${SECRET_VALUE} ` }, model: 'test-model' });
    forUser = jest.fn().mockReturnValue({ respondStructured });
    metrics = { cardExtracted: jest.fn() };
    const registry = new ScanProfileRegistry();
    registry.register(testProfile);
    service = new DocumentScanService({ forUser } as never, registry, metrics as never);

    logLines = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map((a) => String(a)).join(' '));
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  describe('the request', () => {
    it("runs as the user, in the active organization, under the profile's feature", async () => {
      await service.extract('test_doc', user, { page: PAGE_IMAGE });
      expect(forUser).toHaveBeenCalledWith('user-aaa', { orgId: 'org-alpha', feature: 'test_doc_extract' });
    });

    it('sends one user message: the text line, then the image parts in slot order', async () => {
      // Record order deliberately differs from slot order.
      await service.extract('test_doc', user, { last: LAST_IMAGE, extra: EXTRA_IMAGE, page: PAGE_IMAGE });

      expect(respondStructured).toHaveBeenCalledTimes(1);
      const [req] = respondStructured.mock.calls[0];
      expect(req).toMatchObject({
        schema: modelSchema,
        schemaName: 'test_doc_extraction',
        instructions: 'Read the test document.',
        temperature: 0,
      });
      expect(req.input).toHaveLength(1);
      expect(req.input[0]).toMatchObject({ type: 'message', role: 'user' });
      expect(req.input[0].content).toEqual([
        { type: 'text', text: 'Slots: page,extra,last' },
        { type: 'image', url: PAGE_IMAGE, detail: 'high' },
        { type: 'image', url: EXTRA_IMAGE, detail: 'high' },
        { type: 'image', url: LAST_IMAGE, detail: 'high' },
      ]);
    });

    it('skips missing optional slots and tells the normalizer which slots were sent', async () => {
      const result = await service.extract('test_doc', user, { page: PAGE_IMAGE, extra: undefined, last: LAST_IMAGE });

      const parts = respondStructured.mock.calls[0][0].input[0].content;
      expect(parts.filter((p: { type: string }) => p.type === 'image').map((p: { url: string }) => p.url)).toEqual([
        PAGE_IMAGE,
        LAST_IMAGE,
      ]);
      expect(result).toEqual({ value: SECRET_VALUE, slots: ['page', 'last'], model: 'test-model' });
    });

    it('passes an abort signal for the profile timeout', async () => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      await service.extract('test_doc', user, { page: PAGE_IMAGE });
      expect(timeout).toHaveBeenCalledWith(12_345);
      const [, options] = respondStructured.mock.calls[0];
      expect(options.signal).toBe(timeout.mock.results[0].value);
    });

    it('rejects a missing required slot with AI_INVALID_IMAGE before any AI call', async () => {
      const err = await rejection(service.extract('test_doc', user, { extra: EXTRA_IMAGE }));
      expect(err.code).toBe(AI_ERROR_CODES.INVALID_IMAGE);
      expect(err.getStatus()).toBe(400);
      expect(err.message).not.toContain('RVhUUkFC');
      expect(forUser).not.toHaveBeenCalled();
      expect(metrics.cardExtracted).toHaveBeenCalledWith('invalid_image');
    });

    it('throws on an unknown profile', async () => {
      await expect(service.extract('nope', user, { page: PAGE_IMAGE })).rejects.toThrow(/Unknown scan profile/);
    });

    it('records a success through the profile', async () => {
      await service.extract('test_doc', user, { page: PAGE_IMAGE });
      expect(metrics.cardExtracted).toHaveBeenCalledTimes(1);
      expect(metrics.cardExtracted).toHaveBeenCalledWith('succeeded');
    });
  });

  describe('error mapping (one case per AI_ERROR_CODES code)', () => {
    const cases: Array<[string, unknown, string, number, string]> = [
      ['AI_DISABLED', new AiError('AI_DISABLED', 'x'), AI_ERROR_CODES.NOT_CONFIGURED, 503, 'not_configured'],
      [
        'a per-minute cap',
        new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 20_000, details: { limit: 'perUser.requestsPerMinute' } }),
        AI_ERROR_CODES.RATE_LIMITED,
        429,
        'rate_limited',
      ],
      [
        'a per-day cap',
        new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 90_000, details: { limit: 'perUser.requestsPerDay' } }),
        AI_ERROR_CODES.QUOTA_EXCEEDED,
        429,
        'quota_exceeded',
      ],
      ['AI_KEY_INVALID', new AiError('AI_KEY_INVALID', 'x'), AI_ERROR_CODES.UPSTREAM_AUTH, 502, 'upstream_error'],
      [
        'a provider throttle',
        new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 5_000 }),
        AI_ERROR_CODES.UPSTREAM_RATE_LIMITED,
        429,
        'upstream_error',
      ],
      ['AI_PROVIDER_UNAVAILABLE', new AiError('AI_PROVIDER_UNAVAILABLE', 'x'), AI_ERROR_CODES.UPSTREAM_UNAVAILABLE, 502, 'upstream_error'],
      ['an unclassified error', new Error('socket hang up'), AI_ERROR_CODES.UPSTREAM_UNAVAILABLE, 502, 'upstream_error'],
      ['AI_STRUCTURED_OUTPUT_INVALID', new AiError('AI_STRUCTURED_OUTPUT_INVALID', 'x'), AI_ERROR_CODES.EXTRACTION_FAILED, 422, 'failed'],
    ];

    it.each(cases)('maps %s', async (_name, error, code, status, outcome) => {
      respondStructured.mockRejectedValue(error);
      const err = await rejection(service.extract('test_doc', user, { page: PAGE_IMAGE }));
      expect(err.code).toBe(code);
      expect(err.getStatus()).toBe(status);
      expect(metrics.cardExtracted).toHaveBeenCalledWith(outcome);
    });

    it('covers every AI_ERROR_CODES code (AI_INVALID_IMAGE is the missing-slot case above)', () => {
      const covered = new Set([...cases.map((c) => c[2]), AI_ERROR_CODES.INVALID_IMAGE]);
      expect([...covered].sort()).toEqual(Object.values(AI_ERROR_CODES).sort());
    });

    it('carries Retry-After seconds', async () => {
      respondStructured.mockRejectedValue(
        new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 90_000, details: { limit: 'perUser.requestsPerDay' } }),
      );
      expect((await rejection(service.extract('test_doc', user, { page: PAGE_IMAGE }))).retryAfterSeconds).toBe(90);
    });

    it('passes an AiException through unchanged', async () => {
      const own = new AiException(422, AI_ERROR_CODES.EXTRACTION_FAILED, 'x');
      respondStructured.mockRejectedValue(own);
      expect(await rejection(service.extract('test_doc', user, { page: PAGE_IMAGE }))).toBe(own);
    });
  });

  describe('privacy', () => {
    it('logs neither image bytes nor extracted values, on success or failure', async () => {
      await service.extract('test_doc', user, { page: PAGE_IMAGE, extra: EXTRA_IMAGE });
      for (const error of [
        new AiError('AI_STRUCTURED_OUTPUT_INVALID', `bad ${SECRET_VALUE} ${PAGE_IMAGE}`),
        new AiError('AI_DISABLED', `${SECRET_VALUE}`),
        new AiError('AI_KEY_INVALID', `${PAGE_IMAGE}`),
        new Error(`hang up ${SECRET_VALUE} ${PAGE_IMAGE}`),
      ]) {
        respondStructured.mockRejectedValueOnce(error);
        await rejection(service.extract('test_doc', user, { page: PAGE_IMAGE }));
      }

      expect(logLines.length).toBeGreaterThan(0);
      const logs = logLines.join('\n');
      for (const needle of [SECRET_VALUE, 'UEFHRUJZVEVT', 'RVhUUkFC', user.email]) {
        expect(logs).not.toContain(needle);
      }
      const metricCalls = JSON.stringify(metrics.cardExtracted.mock.calls);
      expect(metricCalls).not.toContain(SECRET_VALUE);
      expect(metricCalls).not.toContain(user.id);
    });
  });

  it('works without a metrics port', async () => {
    const registry = new ScanProfileRegistry();
    registry.register(testProfile);
    const bare = new DocumentScanService({ forUser } as never, registry);
    await expect(bare.extract('test_doc', user, { page: PAGE_IMAGE })).resolves.toMatchObject({ value: SECRET_VALUE });
  });
});
