import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AiEnabledGuard } from '@marinoscar/platform-api/ai';
import { Auth, CurrentUser, RequestUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../core/roles.constants';

import { AiException } from './ai.errors';
import { DocumentExtractService } from './document-extract.service';
import { EXTRACT_DOCUMENT_BODY_SCHEMA } from './dto/extract-document.dto';

/**
 * `POST /api/secrets/documents/extract` (issue #210, IDOC-7): the AI-facing step
 * of the Passport and ID Document creation flows. Same guards as the card route:
 * authentication, `secrets:write` and `ai:use`, then the platform kill switch.
 *
 * @stability experimental
 */
@ApiTags('Secrets')
@Controller('secrets/documents')
export class DocumentExtractController {
  constructor(private readonly documentExtract: DocumentExtractService) {}

  @Post('extract')
  @HttpCode(HttpStatus.OK)
  // As on the card route: the kill switch runs AFTER the auth guards (a method-level
  // `@UseGuards` above `@Auth` is appended last), so an anonymous caller is told 401.
  @UseGuards(AiEnabledGuard)
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE, 'ai:use'] })
  @ApiOperation({
    summary: 'Extract passport or ID document details from photographs',
    description:
      'Reads full (uncropped) photos of a passport (`documentType: passport`, images `data_page` and ' +
      'optional `back`) or another identity document (`documentType: id_document`, images `front` and ' +
      'optional `back`) with the configured vision model, and returns candidate field values with ' +
      'per-field confidence, the classified document kind and its attributes (ID document), the ' +
      'deterministic checks (MRZ check digits, SSN structure, VIN check digit), warnings and a crop ' +
      'box per image. Persists nothing: the caller decides on the review screen what becomes a ' +
      'secret. Needs `secrets:write` and `ai:use`; answers 403 AI_DISABLED while AI is switched off.',
  })
  @ApiBody({ schema: EXTRACT_DOCUMENT_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: 'Candidate document fields, kind, attributes, checks, warnings and crop boxes' })
  @ApiResponse({ status: 400, description: 'AI_INVALID_IMAGE - unknown documentType, a missing required image or not an image data URL' })
  @ApiResponse({ status: 422, description: 'AI_EXTRACTION_FAILED - the model could not read the document' })
  @ApiResponse({ status: 429, description: 'AI_RATE_LIMITED / AI_QUOTA_EXCEEDED / AI_UPSTREAM_RATE_LIMITED' })
  @ApiResponse({ status: 502, description: 'AI_UPSTREAM_AUTH / AI_UPSTREAM_UNAVAILABLE' })
  @ApiResponse({ status: 503, description: 'AI_NOT_CONFIGURED (provider, model or key not set up)' })
  async extract(
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    try {
      return { data: await this.documentExtract.extract(body, user) };
    } catch (error) {
      // The global filter writes the response without headers: put Retry-After on the reply here.
      if (error instanceof AiException && error.retryAfterSeconds) {
        reply.header('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
