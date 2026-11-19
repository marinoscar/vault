import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  Auth,
  AuthCredential,
  CurrentUser,
  type AuthCredentialInfo,
  type RequestUser,
} from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../core/roles.constants';
import { AgentNoStoreInterceptor } from './agent-no-store.interceptor';
import { AgentReleaseService, type AgentReleaseContext } from './agent-release.service';
import {
  AgentCardFillDto,
  AgentCardGrantRequestDto,
  AgentIdentityFillDto,
  agentCardsLookupQuerySchema,
  agentIdentityLookupQuerySchema,
} from './dto';

/** The release context of an HTTP request: the request's credential (an `oat_` or `pat_` token). */
export function httpReleaseContext(user: RequestUser, credential: AuthCredentialInfo | null): AgentReleaseContext {
  const clientLabel =
    credential?.kind === 'oauth' ? `oauth:${credential.clientId}` : credential?.kind === 'pat' ? 'pat' : 'http';
  return { userId: user.id, clientLabel, credential: credential ?? null };
}

const REFUSALS_403 =
  'AGENT_ACCESS_DISABLED, a browser session (AGENT_CREDENTIAL_REQUIRED), or the scope is missing (insufficient_scope)';

/**
 * Cards and identity on the agent API (`/api/agent/v1/cards`, `/api/agent/v1/identity`; ADR-0003).
 * Accepts `oat_` and `pat_` credentials only; every response is `Cache-Control: no-store`. The rules
 * live in `AgentReleaseService`, the same implementation an embedded host calls in process.
 *
 * @stability experimental
 */
@ApiTags('Agent')
@Controller('agent/v1')
@UseInterceptors(AgentNoStoreInterceptor)
export class AgentCardsController {
  constructor(private readonly release: AgentReleaseService) {}

  @Get('cards')
  @Auth({ permissions: [PERMISSIONS.AGENT_CARDS_READ] })
  @ApiOperation({
    summary: 'Find the cards allowed for a shop',
    description:
      'The caller\'s Card secrets opened to agents that have a live merchant grant for the registrable domain of `origin`: ' +
      'id, name, brand, last4, expMonth, expYear and the grant (maxAmount, currency, includesSecurityCode, expiresAt). Never ' +
      'a number or a code. Scope vault:cards_read. 403 CARD_ACCESS_DISABLED while agentAccess.cards.enabled is off. ' +
      'Rate limit: agentAccess.lookupPerMinute.',
  })
  @ApiQuery({ name: 'origin', type: String, description: 'The top-level page origin (the merchant)' })
  @ApiResponse({ status: 200, description: 'Granted cards' })
  @ApiResponse({ status: 400, description: 'origin is not a valid https origin' })
  @ApiResponse({ status: 403, description: `CARD_ACCESS_DISABLED, ${REFUSALS_403}` })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async cards(
    @Query(new ZodValidationPipe(agentCardsLookupQuerySchema)) query: { origin: string },
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.cardsLookup({ ...httpReleaseContext(user, credential), origin: query.origin }) };
  }

  @Post('cards/:id/fill')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.AGENT_CARDS_FILL] })
  @ApiOperation({
    summary: 'Read one field of a granted card to type it',
    description:
      'Returns ONE of number, expMonth, expYear, holderName, securityCode, postalCode. `origin` (the top-level page) must ' +
      'match a live grant by registrable domain; a `frameOrigin` must be on the grant\'s list (403 ORIGIN_MISMATCH). ' +
      '`amount` and `currency` are checked against the grant (403 CARD_AMOUNT_EXCEEDED, CARD_CURRENCY_MISMATCH); an ' +
      'expired grant is 403 CARD_GRANT_EXPIRED; securityCode needs the grant flag (403 SECURITY_CODE_NOT_GRANTED). A ' +
      '`number` fill is a release: 403 CARD_PERIOD_LIMIT_REACHED or CARD_DAILY_CAP_REACHED past the limits. Scope ' +
      'vault:cards_fill. Rate limit: agentAccess.cards.fillPerMinute (default 10). Audited as agent.card.fill with the amount.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiResponse({ status: 200, description: '{ data: { value } }' })
  @ApiResponse({ status: 403, description: `A grant rule (see the description), CARD_ACCESS_DISABLED, ${REFUSALS_403}` })
  @ApiResponse({ status: 404, description: 'Missing, not yours, not opened to agents, not a Card, or no live grant at all' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async cardFill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentCardFillDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.cardFill({ ...httpReleaseContext(user, credential), cardId: id, ...dto }) };
  }

  @Post('cards/:id/grant-requests')
  @Auth({ permissions: [PERMISSIONS.AGENT_CARDS_FILL] })
  @ApiOperation({
    summary: 'Ask the owner to allow a card at a shop',
    description:
      'Creates a pending request the owner approves or declines in Vault (bell and email). Returns { id, status }; never card ' +
      'data. A pending request for the same card and merchant is returned instead of a new one. Scope vault:cards_fill. ' +
      'Rate limit: agentAccess.writePerMinute. Audited as agent.card.grant_request.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Card secret ID' })
  @ApiResponse({ status: 201, description: '{ data: { id, status } }' })
  @ApiResponse({ status: 403, description: `CARD_ACCESS_DISABLED, ${REFUSALS_403}` })
  @ApiResponse({ status: 404, description: 'Missing, not yours, not opened to agents, or not a Card' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async grantRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentCardGrantRequestDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.cardGrantRequest({ ...httpReleaseContext(user, credential), cardId: id, ...dto }) };
  }

  @Get('identity')
  @Auth({ permissions: [PERMISSIONS.AGENT_IDENTITY_READ] })
  @ApiOperation({
    summary: 'List the identity details opened to agents',
    description:
      'The caller\'s Identity secrets opened to agents with, per field, its label, whether it is sensitive and whether it ' +
      'is fillable on `origin`. Never a value. Scope vault:identity_read. 403 IDENTITY_ACCESS_DISABLED while ' +
      'agentAccess.identity.enabled is off. Rate limit: agentAccess.lookupPerMinute.',
  })
  @ApiQuery({ name: 'origin', type: String, description: 'The origin of the form' })
  @ApiResponse({ status: 200, description: 'Identity items and field labels' })
  @ApiResponse({ status: 403, description: `IDENTITY_ACCESS_DISABLED, ${REFUSALS_403}` })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async identity(
    @Query(new ZodValidationPipe(agentIdentityLookupQuerySchema)) query: { origin: string },
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.identityLookup({ ...httpReleaseContext(user, credential), origin: query.origin }) };
  }

  @Post('identity/:id/fill')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.AGENT_IDENTITY_FILL] })
  @ApiOperation({
    summary: 'Read one identity field to type it',
    description:
      'Returns ONE field. A sensitive field (date_of_birth, id_number) only when `origin` is exactly one of the item\'s ' +
      'allowed origins (403 ORIGIN_MISMATCH). Scope vault:identity_fill. Rate limit: agentAccess.identity.fillPerMinute ' +
      '(default 20). Audited as agent.identity.fill.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Identity secret ID' })
  @ApiResponse({ status: 200, description: '{ data: { value } }' })
  @ApiResponse({ status: 403, description: `ORIGIN_MISMATCH, IDENTITY_ACCESS_DISABLED, ${REFUSALS_403}` })
  @ApiResponse({ status: 404, description: 'Missing, not yours, not opened to agents, not an Identity, or no value' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async identityFill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentIdentityFillDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.identityFill({ ...httpReleaseContext(user, credential), identityId: id, ...dto }) };
  }
}
