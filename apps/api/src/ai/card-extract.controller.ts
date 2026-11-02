import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AiEnabledGuard } from '@marinoscar/platform-api/ai';
import { Auth, CurrentUser, RequestUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { AiException } from './ai.errors';
import { CardExtractService } from './card-extract.service';
import { EXTRACT_CARD_BODY_SCHEMA } from './dto/extract-card.dto';

/**
 * Lives under `secrets/cards` so the route reads
 * `POST /api/secrets/cards/extract` - it is a step in the card-creation flow,
 * not a general AI utility. It is declared in the AI module rather than the
 * secrets module because it is the AI-facing half of the card flow. The platform kill switch
 * (`AiEnabledGuard`) guards the route after authentication.
 */
@ApiTags('Secrets')
@Controller('secrets/cards')
export class CardExtractController {
  constructor(private readonly cardExtract: CardExtractService) {}

  @Post('extract')
  @HttpCode(HttpStatus.OK)
  // The permission is not decorative. `@CurrentUser()` resolves to a
  // `RequestUser` (with `.permissions`) only because the guard chain ran; a
  // bare route would hand the raw Prisma user to anything reading `user.id`.
  // The kill switch runs AFTER the auth guards (a method-level `@UseGuards` above `@Auth` is
  // appended last): an anonymous caller is told 401, not "AI is off". The platform's own
  // `/api/ai/*` routes put it on the class (before auth) on purpose; this route is Vault's.
  @UseGuards(AiEnabledGuard)
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE, 'ai:use'] })
  @ApiOperation({
    summary: 'Extract card details from photographs',
    description:
      'Reads full (uncropped) card photos with the configured vision model and returns ' +
      'candidate field values for review, plus a per-image bounding box (`crops.front` / ' +
      '`crops.back`, fractions of the image as sent, with clockwise quarter-turns) locating ' +
      'the card so the client can crop the stored copy. Persists nothing: no image and no ' +
      'extracted value is stored by this endpoint - the caller decides on the review screen ' +
      'what becomes a secret. The card security code is never read: `cvv` and ' +
      '`security_code_2` are always null. Needs `secrets:write` and `ai:use`; answers 403 ' +
      'AI_DISABLED while AI is switched off.',
  })
  @ApiBody({ schema: EXTRACT_CARD_BODY_SCHEMA })
  @ApiResponse({
    status: 200,
    description:
      'Candidate card fields with per-field confidence, and AI-located card crop boxes per image',
  })
  @ApiResponse({ status: 400, description: 'AI_INVALID_IMAGE - body was not acceptable image data URLs' })
  @ApiResponse({ status: 422, description: 'AI_EXTRACTION_FAILED - the model could not read the card' })
  @ApiResponse({ status: 429, description: 'AI_RATE_LIMITED / AI_QUOTA_EXCEEDED / AI_UPSTREAM_RATE_LIMITED' })
  @ApiResponse({ status: 502, description: 'AI_UPSTREAM_AUTH / AI_UPSTREAM_UNAVAILABLE' })
  @ApiResponse({ status: 503, description: 'AI_NOT_CONFIGURED (provider, model or key not set up)' })
  async extract(
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    try {
      const result = await this.cardExtract.extract(body, user);
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
