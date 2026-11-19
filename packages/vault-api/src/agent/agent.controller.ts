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
  OAuthGrant,
  type AuthCredentialInfo,
  type RequestUser,
} from '@marinoscar/platform-api/identity';
import type { OAuthPrincipalInfo } from '@marinoscar/platform-api/core';

import { PERMISSIONS } from '../core/roles.constants';
import { httpReleaseContext } from './agent-cards.controller';
import { AgentCredentialsService } from './agent-credentials.service';
import { AgentNoStoreInterceptor } from './agent-no-store.interceptor';
import { AgentReleaseService } from './agent-release.service';
import {
  AgentCreateCredentialDto,
  AgentFillDto,
  AgentRotatePasswordDto,
  AgentTotpDto,
  agentLookupQuerySchema,
} from './dto';

/**
 * The agent credential API (`/api/agent/v1`, the `agent` OAuth protected resource; E14.2 and E14.6).
 * Accepts `oat_` and `pat_` credentials only. Contract: `@marinoscar/vault-contract/agent`. Every
 * response carries `Cache-Control: no-store` and `Pragma: no-cache`; request and response bodies are
 * never logged. Lookup, fill and totp go through `AgentReleaseService` (the same implementation an
 * embedded host calls in process); create and rotate through `AgentCredentialsService`.
 *
 * @stability experimental
 */
@ApiTags('Agent')
@Controller('agent/v1')
@UseInterceptors(AgentNoStoreInterceptor)
export class AgentController {
  constructor(
    private readonly agent: AgentCredentialsService,
    private readonly release: AgentReleaseService,
  ) {}

  @Get('whoami')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'Who the agent token acts as and which scopes it carries',
    description: 'Answers 403 AGENT_ACCESS_DISABLED while the deployment switch `agentAccess.enabled` is off.',
  })
  @ApiResponse({ status: 200, description: 'The caller, its scopes and its OAuth client' })
  @ApiResponse({ status: 403, description: 'AGENT_ACCESS_DISABLED, or the scope is missing (insufficient_scope)' })
  async whoami(@CurrentUser() user: RequestUser, @OAuthGrant() grant: OAuthPrincipalInfo | null) {
    await this.agent.assertEnabled();
    return {
      userId: user.id,
      scopes: grant ? [...grant.scopes] : [],
      clientId: grant?.clientId ?? null,
    };
  }

  @Get('credentials')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'Find the logins opened to agents for a website',
    description:
      'The caller\'s Credential secrets with agentAccess=fill whose origins match `origin`, exact matches first. ' +
      'Returns id, name, username, origins, matchKind, hasTotp and updatedAt; never a sensitive value. ' +
      'Scope vault:items_read. Rate limit: agentAccess.lookupPerMinute (default 60).',
  })
  @ApiQuery({ name: 'origin', type: String, description: 'The website URL or origin on screen' })
  @ApiResponse({ status: 200, description: 'Matching credentials' })
  @ApiResponse({ status: 400, description: 'origin is not a valid https origin' })
  @ApiResponse({ status: 403, description: 'AGENT_ACCESS_DISABLED, a browser session, or insufficient_scope' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async lookup(
    @Query(new ZodValidationPipe(agentLookupQuerySchema)) query: { origin: string },
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.lookup({ ...httpReleaseContext(user, credential), origin: query.origin }) };
  }

  @Post('credentials/:id/fill')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.SECRETS_FILL] })
  @ApiOperation({
    summary: 'Read one field of a login to type it',
    description:
      'Returns the value of ONE field (`username` or `password`) of a credential opened to agents. 403 ORIGIN_MISMATCH ' +
      'unless `origin` is exactly one of the credential\'s origins. The value is for typing, never for a model. ' +
      'Scope vault:items_fill. Rate limit: agentAccess.fillPerMinute (default 30). Audited as agent.credential.fill.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: '{ data: { value } }' })
  @ApiResponse({ status: 403, description: 'ORIGIN_MISMATCH, AGENT_ACCESS_DISABLED, a browser session, or insufficient_scope' })
  @ApiResponse({ status: 404, description: 'Missing, not yours, not opened to agents, or not a Credential' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async fill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentFillDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.fill({ ...httpReleaseContext(user, credential), secretId: id, ...dto }) };
  }

  @Post('credentials/:id/totp')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.SECRETS_FILL] })
  @ApiOperation({
    summary: 'Read the current one-time code of a login',
    description:
      'Returns { code, expiresAt } computed server-side from the stored seed (never returned). Same origin rule as fill; ' +
      '404 when the credential has no usable TOTP seed. Scope vault:items_fill. Rate limit: agentAccess.totpPerMinute ' +
      '(default 10). Audited as agent.credential.totp.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: '{ data: { code, expiresAt } }' })
  @ApiResponse({ status: 403, description: 'ORIGIN_MISMATCH, AGENT_ACCESS_DISABLED, a browser session, or insufficient_scope' })
  @ApiResponse({ status: 404, description: 'Missing, not yours, not opened to agents, or no TOTP' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async totp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentTotpDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.release.totp({ ...httpReleaseContext(user, credential), secretId: id, ...dto }) };
  }

  @Post('credentials')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Save a new login opened to agents',
    description:
      'Creates a Credential owned by the caller with agentAccess=fill. Send exactly one of `password` and `generate` ' +
      '({ length 12..128 default 24, symbols default true }). A generated password is returned once, in this response ' +
      'only. 409 when the caller already has a secret of that name. Scope vault:items_write. Rate limit: ' +
      'agentAccess.writePerMinute (default 10). Audited as agent.credential.create.',
  })
  @ApiResponse({ status: 201, description: '{ data: { id, name, username, origins, generatedPassword? } }' })
  @ApiResponse({ status: 400, description: 'Invalid body or origin' })
  @ApiResponse({ status: 403, description: 'AGENT_ACCESS_DISABLED, a browser session, or insufficient_scope' })
  @ApiResponse({ status: 409, description: 'A secret with that name exists' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async create(
    @Body() dto: AgentCreateCredentialDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.agent.create({ userId: user.id, credential: credential ?? null }, dto) };
  }

  @Post('credentials/:id/password')
  @HttpCode(HttpStatus.OK)
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Rotate the password of a login',
    description:
      'Creates a new version with the new password (rollback stays possible). Send exactly one of `password` and ' +
      '`generate`; a generated password is returned once. The credential must be opened to agents and `origin` must ' +
      'match exactly. Scope vault:items_write. Rate limit: agentAccess.writePerMinute (default 10). Audited as ' +
      'agent.credential.rotate.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: '{ data: { id, version, generatedPassword? } }' })
  @ApiResponse({ status: 403, description: 'ORIGIN_MISMATCH, AGENT_ACCESS_DISABLED, a browser session, or insufficient_scope' })
  @ApiResponse({ status: 404, description: 'Missing, not yours, not opened to agents, or not a Credential' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async rotate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentRotatePasswordDto,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.agent.rotate({ userId: user.id, credential: credential ?? null }, id, dto) };
  }
}
