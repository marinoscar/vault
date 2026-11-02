// =============================================================================
// Vault's own notification events (issue #86, E7.2, epic #62)
// =============================================================================
//
//   vault.backup_succeeded   a backup run finished (the owner for "My backups",
//                            the holders of `system_settings:read` for a system run)
//   vault.backup_failed      a backup run failed (same audience; static message only)
//   vault.card_expiring      a card's expiry month is 30, 7 or 0 days away (the owner)
//
// The events, their bell/push renderers and the email-template bindings live here; the
// templates are in `email-templates/`, the call sites in `backups/backup-notifier.service.ts`
// and `card-expiry/`. Push has no renderer of its own: it reads the browser one.
//
// KEYS, CHANNEL IDS AND TEMPLATE NAMES ARE PERSISTED: never rename one.
//
// DEFAULTS. A failed backup and an expiring card are things to act on, on by default
// over email and the bell/push. A succeeded backup is routine (a scheduled one runs
// every night), so it defaults OFF: a user or admin who wants the receipt turns it on.
// None is `mandatory`.
//
// NOTHING SECRET IS RENDERED. The payload types (`vault-notification-data.ts`) have no
// field for a card number, CVV or any secret value, and a backup failure carries the
// runner's static message only.
// =============================================================================

import type { BrowserNotificationContent, NotificationRegistration } from '@marinoscar/platform-api/notifications';

import {
  VAULT_BACKUP_FAILED_EVENT,
  VAULT_BACKUP_FAILED_TEMPLATE,
  VAULT_BACKUP_SUCCEEDED_EVENT,
  VAULT_BACKUP_SUCCEEDED_TEMPLATE,
  VAULT_CARD_EXPIRING_EVENT,
  VAULT_CARD_EXPIRING_TEMPLATE,
  backupCountsSummary,
  backupLinkFor,
  backupScopeLabel,
  cardExpiryPhrase,
  cardLinkFor,
  formatBytes,
  type VaultBackupNotificationData,
  type VaultCardExpiringNotificationData,
} from './vault-notification-data';

/** Bell and push copy of `vault.backup_succeeded`. */
export function vaultBackupSucceededBrowserTemplate(data: VaultBackupNotificationData): BrowserNotificationContent {
  return {
    title: 'Backup completed',
    body: `${backupScopeLabel(data)}: ${backupCountsSummary(data)}, ${formatBytes(data.sizeBytes)}.`,
    link: backupLinkFor(data.scope),
  };
}

/** Bell and push copy of `vault.backup_failed` (the static reason only). */
export function vaultBackupFailedBrowserTemplate(data: VaultBackupNotificationData): BrowserNotificationContent {
  return {
    title: 'Backup failed',
    body: `${backupScopeLabel(data)} did not complete. ${data.error ?? 'Open the backups page for details.'}`,
    link: backupLinkFor(data.scope),
  };
}

/** Bell and push copy of `vault.card_expiring`: the name and the expiry, nothing else about the card. */
export function vaultCardExpiringBrowserTemplate(data: VaultCardExpiringNotificationData): BrowserNotificationContent {
  return {
    title: 'A card is expiring',
    body: `${data.secretName} ${cardExpiryPhrase(data.threshold, data.expiry)}.`,
    link: cardLinkFor(data.secretId),
  };
}

export const VAULT_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: VAULT_BACKUP_SUCCEEDED_EVENT,
      label: 'Backup completed',
      description:
        'Sent when a backup finishes: to you for a backup you saved, and to administrators for the system backup. Off by default.',
      channels: ['email', 'browser'],
      defaultEnabled: false,
    },
    emailTemplate: VAULT_BACKUP_SUCCEEDED_TEMPLATE,
    browserTemplate: (data: never) => vaultBackupSucceededBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_BACKUP_FAILED_EVENT,
      label: 'Backup failed',
      description:
        'Sent when a backup fails: to you for a backup you saved, and to administrators for the system backup. The message names the backup and a short reason, never its contents.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_BACKUP_FAILED_TEMPLATE,
    browserTemplate: (data: never) => vaultBackupFailedBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_CARD_EXPIRING_EVENT,
      label: 'Card expiring',
      description:
        'Sent 30 days, 7 days and on the last day of the month before a card you keep expires. It names the card and its expiry month, never the number.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_CARD_EXPIRING_TEMPLATE,
    browserTemplate: (data: never) => vaultCardExpiringBrowserTemplate(data),
  },
];
