import { Module } from '@nestjs/common';

import { CredentialsModule } from '../platform/credentials/credentials.config';
import { SettingsModule } from '../settings/settings.module';

import { AiBurstLimiterService } from './ai-burst-limiter.service';
import { AiConfigService } from './ai-config.service';
import { AiVerifyController } from './ai-verify.controller';
import { AiVerifyService } from './ai-verify.service';
import { AiController } from './ai.controller';
import { CardExtractController } from './card-extract.controller';
import { CardExtractService } from './card-extract.service';
import { AI_VISION_PROVIDER } from './providers/vision-provider.interface';
import { OpenAiVisionProvider } from './providers/openai/openai-vision.provider';

/**
 * AI module.
 *
 * `SettingsModule` is imported for the non-secret AI settings (enabled, model,
 * budget). The OpenAI key is read from the platform credential store
 * (`CredentialsModule`, purpose `ai`, name `openai`) by `AiConfigService`, the
 * only place it is decrypted. `PrismaModule` is global, so
 * `PrismaService` needs no import for the audit/budget queries.
 *
 * The provider is bound through a Symbol token with `useClass`, mirroring
 * `STORAGE_PROVIDER`: swapping OpenAI for another vision backend is a one-line
 * change here, and tests override the token instead of stubbing the network.
 */
@Module({
  imports: [SettingsModule, CredentialsModule],
  controllers: [AiController, AiVerifyController, CardExtractController],
  providers: [
    {
      provide: AI_VISION_PROVIDER,
      useClass: OpenAiVisionProvider,
    },
    AiConfigService,
    AiBurstLimiterService,
    AiVerifyService,
    CardExtractService,
  ],
  exports: [AiConfigService],
})
export class AiModule {}
