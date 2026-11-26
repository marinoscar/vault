import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  Auth,
  AuthCredential,
  CurrentUser,
  type AuthCredentialInfo,
  type RequestUser,
} from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../core/roles.constants';
import { httpReleaseContext } from './agent-cards.controller';
import { AgentNoStoreInterceptor } from './agent-no-store.interceptor';
import { AgentServiceKeysService } from './agent-service-keys.service';

/**
 * Service keys on the agent API (`/api/agent/v1/service-keys`, issue #241, contract 1.4): the value of
 * a `Service Key` secret the owner opened to agents, for the calling server process. Accepts `oat_`
 * and `pat_` credentials only; every response is `Cache-Control: no-store`. The rules live in
 * `AgentServiceKeysService`, the same implementation an embedded host calls in process
 * (`SERVICE_KEY_RELEASE_PORT`).
 *
 * @stability experimental
 */
@ApiTags('Agent')
@Controller('agent/v1')
@UseInterceptors(AgentNoStoreInterceptor)
export class AgentServiceKeysController {
  constructor(private readonly serviceKeys: AgentServiceKeysService) {}

  @Get('service-keys/:service/:name')
  @Auth({ permissions: [PERMISSIONS.AGENT_SERVICE_KEYS_READ] })
  @ApiOperation({
    summary: 'Read a service key for a server-side call',
    description:
      'Returns { value } of the caller\'s Service Key secret opened to agents whose service and key name equal the path ' +
      '(trimmed, lower-cased). For the calling server process only: never show it to a model. No origin. Scope ' +
      'vault:service_keys_read. Rate limit: 120 a minute per owner and service. Audited as agent.service_key.read ' +
      '(service, name, caller; never the value).',
  })
  @ApiParam({ name: 'service', type: String, description: 'The service, for example web_search' })
  @ApiParam({ name: 'name', type: String, description: 'The key name within the service, for example provider_a' })
  @ApiResponse({ status: 200, description: '{ data: { value } }' })
  @ApiResponse({ status: 400, description: 'service or name is not a valid id' })
  @ApiResponse({ status: 403, description: 'AGENT_ACCESS_DISABLED, a browser session (AGENT_CREDENTIAL_REQUIRED), or insufficient_scope' })
  @ApiResponse({ status: 404, description: 'No opened service key with this service and name (missing, closed or not yours: identical)' })
  @ApiResponse({ status: 409, description: 'SERVICE_KEY_AMBIGUOUS: more than one opened key has this service and name' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async read(
    @Param('service') service: string,
    @Param('name') name: string,
    @CurrentUser() user: RequestUser,
    @AuthCredential() credential: AuthCredentialInfo | null,
  ) {
    return { data: await this.serviceKeys.read({ ...httpReleaseContext(user, credential), service, name }) };
  }
}
