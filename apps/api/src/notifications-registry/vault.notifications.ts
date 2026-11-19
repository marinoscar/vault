// =============================================================================
// Vault's own notification events (issue #86, E7.2, epic #62)
// =============================================================================
//
//   vault.backup_succeeded   a backup run finished (the owner for "My backups",
//                            the holders of `system_settings:read` for a system run)
//   vault.backup_failed      a backup run failed (same audience; static message only)
//   vault.card_expiring      a card's expiry month is 30, 7 or 0 days away (the owner)
//   vault.agent_credential_changed  an app saved a login or changed a password (E14.7; email + bell)
//   vault.agent_new_app      the first successful fill by an app (email + bell)
//   vault.agent_credential_used     a successful fill or one-time code (bell only, counted)
//   vault.agent_card_grant_requested an app asks to use a card at a shop (ADR-0003; email + bell)
//   vault.agent_card_first_release   a card was released under a grant for the first time (email + bell)
//   vault.agent_card_declined        Vault refused a card fill by a grant rule (email + bell, throttled)
//
// The platform's event key pattern allows exactly one dot, so the agent events are
// `vault.agent_*`. The platform has no digest support, so there is no daily email digest of
// credential use (follow-up: docs/SECRETS.md, "Agent activity").
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
  AGENT_CARD_DECLINE_REASONS,
  VAULT_AGENT_CARD_DECLINED_EVENT,
  VAULT_AGENT_CARD_DECLINED_TEMPLATE,
  VAULT_AGENT_CARD_FIRST_RELEASE_EVENT,
  VAULT_AGENT_CARD_FIRST_RELEASE_TEMPLATE,
  VAULT_AGENT_CARD_GRANT_REQUESTED_EVENT,
  VAULT_AGENT_CARD_GRANT_REQUESTED_TEMPLATE,
  agentCardAmountPhrase,
  type VaultAgentCardDeclinedNotificationData,
  type VaultAgentCardFirstReleaseNotificationData,
  type VaultAgentCardGrantRequestedNotificationData,
  VAULT_AGENT_CREDENTIAL_CHANGED_EVENT,
  VAULT_AGENT_CREDENTIAL_CHANGED_TEMPLATE,
  VAULT_AGENT_CREDENTIAL_USED_EVENT,
  VAULT_AGENT_NEW_APP_EVENT,
  VAULT_AGENT_NEW_APP_TEMPLATE,
  VAULT_BACKUP_FAILED_EVENT,
  VAULT_BACKUP_FAILED_TEMPLATE,
  VAULT_BACKUP_SUCCEEDED_EVENT,
  VAULT_BACKUP_SUCCEEDED_TEMPLATE,
  VAULT_CARD_EXPIRING_EVENT,
  VAULT_CARD_EXPIRING_TEMPLATE,
  AGENT_ACTIVITY_SETTINGS_PATH,
  agentCredentialChangedPhrase,
  agentSecretLinkFor,
  backupCountsSummary,
  backupLinkFor,
  backupScopeLabel,
  cardExpiryPhrase,
  cardLinkFor,
  formatBytes,
  type VaultAgentCredentialChangedNotificationData,
  type VaultAgentCredentialUsedNotificationData,
  type VaultAgentNewAppNotificationData,
  type VaultBackupNotificationData,
  type VaultCardExpiringNotificationData,
} from '@marinoscar/vault-api/core';

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

/** Bell and push copy of `vault.agent_credential_changed`: the app, the login and the website; never a value. */
export function vaultAgentCredentialChangedBrowserTemplate(
  data: VaultAgentCredentialChangedNotificationData,
): BrowserNotificationContent {
  return {
    title: data.change === 'created' ? 'An app saved a login' : 'An app changed a password',
    body: `${agentCredentialChangedPhrase(data)}.`,
    link: agentSecretLinkFor(data.secretId),
  };
}

/** Bell and push copy of `vault.agent_new_app`. */
export function vaultAgentNewAppBrowserTemplate(data: VaultAgentNewAppNotificationData): BrowserNotificationContent {
  return {
    title: 'A new app used a login',
    body: `${data.clientName} used ${data.secretName}${data.origin ? ` on ${data.origin}` : ''} for the first time.`,
    link: AGENT_ACTIVITY_SETTINGS_PATH,
  };
}

