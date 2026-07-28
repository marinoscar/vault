import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { AiException } from './ai.errors';
import { AiVerifyService } from './ai-verify.service';
import { VERIFY_AI_BODY_SCHEMA, VerifyAiDto } from './dto/verify-ai.dto';

/**
 * Routed at `POST /api/system-settings/ai/verify` - it belongs to the settings
 * screen, next to the fields it checks.
 *
 * It is DECLARED in the AI module rather than the settings module because
 * everything it depends on (the vision provider, the config resolver, the burst
 * limiter) is AI-owned, and `AiModule` already imports `SettingsModule`. Putting
 * the controller in `SettingsModule` would make that import circular. Same
 * pattern as `CardExtractController`, which serves `/api/secrets/cards/extract`
 * from this module.
 */
@ApiTags('System Settings')
@Controller('system-settings/ai')
export class AiVerifyController {
  constructor(private readonly aiVerify: AiVerifyService) {}

  /**
   * Gated on SYSTEM_SETTINGS_WRITE, the same permission needed to store the key
   * in the first place. Read access is not enough: this spends money and probes
   * a credential.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @ApiOperation({
    summary: 'Test the configured AI provider key and model (Admin only)',
    description:
      'Sends one minimal real request to the provider - a 1x1 inline PNG plus a trivial ' +
      'strict json_schema response format - and reports what happened. A single call proves ' +
      'the key authenticates, the model name resolves, the model accepts image input, and ' +
      'structured outputs work with it; none of those can be established from a model listing. ' +
      'Costs a fraction of a cent per press and is rate limited. Works while ai.enabled is ' +
      'still false, so a key can be checked before the feature is switched on for users. ' +
      'Pass an optional `model` in the body to probe a candidate name instead of the stored ' +
      'one - it is not saved, so a model can be tested before it is committed to settings. ' +
      'Returns 200 with { ok: false, reason } for a provider-side failure - deliberately ' +
      'never 401/403, so a bad upstream key cannot be mistaken for an expired session.',
  })
  @ApiBody({
    required: false,
    description:
      'Optional. Omit the body entirely to probe the model stored in system settings.',
    schema: VERIFY_AI_BODY_SCHEMA,
  })
  @ApiResponse({
    status: 200,
    description:
      'The check ran. `ok` discriminates the result; a failure is still a 200.',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', enum: [true] },
                model: { type: 'string', example: 'gpt-4o-mini-2024-07-18' },
                imageSupport: { type: 'boolean', enum: [true] },
                durationMs: { type: 'number', example: 812 },
                adaptedParameters: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['temperature'],
                },
              },
            },
          },
        },
        {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', enum: [false] },
                reason: {
                  type: 'string',
                  enum: [
                    'invalid_key',
                    'model_not_found',
                    'model_no_image_support',
                    'model_no_structured_output',
                    'quota',
                    'network',
                    'unknown',
                  ],
                },
                message: { type: 'string' },
                model: { type: 'string' },
                durationMs: { type: 'number' },
                adaptedParameters: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'The `model` in the body was not a non-empty string of at most 100 characters. ' +
      'The NAME is never judged - only its length - because an unrecognised name is the ' +
      "provider's answer to give (`model_not_found`), not ours to guess at.",
  })
  @ApiResponse({
    status: 429,
    description: 'AI_RATE_LIMITED - too many checks in a short period',
  })
  @ApiResponse({
    status: 503,
    description:
      'AI_NOT_CONFIGURED (no key stored) / AI_KEY_UNREADABLE (stored key cannot be decrypted)',
  })
  async verify(
    @CurrentUser() user: RequestUser,
    // The global nestjs-zod pipe validates this against `verifyAiSchema`. That
    // schema defaults a missing body to `{}`, which is what keeps a bodyless
    // POST - the only kind the web client sends when there is no override -
    // working as "probe the stored model" rather than failing validation.
    @Body() body: VerifyAiDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    try {
      const result = await this.aiVerify.verify(user, body);
      return { data: result };
    } catch (error) {
      // `HttpException` carries no headers and the global filter writes the
      // response with `reply.code().send()`, so `Retry-After` has to be put on
      // the reply here, before the exception propagates.
      if (error instanceof AiException && error.retryAfterSeconds) {
        reply.header('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
