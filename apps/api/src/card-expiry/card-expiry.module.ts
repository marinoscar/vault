import { Module } from '@nestjs/common';

import { CommonModule } from '../common/common.module';
import { CardExpiryScanHandler } from './card-expiry-scan.handler';
import { CardExpiryTask } from './card-expiry.task';

/**
 * Card expiry reminders (E7.2, #86). `JobsService`, `JobHandlerRegistry` and `NotificationsService`
 * come from the global jobs and notifications modules; the handler self-registers in `onModuleInit`.
 */
@Module({
  imports: [CommonModule],
  providers: [CardExpiryScanHandler, CardExpiryTask],
})
export class CardExpiryModule {}