/** Bell and push copy of `vault.agent_credential_used` (counted: `count` grows while the row is live). */
export function vaultAgentCredentialUsedBrowserTemplate(
  data: VaultAgentCredentialUsedNotificationData,
): BrowserNotificationContent {
  const what = data.action === 'totp' ? 'read a one-time code of' : 'filled';
  const times = data.count && data.count > 1 ? ` (${data.count} times)` : '';
  return {
    title: 'An app used a login',
    body: `${data.clientName} ${what} ${data.secretName}${data.origin ? ` on ${data.origin}` : ''}${times}.`,
    link: AGENT_ACTIVITY_SETTINGS_PATH,
  };
}

/** Bell and push copy of `vault.agent_card_grant_requested`: links to the card, where Approve and Decline are. */
export function vaultAgentCardGrantRequestedBrowserTemplate(
  data: VaultAgentCardGrantRequestedNotificationData,
): BrowserNotificationContent {
  return {
    title: 'An app asks to use a card',
    body: `${data.clientName} asks to use ${data.secretName}${data.origin ? ` at ${data.origin}` : ''} for ${agentCardAmountPhrase(data)}.`,
    link: agentSecretLinkFor(data.secretId),
  };
}

/** Bell and push copy of `vault.agent_card_first_release`. */
export function vaultAgentCardFirstReleaseBrowserTemplate(
  data: VaultAgentCardFirstReleaseNotificationData,
): BrowserNotificationContent {
  return {
    title: 'A card was used by an app',
    body: `${data.clientName} used ${data.secretName}${data.origin ? ` at ${data.origin}` : ''} for the first time (${agentCardAmountPhrase(data)}).`,
    link: AGENT_ACTIVITY_SETTINGS_PATH,
  };
}

/** Bell and push copy of `vault.agent_card_declined`: the static reason, never a card value. */
export function vaultAgentCardDeclinedBrowserTemplate(data: VaultAgentCardDeclinedNotificationData): BrowserNotificationContent {
  return {
    title: 'Vault declined a card use',
    body: `${data.clientName} could not use ${data.secretName}: ${AGENT_CARD_DECLINE_REASONS[data.reason]}.`,
    link: AGENT_ACTIVITY_SETTINGS_PATH,
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
  {
    event: {
      key: VAULT_AGENT_CREDENTIAL_CHANGED_EVENT,
      label: 'An app saved or changed a login',
      description:
        'Sent right away when an agent app saves a new login or changes the password of one. It names the app, the login and the website, never the password.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_AGENT_CREDENTIAL_CHANGED_TEMPLATE,
    browserTemplate: (data: never) => vaultAgentCredentialChangedBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_AGENT_NEW_APP_EVENT,
      label: 'A new app used a login',
      description:
        'Sent the first time an agent app (or a personal access token) fills one of your logins. Remove the app in Connected apps if you do not recognise it.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_AGENT_NEW_APP_TEMPLATE,
    browserTemplate: (data: never) => vaultAgentNewAppBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_AGENT_CREDENTIAL_USED_EVENT,
      label: 'An app used a login',
      description:
        'Shown in the bell each time an agent app fills a login or reads a one-time code; uses of the same login by the same app within an hour are folded into one entry. No email.',
      channels: ['browser'],
      defaultEnabled: true,
      kind: 'counted',
    },
    browserTemplate: (data: never) => vaultAgentCredentialUsedBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_AGENT_CARD_GRANT_REQUESTED_EVENT,
      label: 'An app asks to use a card',
      description:
        'Sent right away when an agent app asks to use one of your cards at a shop. Approve or decline it on the card. It names the app, the card, the shop and the amount, never the card number.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_AGENT_CARD_GRANT_REQUESTED_TEMPLATE,
    browserTemplate: (data: never) => vaultAgentCardGrantRequestedBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_AGENT_CARD_FIRST_RELEASE_EVENT,
      label: 'A card was used at a shop for the first time',
      description:
        'Sent the first time an agent app uses one of your cards at a shop you allowed. It names the app, the card, the shop and the amount, never the card number.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_AGENT_CARD_FIRST_RELEASE_TEMPLATE,
    browserTemplate: (data: never) => vaultAgentCardFirstReleaseBrowserTemplate(data),
  },
  {
    event: {
      key: VAULT_AGENT_CARD_DECLINED_EVENT,
      label: 'Vault declined a card use',
      description:
        'Sent when Vault refuses to give a card to an agent app because of your limits (amount, currency, shop, security code, daily or monthly limit, expiry); at most once an hour per card, shop and reason.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: VAULT_AGENT_CARD_DECLINED_TEMPLATE,
    browserTemplate: (data: never) => vaultAgentCardDeclinedBrowserTemplate(data),
  },
];
