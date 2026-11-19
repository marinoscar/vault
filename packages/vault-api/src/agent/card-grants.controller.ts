import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  Auth,
  AuthCredential,
  CurrentUser,
  type AuthCredentialInfo,
  type RequestUser,
} from '@marinoscar/platform-api/identity';
import { AGENT_ERROR_CODES, type CardGrantRequestStatus } from '@marinoscar/vault-contract/agent';

import { PERMISSIONS } from '../core/roles.constants';
import { agentForbidden } from './agent-pipeline';
import { CardGrantsService } from './card-grants.service';
import { CreateCardGrantDto, cardGrantRequestListQuerySchema } from './dto';

/**
 * Admits only the owner's browser session (an access JWT). An `oat_` token (an agent) and a `pat_`
 * token (a script) are refused with `403 OWNER_SESSION_REQUIRED`: no token can create, change or
 * widen what agents may do with a card (ADR-0003).
 *
 * @stability experimental
 */
export function requireOwnerSession(credential: AuthCredentialInfo | null | undefined): void {
  if (credential?.kind !== 'jwt') {
    throw agentForbidden(
      AGENT_ERROR_CODES.OWNER_SESSION_REQUIRED,
      'Sign in to Vault to change what agents may do with this card',
    );
  }
}

const SESSION_ONLY = 'A token (oat_ or pat_) is refused with 403 OWNER_SESSION_REQUIRED: only the owner signed in to Vault may change a grant.';

/**
 * The owner's merchant grants and grant requests of a card (ADR-0003), under
 * `/api/secrets/:id/card-grants` and `/api/secrets/:id/card-grant-requests`. Reads need
 * `secrets:read`, writes `secrets:write` and a browser session. Only the card's owner reaches it;
 * anyone else gets 404. An `oat_` token never reaches `/api/secrets/*` at all (route confinement).
 *
 * @stability experimental
 */
@ApiTags('Secrets')
@Controller('secrets/:id')
export class CardGrantsController {
  constructor(private readonly grants: CardGrantsService) {}

  @Get('card-grants')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'List the merchant grants of a card',
    description: 'Every grant of the caller\'s card (active, then expired and revoked) with its limits and its use in the current period.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiResponse({ status: 200, description: '{ data: CardGrant[] }' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s Card' })
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return { data: await this.grants.list(user.id, id) };
  }

  @Post('card-grants')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Allow agents to use a card at one merchant',
    description:
      'Creates a merchant grant: merchant origin (matched by registrable domain), optional payment frame origins (exact), ' +
      'a required maximum amount and currency, an optional period limit, an optional expiry and the security code flag ' +
      `(off by default). 409 CARD_GRANT_EXISTS when the merchant already has a live grant. ${SESSION_ONLY} Audited as secret.card_grant.create.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiResponse({ status: 201, description: '{ data: CardGrant }' })
  @ApiResponse({ status: 400, description: 'Invalid origin, amount, currency or expiry' })
  @ApiResponse({ status: 403, description: 'OWNER_SESSION_REQUIRED' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s Card' })
  @ApiResponse({ status: 409, description: 'CARD_GRANT_EXISTS' })
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCardGrantDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    requireOwnerSession(credential);
    return { data: await this.grants.create(user.id, id, dto as never) };
  }

  @Delete('card-grants/:grantId')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Revoke a merchant grant',
    description: `Agents can no longer use the card at that merchant. Idempotent. ${SESSION_ONLY} Audited as secret.card_grant.revoke.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiParam({ name: 'grantId', type: String, format: 'uuid', description: 'Grant ID' })
  @ApiResponse({ status: 200, description: '{ data: CardGrant } (status revoked)' })
  @ApiResponse({ status: 403, description: 'OWNER_SESSION_REQUIRED' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s Card or grant' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    requireOwnerSession(credential);
    return { data: await this.grants.revoke(user.id, id, grantId) };
  }

  @Get('card-grant-requests')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'List the grant requests agents made for a card',
    description: 'Newest first, optionally of one status (pending, approved, declined). Never card data.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiResponse({ status: 200, description: '{ data: CardGrantRequest[] }' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s Card' })
  async listRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(cardGrantRequestListQuerySchema)) query: { status?: CardGrantRequestStatus },
    @CurrentUser() user: RequestUser,
  ) {
    return { data: await this.grants.listRequests(user.id, id, query.status) };
  }

  @Post('card-grant-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Approve a grant request',
    description:
      'Creates exactly the requested grant (that merchant, the requested amount as the maximum, that currency; no period ' +
      `limit, expiry, frames or security code). 409 CARD_GRANT_REQUEST_NOT_PENDING or CARD_GRANT_EXISTS. ${SESSION_ONLY}`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiParam({ name: 'requestId', type: String, format: 'uuid', description: 'Request ID' })
  @ApiResponse({ status: 200, description: '{ data: { request, grant } }' })
  @ApiResponse({ status: 403, description: 'OWNER_SESSION_REQUIRED' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s Card or request' })
  @ApiResponse({ status: 409, description: 'CARD_GRANT_REQUEST_NOT_PENDING, CARD_GRANT_EXISTS' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    requireOwnerSession(credential);
    return { data: await this.grants.approve(user.id, id, requestId) };
  }

  @Post('card-grant-requests/:requestId/decline')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Decline a grant request',
    description: `Marks the request declined. 409 CARD_GRANT_REQUEST_NOT_PENDING. ${SESSION_ONLY}`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiParam({ name: 'requestId', type: String, format: 'uuid', description: 'Request ID' })
  @ApiResponse({ status: 200, description: '{ data: CardGrantRequest }' })
  @ApiResponse({ status: 403, description: 'OWNER_SESSION_REQUIRED' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s Card or request' })
  @ApiResponse({ status: 409, description: 'CARD_GRANT_REQUEST_NOT_PENDING' })
  async decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    requireOwnerSession(credential);
    return { data: await this.grants.decline(user.id, id, requestId) };
  }
}
