import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { AiException } from './ai.errors';
import { CardExtractService } from './card-extract.service';
import { EXTRACT_CARD_BODY_SCHEMA } from './dto/extract-card.dto';

/**
 * Lives under `secrets/cards` so the route reads
 * `POST /api/secrets/cards/extract` - it is a step in the card-creation flow,
 * not a general AI utility. It is declared in the AI module rather than the
 * secrets module because everything it depends on (provider, config, limiter)
 * is AI-owned.
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
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Extract card details from photographs',
    description:
      'Reads already-cropped card images with the configured vision model and returns ' +
      'candidate field values for review. Persists nothing: no image and no extracted ' +
      'value is stored. The CVV/CVC is never requested and never returned.',
  })
  @ApiBody({ schema: EXTRACT_CARD_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: 'Candidate card fields with per-field confidence' })
  @ApiResponse({ status: 400, description: 'AI_INVALID_IMAGE - body was not acceptable image data URLs' })
  @ApiResponse({ status: 422, description: 'AI_EXTRACTION_FAILED - the model could not read the card' })
  @ApiResponse({ status: 429, description: 'AI_RATE_LIMITED / AI_QUOTA_EXCEEDED / AI_UPSTREAM_RATE_LIMITED' })
  @ApiResponse({ status: 502, description: 'AI_UPSTREAM_AUTH / AI_UPSTREAM_UNAVAILABLE' })
  @ApiResponse({ status: 503, description: 'AI_NOT_CONFIGURED / AI_KEY_UNREADABLE' })
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
