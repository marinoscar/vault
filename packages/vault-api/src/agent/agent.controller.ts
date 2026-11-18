import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  Auth,
  CurrentUser,
  OAuthGrant,
  type RequestUser,
} from '@marinoscar/platform-api/identity';
import type { OAuthPrincipalInfo } from '@marinoscar/platform-api/core';

import { PERMISSIONS } from '../core/roles.constants';

/**
 * The agent API's root (`/api/agent/v1`, the `agent` OAuth protected resource). E14.2 ships only
 * `whoami`; the item routes arrive with E14.6.
 */
@ApiTags('Agent')
@Controller('agent/v1')
export class AgentController {
  @Get('whoami')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({ summary: 'Who the agent token acts as and which scopes it carries' })
  @ApiResponse({ status: 200, description: 'The caller, its scopes and its OAuth client' })
  whoami(@CurrentUser() user: RequestUser, @OAuthGrant() grant: OAuthPrincipalInfo | null) {
    return {
      userId: user.id,
      scopes: grant ? [...grant.scopes] : [],
      clientId: grant?.clientId ?? null,
    };
  }
}
