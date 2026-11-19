import { APP_NAME } from '@app/shared';
import {
  TRANSACTIONAL_EMAIL_HEADERS,
  html,
  plainText,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

import {
  documentExpiryPhrase,
  documentLinkFor,
  type VaultDocumentExpiringNotificationData,
} from '@marinoscar/vault-api/core';
import { absoluteLink, detailRow } from './vault-email-common';

// =============================================================================
// `vault.document_expiring` (IDOC-9)
// =============================================================================
//
// ⚠ THE ONLY THINGS THIS MESSAGE KNOWS ABOUT THE DOCUMENT are the name the owner
// gave the secret, its label (`Passport` or the catalog kind) and its expiry date.
// The payload type has no field for a document number, date of birth or holder
// name, so a template cannot leak one by accident; do not add one. Every value is
// interpolated through the `html` tag (escaped).
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'vault-document-expiring': VaultDocumentExpiringNotificationData;
  }
}

/** `Your Passport expires in 90 days`, `... expires today`, `... has expired`. */
export function vaultDocumentExpiringSubject(data: VaultDocumentExpiringNotificationData): string {
  return `Your ${data.documentLabel} ${documentExpiryPhrase(data.daysLeft)}`;
}

/** Renders "your document expires soon". */
export function vaultDocumentExpiringEmail(
  data: VaultDocumentExpiringNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const subject = vaultDocumentExpiringSubject(data);
  const title = data.daysLeft < 0 ? 'A document has expired' : 'A document is expiring';
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, documentLinkFor(data.secretId));
  const ctaLabel = ctaUrl ? 'Open document' : undefined;
  const lead = `"${data.secretName}" (${data.documentLabel}), kept in ${APP_NAME}, ${documentExpiryPhrase(data.daysLeft)}.`;

  const rows = [
    detailRow('Document', data.secretName),
    detailRow('Kind', data.documentLabel),
    detailRow(data.daysLeft < 0 ? 'Expired' : 'Expires', data.expiry),
  ];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">${lead}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      Renewals can take months; plan ahead. This message never includes the document number. You can
      turn these reminders off in your notification preferences.
    </p>
  `;

  return {
    subject,
    html: renderLayout({ title, previewText: subject, bodyHtml, ctaLabel, ctaUrl }, context),
    text: plainText(
      {
        title,
        lines: [
          lead,
          '',
          `  Document:  ${data.secretName}`,
          `  Kind:      ${data.documentLabel}`,
          `  ${data.daysLeft < 0 ? 'Expired' : 'Expires'}:   ${data.expiry}`,
          '',
          'Renewals can take months; plan ahead. This message never includes the document number.',
          'You can turn these reminders off in your notification preferences.',
        ],
        ctaLabel,
        ctaUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
