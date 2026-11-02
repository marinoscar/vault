// =============================================================================
// The notification registries, filled (issue #85, E7.1, epic #54)
// =============================================================================
//
// IMPORTED BY `notifications.config.ts` BEFORE `NotificationsModule.forRoot`
// composes, and before the application is created: the registries freeze when it
// bootstraps. A side-effect module, idempotent per process (a second registration
// of one key is `DUPLICATE_ID` and Jest may import this from several specs).
//
// ORDER IS LOAD-BEARING, each step validates against the one before it:
//
//   1. the platform channels (`email`, `browser`, `push`);
//   2. the email rendering context (layout theme and brand mark);
//   3. the platform email templates (`user-welcome`, `broadcast`, `role-changed`, ...);
//   4. this app's email templates (`email-templates/`, E7.2, #86);
//   5. the notifications. A binding may only name a template registered in 3 or 4,
//      and the array order is the order of the preferences matrix.
//
// KEYS, CHANNEL IDS AND TEMPLATE NAMES ARE PERSISTED (preferences, delivery
// rows): never rename one. Vault's own events (backup results, card expiry) are
// `vault.notifications.ts` (E7.2, #86).
// =============================================================================

import {
  BROADCASTS_NOTIFICATIONS,
  NODES_NOTIFICATIONS,
  OPS_NOTIFICATIONS,
  registerNotifications,
  registerPlatformNotificationChannels,
} from '@marinoscar/platform-api/notifications';
import { configureEmailRendering, registerPlatformEmailTemplates } from '@marinoscar/platform-api/email';

// The SMTP, SES and VAPID credential purposes must be registered before the
// credential store is used; importing the manifest is idempotent.
import '../credentials/credential-purposes.manifest';
import { registerVaultEmailTemplates } from '../../email-templates';
import { DB_BACKUP_NOTIFICATIONS } from '../../notifications-registry/db-backup.notifications';
import { IDENTITY_NOTIFICATIONS } from '../../notifications-registry/identity.notifications';
import { VAULT_NOTIFICATIONS } from '../../notifications-registry/vault.notifications';
import { EMAIL_MODULE_OPTIONS } from '../email/email.options';

let registered = false;

if (!registered) {
  registered = true;

  registerPlatformNotificationChannels();
  configureEmailRendering(EMAIL_MODULE_OPTIONS);
  registerPlatformEmailTemplates();
  registerVaultEmailTemplates();

  registerNotifications([
    ...IDENTITY_NOTIFICATIONS,
    ...VAULT_NOTIFICATIONS,
    ...BROADCASTS_NOTIFICATIONS,
    ...OPS_NOTIFICATIONS,
    ...NODES_NOTIFICATIONS,
    // E9.1: the whole-database backup events (appended, the preferences matrix order is stable).
    ...DB_BACKUP_NOTIFICATIONS,
  ]);
}
