// =============================================================================
// The database backup events (issue #89, E9.1, epic #64)
// =============================================================================
//
// `db_backup.backup_failed` and `db_backup.restore_completed`, raised by the platform
// db-backup slice (through `DB_BACKUP_NOTIFIER`, after the settling write commits) to the
// holders of `db_backup:read`. The audience is a permission, not a person: whoever can act
// on a backup is told when one fails. The platform ships both email templates
// (`backup-failed`, `restore-completed`, registered by `registerPlatformEmailTemplates`) and
// both browser renderers.
//
// These are the WHOLE-DATABASE events. Vault's own logical secret backups raise
// `vault.backup_succeeded` / `vault.backup_failed` (`vault.notifications.ts`); the keys are
// different on purpose so a preference for one never silences the other.
//
// ONE OF THE TWO IS MANDATORY: a failed backup is something an operator may watch elsewhere,
// but a COMPLETED RESTORE replaced the live database with an older copy of itself and
// everybody who can act on that must be told, whatever their preferences say.
//
// KEYS ARE PERSISTED (preferences, delivery rows): never rename one.
// =============================================================================

import {
  backupFailedBrowserTemplate,
  restoreCompletedBrowserTemplate,
  type NotificationRegistration,
} from '@marinoscar/platform-api/notifications';

export const DB_BACKUP_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'db_backup.backup_failed',
      label: 'Database backup failed',
      description:
        'Sent when a whole-database backup run fails, or stops heartbeating and is given up on. The deployment has one fewer recovery point than it thinks.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: 'backup-failed',
    browserTemplate: backupFailedBrowserTemplate,
  },

  {
    event: {
      key: 'db_backup.restore_completed',
      label: 'Database restored',
      description:
        'Sent when a database restore finishes and the restored copy becomes the live database. This cannot be turned off.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
      // Silence is itself the risk: every write made after the archive was taken is gone,
      // and the process that did it exits immediately afterwards.
      mandatory: true,
    },
    emailTemplate: 'restore-completed',
    browserTemplate: restoreCompletedBrowserTemplate,
  },
];
