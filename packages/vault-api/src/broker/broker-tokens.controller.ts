import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  Auth,
  AuthCredential,
  CurrentUser,
  refuseOAuthCredential,
  type AuthCredentialInfo,
  type RequestUser,
} from '@marinoscar/platform-api/identity';

import { BrokerTokensService } from './broker-tokens.service';
import { CreateBrokerTokenDto } from './dto';

/**
 * Broker token management (ADR-0006 decision 2): `POST/GET /api/broker/tokens`,
 * `DELETE /api/broker/tokens/:id` and `POST /api/broker/tokens/:id/revoke`.
 *
 * Authorization is the personal access token controller's: a bare `@Auth()` (any signed-in user),
 * ownership enforced by the service. A browser session or a `pat_` token may call it; an `oat_`
 * token is refused (403) and a `vbk_` token cannot authenticate here at all (it is no JWT, and the
 * platform guard answers 401), so a token can never mint or revoke tokens.
 *
 * @stability experimental
 */
@ApiTags('Broker')
@Controller('broker/tokens')
export class BrokerTokensController {
  constructor(private readonly tokens: BrokerTokensService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Auth()
  @ApiOperation({
    summary: 'Create a broker token',
    description:
      'Creates a `vbk_` broker token that can USE your broker-enabled keys through `/api/broker/v1/*` and can never read them. ' +
      'The token is in the response once and is stored only as a SHA-256 hash. `expiresInDays` is 1 to 3650 (default 90). ' +
      '`secretIds` restricts it to those of your own secrets that have the broker switched on (422 BROKER_TOKEN_SECRET_INVALID otherwise); ' +
      'omit it for every broker-enabled secret you own. A session or a personal access token may call it; an OAuth token is refused (403). ' +
      'Audited as broker.token.create (never the token).',
  })
  @ApiResponse({ status: 201, description: 'The token (shown once) and its metadata' })
  @ApiResponse({ status: 400, description: 'Invalid body' })
  @ApiResponse({ status: 403, description: 'An OAuth credential' })
  @ApiResponse({ status: 422, description: 'BROKER_TOKEN_SECRET_INVALID' })
  async create(@Body() dto: CreateBrokerTokenDto, @CurrentUser() user: RequestUser, @AuthCredential() credential: AuthCredentialInfo | null) {
    refuseOAuthCredential(credential);
    return { data: await this.tokens.create(user.id, dto) };
  }

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List your broker tokens',
    description: 'Your broker tokens, newest first: name, display prefix, restriction, expiry, last use and revocation. Never the token or its hash.',
  })
  @ApiResponse({ status: 200, description: 'The tokens' })
  @ApiResponse({ status: 403, description: 'An OAuth credential' })
  async list(@CurrentUser() user: RequestUser, @AuthCredential() credential: AuthCredentialInfo | null) {
    refuseOAuthCredential(credential);
    return { data: await this.tokens.list(user.id) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth()
  @ApiOperation({ summary: 'Revoke a broker token', description: 'Revokes one of your tokens (idempotent). Audited as broker.token.revoke.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Revoked' })
  @ApiResponse({ status: 403, description: 'An OAuth credential' })
  @ApiResponse({ status: 404, description: 'Not found (or not yours)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser, @AuthCredential() credential: AuthCredentialInfo | null): Promise<void> {
    refuseOAuthCredential(credential);
    await this.tokens.revoke(user.id, id);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth()
  @ApiOperation({ summary: 'Revoke a broker token (POST form)', description: 'The same as `DELETE /api/broker/tokens/:id`, for clients that cannot send DELETE.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Revoked' })
  @ApiResponse({ status: 403, description: 'An OAuth credential' })
  @ApiResponse({ status: 404, description: 'Not found (or not yours)' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser, @AuthCredential() credential: AuthCredentialInfo | null): Promise<void> {
    refuseOAuthCredential(credential);
    await this.tokens.revoke(user.id, id);
  }
}
