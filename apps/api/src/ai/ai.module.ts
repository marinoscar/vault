import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';

import { AiBurstLimiterService } from './ai-burst-limiter.service';
import { AiConfigService } from './ai-config.service';
import { AiController } from './ai.controller';
import { CardExtractController } from './card-extract.controller';
import { CardExtractService } from './card-extract.service';
import { AI_VISION_PROVIDER } from './providers/vision-provider.interface';
import { OpenAiVisionProvider } from './providers/openai/openai-vision.provider';

/**
 * AI module.
 *
 * `SettingsModule` is imported for `SystemSettingsService`, the only sanctioned
 * way to reach the decrypted OpenAI credential. `PrismaModule` is global, so
 * `PrismaService` needs no import for the audit/budget queries.
 *
 * The provider is bound through a Symbol token with `useClass`, mirroring
 * `STORAGE_PROVIDER`: swapping OpenAI for another vision backend is a one-line
 * change here, and tests override the token instead of stubbing the network.
 */
@Module({
  imports: [SettingsModule],
  controllers: [AiController, CardExtractController],
  providers: [
    {
      provide: AI_VISION_PROVIDER,
      useClass: OpenAiVisionProvider,
    },
    AiConfigService,
    AiBurstLimiterService,
    CardExtractService,
  ],
  exports: [AiConfigService],
})
export class AiModule {}
