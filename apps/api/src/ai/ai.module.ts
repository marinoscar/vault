import { Module } from '@nestjs/common';

import { aiModule } from '../platform/ai/ai.config';
import { CredentialsModule } from '../platform/credentials/credentials.config';

import { AiConfigService } from './ai-config.service';
import { AiStatusController } from './ai-status.controller';
import { CardExtractController } from './card-extract.controller';
import { CardExtractService } from './card-extract.service';

/**
 * Vault's AI surface: card extraction over the platform AI slice (`aiModule`,
 * `platform/ai/ai.config.ts`, which exports `AiService` and the kill-switch
 * guard) and the `GET /api/ai/status` compatibility alias. No provider SDK, key
 * or policy check lives here.
 */
@Module({
  imports: [aiModule, CredentialsModule],
  controllers: [AiStatusController, CardExtractController],
  providers: [CardExtractService, AiConfigService],
  exports: [AiConfigService],
})
export class AiModule {}
