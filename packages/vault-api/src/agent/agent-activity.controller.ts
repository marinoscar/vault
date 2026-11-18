import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  Auth,
  AuthCredential,
  CurrentUser,
  type AuthCredentialInfo,
  type RequestUser,
} from '@marinoscar/platform-api/identity';
import {
  AGENT_ERROR_CODES,
  agentActivityQuerySchema,
  type AgentActivityQuery,
} from '@marinoscar/vault-contract/agent';

import { PERMISSIONS } from '../core/roles.constants';
import { AgentActivityService } from './agent-activity.service';

/**
 * The owner's agent trail (`GET /api/agent-activity`, E14.7). A browser session or a personal access
 * token reads it; an OAuth access token is refused, so an agent cannot read (or learn from) its own
 * trail. Only the caller's own events are returned. Contract: `@marinoscar/vault-contract/agent`.
 *
 * @stability experimental
 */
@ApiTags('Agent')
@Controller('agent-activity')
export class AgentActivityController {
  constructor(private readonly activity: AgentActivityService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'List what agents did with your logins',
    description:
      'The caller\'s own agent audit events (lookup, fill, totp, create, rotate and the agent-access toggle), newest ' +
      'first. Never a value. `agent_access` events carry the new access level in `field`. Session or PAT only; an OAuth ' +
      'access token answers 403 AGENT_ACTIVITY_FORBIDDEN. Requires secrets:read.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Max 100' })
  @ApiQuery({ name: 'action', required: false, enum: ['lookup', 'fill', 'totp', 'create', 'rotate', 'agent_access'] })
  @ApiQuery({ name: 'secretId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'clientId', required: false, type: String })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO 8601, inclusive' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO 8601, inclusive' })
  @ApiResponse({ status: 200, description: '{ data: AgentActivityItem[], meta: { page, pageSize, total } }' })
  @ApiResponse({ status: 403, description: 'AGENT_ACTIVITY_FORBIDDEN (OAuth token) or a missing permission' })
  async list(
    @Query(new ZodValidationPipe(agentActivityQuerySchema)) query: AgentActivityQuery,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    if (credential?.kind === 'oauth') {
      throw new ForbiddenException({
        code: AGENT_ERROR_CODES.AGENT_ACTIVITY_FORBIDDEN,
        message: 'The agent activity list is not available to an OAuth access token',
      });
    }
    return this.activity.list(user.id, query);
  }
}
