import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';

import { AiConfigService } from './ai-config.service';

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly aiConfig: AiConfigService) {}

  /**
   * Bare `@Auth()` - any signed-in user, no permission.
   *
   * This exists because system settings are admin-gated, so a Viewer has no way
   * to discover whether AI is configured. Without it, "hide the scan button
   * when the feature is unavailable" is unimplementable and every Viewer gets
   * offered a button that can only return 503.
   *
   * The response is deliberately two booleans. The model name, the key mask and
   * the reason for being unavailable all stay behind the admin gate.
   */
  @Get('status')
  @Auth()
  @ApiOperation({
    summary: 'Whether AI-backed features are available to the current user',
    description:
      'Returns false when the feature flag is off, when no API key is stored, or when the ' +
      'stored key cannot be decrypted. Exposes no model or credential metadata.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        features: {
          type: 'object',
          properties: { cardExtract: { type: 'boolean' } },
        },
      },
    },
  })
  async status() {
    const enabled = await this.aiConfig.isReady();
    return { data: { enabled, features: { cardExtract: enabled } } };
  }
}
