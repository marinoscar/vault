import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AiConfigService as PlatformAiConfigService } from '@marinoscar/platform-api/ai';
import { Auth, CurrentUser, type RequestUser } from '@marinoscar/platform-api/identity';

import { AI_PROVIDER_ID } from './ai.constants';

/**
 * `GET /api/ai/status`: compatibility alias for the platform's
 * `GET /api/ai/config`, kept until the web and the CLI move to the platform route
 * (E10 / E11). Same wire shape as before: `{ data: { enabled, features: { cardExtract } } }`.
 *
 * Bare `@Auth()` (any signed-in user) and deliberately NOT behind `AiEnabledGuard`:
 * it is how a client learns to hide the scan button while AI is off.
 *
 * `enabled` is true when the caller's organization has AI on, the OpenAI provider
 * is switched on, and the deployment key is stored AND serves everyone
 * (`keyPolicy: 'byok_with_org_fallback'`: Vault users hold no key of their own).
 * It exposes no model name, key hint or reason.
 */
@ApiTags('AI')
@Controller('ai')
export class AiStatusController {
  constructor(private readonly aiConfig: PlatformAiConfigService) {}

  @Get('status')
  @Auth()
  @ApiOperation({
    summary: 'Whether AI-backed features are available to the current user',
    description:
      'Compatibility alias of `GET /api/ai/config`, reduced to two booleans. False when AI or the ' +
      'OpenAI provider is off, when no deployment key is stored, or when the key policy would make ' +
      'a user supply their own key. Exposes no model or credential metadata.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        features: { type: 'object', properties: { cardExtract: { type: 'boolean' } } },
      },
    },
  })
  async status(@CurrentUser() user: RequestUser) {
    const config = await this.aiConfig.describePublic(user.activeOrgId ?? undefined);
    const provider = config.providers.find((p) => p.id === AI_PROVIDER_ID);
    const enabled =
      config.enabled &&
      config.keyPolicy === 'byok_with_org_fallback' &&
      provider?.enabled === true &&
      provider.hasOrgKey === true;
    return { data: { enabled, features: { cardExtract: enabled } } };
  }
}
