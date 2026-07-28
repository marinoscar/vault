import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { MAX_MODEL_NAME_LENGTH } from '../ai.constants';

import { VerifyAiDto, verifyAiSchema } from './verify-ai.dto';

/**
 * The request body of `POST /api/system-settings/ai/verify`.
 *
 * Two things are pinned here. First, that an ABSENT body still parses - the
 * web client sends no body and no Content-Type when there is no override, so a
 * schema that required an object would break the endpoint's original
 * behaviour. Second, that the model name is bounded but never pattern-matched:
 * this endpoint exists to find out empirically whether a name works, so
 * rejecting one on shape would defeat it.
 *
 * The pipe assertions go through the real `ZodValidationPipe` with the real
 * DTO metatype - the exact arrangement registered globally as APP_PIPE in
 * app.module.ts - so what is proven here is what the route does.
 */
describe('verifyAiSchema', () => {
  const pipe = new ZodValidationPipe();
  const throughPipe = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: VerifyAiDto } as any);

  describe('an omitted override', () => {
    it('accepts a missing body and yields no model', () => {
      // Fastify hands the pipe `undefined` for a POST with no body and no
      // Content-Type. That is the "probe the stored model" path.
      expect(throughPipe(undefined)).toEqual({});
    });

    it('accepts an empty object', () => {
      expect(throughPipe({})).toEqual({});
    });

    it('accepts an explicitly undefined model', () => {
      expect(throughPipe({ model: undefined })).toEqual({});
    });
  });

  describe('a supplied override', () => {
    it('accepts a model name', () => {
      expect(throughPipe({ model: 'gpt-5.4-nano' })).toEqual({
        model: 'gpt-5.4-nano',
      });
    });

    it('trims surrounding whitespace before it is probed or audited', () => {
      expect(throughPipe({ model: '  gpt-5.4-nano \n' })).toEqual({
        model: 'gpt-5.4-nano',
      });
    });

    it('accepts a name of exactly the maximum length', () => {
      const name = 'a'.repeat(MAX_MODEL_NAME_LENGTH);

      expect(throughPipe({ model: name })).toEqual({ model: name });
    });

    it.each([
      ['a future family nobody has seen', 'zenith-9.1-omni-preview'],
      ['a dated snapshot', 'gpt-4o-mini-2024-07-18'],
      ['a bare reasoning-model id', 'o3'],
      ['punctuation no current model uses', 'vendor::model.v9@preview'],
      ['a name that is plainly wrong', 'definitely-not-a-model'],
    ])(
      'does not judge the shape of the name: %s',
      (_label, name) => {
        // Load bearing. A regex or allowlist here would reject models released
        // after it was written, and would turn the provider's truthful
        // `model_not_found` into our guess. Only the LENGTH is checked.
        expect(throughPipe({ model: name })).toEqual({ model: name });
      },
    );
  });

  describe('rejection', () => {
    const rejects = (value: unknown) => {
      expect(() => throughPipe(value)).toThrow(BadRequestException);
    };

    it('rejects an empty string', () => {
      rejects({ model: '' });
    });

    it('rejects a whitespace-only string', () => {
      // Trimmed first, so this fails the min-length check rather than being
      // sent upstream as a blank model name.
      rejects({ model: '   ' });
    });

    it('rejects a name over the maximum length', () => {
      rejects({ model: 'a'.repeat(MAX_MODEL_NAME_LENGTH + 1) });
    });

    it.each([
      ['a number', 42],
      ['null', null],
      ['a boolean', true],
      ['an array', ['gpt-5.4-nano']],
      ['an object', { name: 'gpt-5.4-nano' }],
    ])('rejects %s in place of a model name', (_label, value) => {
      rejects({ model: value });
    });

    it('rejects a body that is not an object', () => {
      rejects('gpt-5.4-nano');
    });

    it('answers a bad model with a 400, not a 500', () => {
      try {
        throughPipe({ model: '' });
        throw new Error('Expected the pipe to reject');
      } catch (error) {
        expect((error as BadRequestException).getStatus()).toBe(400);
      }
    });
  });

  describe('what the body may not smuggle in', () => {
    it('ignores unknown properties instead of honouring them', () => {
      // Notably an `apiKey`: the override changes which MODEL is probed, never
      // which credential. The key comes from system settings and nowhere else.
      const parsed = verifyAiSchema.parse({
        model: 'gpt-5.4-nano',
        apiKey: 'sk-live-NOT-A-REAL-KEY',
        maxCallsPerUserPerDay: 10_000,
      } as never);

      expect(parsed).toEqual({ model: 'gpt-5.4-nano' });
    });
  });
});
