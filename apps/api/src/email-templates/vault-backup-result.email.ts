import { APP_NAME } from '@app/shared';
import {
  TRANSACTIONAL_EMAIL_HEADERS,
  formatEmailDateTime,
  html,
  plainText,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

import {
  backupCountsSummary,
  backupLinkFor,
  backupScopeLabel,
  formatBytes,
  type VaultBackupNotificationData,
} from '@marinoscar/vault-api/core';
import { absoluteLink, detailRow } from './vault-email-common';

// =============================================================================
// `vault.backup_succeeded` and `vault.backup_failed` (issue #86, E7.2, epic #62)
// =============================================================================
//
// Which backup, when, how big and how many (success), or the STATIC failure message
// (failure). The failure copy never carries a raw error, a storage path or a
// password: `data.error` is one of `BACKUP_FAILURE_MESSAGES`, written by the runner.
// Every interpolation goes through the `html` tag, so it is escaped by construction.
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'vault-backup-succeeded': VaultBackupNotificationData;
    'vault-backup-failed': VaultBackupNotificationData;
  }
}

/** Renders "your backup finished". */
export function vaultBackupSucceededEmail(
  data: VaultBackupNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const scope = backupScopeLabel(data);
  const finished = formatEmailDateTime(data.finishedAt, context);
  const size = formatBytes(data.sizeBytes);
  const counts = backupCountsSummary(data);
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, backupLinkFor(data.scope));
  const ctaLabel = ctaUrl ? 'View backups' : undefined;

  const subject = `${APP_NAME}: ${scope.toLowerCase()} completed`;
  const rows = [
    detailRow('Backup', scope),
    detailRow('Finished', finished),
    detailRow('Size', size),
    detailRow('Contents', counts),
    ...(data.warningCount > 0 ? [detailRow('Warnings', String(data.warningCount))] : []),
  ];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">The backup finished and the archive is stored.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      You can turn these messages off in your notification preferences.
    </p>
  `;

  return {
    subject,
    html: renderLayout(
      { title: 'Backup completed', previewText: `${scope}: ${counts}, ${size}`, bodyHtml, ctaLabel, ctaUrl },
      context,
    ),
    text: plainText(
      {
        title: 'Backup completed',
        lines: [
          'The backup finished and the archive is stored.',
          '',
          `  Backup:    ${scope}`,
          `  Finished:  ${finished}`,
          `  Size:      ${size}`,
          `  Contents:  ${counts}`,
          ...(data.warningCount > 0 ? [`  Warnings:  ${data.warningCount}`] : []),
          '',
          'You can turn these messages off in your notification preferences.',
        ],
        ctaLabel,
        ctaUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/** Renders "your backup failed", with the static reason only. */
export function vaultBackupFailedEmail(
  data: VaultBackupNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const scope = backupScopeLabel(data);
  const finished = formatEmailDateTime(data.finishedAt, context);
  const reason = data.error ?? 'The backup could not be completed.';
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, backupLinkFor(data.scope));
  const ctaLabel = ctaUrl ? 'View backups' : undefined;

  const subject = `${APP_NAME}: ${scope.toLowerCase()} failed`;
  const rows = [detailRow('Backup', scope), detailRow('Failed at', finished), detailRow('Reason', reason)];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">A backup did not complete, so no new archive was stored.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      Open the backups page for the run history. You can turn these messages off in your
      notification preferences.
    </p>
  `;

  return {
    subject,
    html: renderLayout(
      { title: 'Backup failed', previewText: `${scope}: ${reason}`, bodyHtml, ctaLabel, ctaUrl },
      context,
    ),
    text: plainText(
      {
        title: 'Backup failed',
        lines: [
          'A backup did not complete, so no new archive was stored.',
          '',
          `  Backup:     ${scope}`,
          `  Failed at:  ${finished}`,
          `  Reason:     ${reason}`,
          '',
          'Open the backups page for the run history. You can turn these messages off in your',
          'notification preferences.',
        ],
        ctaLabel,
        ctaUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
