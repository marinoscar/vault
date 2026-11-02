import { Injectable, Logger } from '@nestjs/common';
import type {
  AllowlistInvitationNotice,
  IdentityNotifier,
  OrgInvitationNotice,
  RoleChangedNotice,
  UserWelcomeNotice,
} from '@marinoscar/platform-api/identity';

/**
 * Identity's `IDENTITY_NOTIFIER`: logs each notice (never an address or a name).
 * Vault has no notification system before E7; that epic binds the platform's
 * `NotificationsService` here and the notices become e-mail, in-app and push.
 */
@Injectable()
export class LoggingIdentityNotifier implements IdentityNotifier {
  private readonly logger = new Logger('IdentityNotifier');

  async roleChanged(userId: string, notice: RoleChangedNotice): Promise<void> {
    this.logger.log(`roles of ${userId} changed to ${notice.currentRoles.join(', ')}`);
  }

  async userWelcomed(userId: string, _notice: UserWelcomeNotice): Promise<void> {
    this.logger.log(`welcome notice for ${userId}`);
  }

  async allowlistInvitation(_email: string, _notice: AllowlistInvitationNotice): Promise<void> {
    this.logger.log('allowlist invitation recorded');
  }

  async orgInvitation(_email: string, notice: OrgInvitationNotice): Promise<void> {
    this.logger.debug(`Dropping an organization invitation to "${notice.orgName}": single-organization mode`);
  }
}
