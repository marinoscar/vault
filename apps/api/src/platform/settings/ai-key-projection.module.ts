import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { CredentialsModule } from '../credentials/credentials.config';
import { AiKeyProjectionInterceptor } from './ai-key-projection.interceptor';

/**
 * Keeps the AI key write-only on the credential store and the masked projection
 * on `ai` of `/api/system-settings` (the platform settings registry refuses a
 * secret-named field). Imports `CredentialsModule`, which is not global.
 */
@Module({
  imports: [CredentialsModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AiKeyProjectionInterceptor }],
})
export class AiKeyProjectionModule {}
