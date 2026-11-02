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
  cardExpiryPhrase,
  cardLinkFor,
  type VaultCardExpiringNotificationData,
} from '@marinoscar/vault-api/core';
import { absoluteLink, detailRow } from './vault-email-common';

// =============================================================================
// `vault.card_expiring` (issue #86, E7.2, epic #62)
// =============================================================================
//
// ⚠ THE ONLY THINGS THIS MESSAGE KNOWS ABOUT THE CARD are the name the owner gave
// the secret and its expiry month and year. The payload type has no field for a
// number, last four, CVV or holder, so a template cannot leak one by accident; do
// not add one. The name is interpolated through the `html` tag (escaped).
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'vault-card-expiring': VaultCardExpiringNotificationData;
  }
}

/** Renders "your card expires soon". */
export function vaultCardExpiringEmail(
  data: VaultCardExpiringNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const phrase = cardExpiryPhrase(data.threshold, data.expiry);
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, cardLinkFor(data.secretId));
  const ctaLabel = ctaUrl ? 'Open card' : undefined;

  const subject = `${APP_NAME}: "${data.secretName}" ${phrase}`;
  const rows = [detailRow('Card', data.secretName), detailRow('Expires', data.expiry)];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">A card you keep in ${APP_NAME} ${phrase}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      This message never includes the card number. You can turn these reminders off in your
      notification preferences.
    </p>
  `;

  return {
    subject,
    html: renderLayout(
      { title: 'A card is expiring', previewText: `${data.secretName} ${phrase}`, bodyHtml, ctaLabel, ctaUrl },
      context,
    ),
    text: plainText(
      {
        title: 'A card is expiring',
        lines: [
          `A card you keep in ${APP_NAME} ${phrase}.`,
          '',
          `  Card:     ${data.secretName}`,
          `  Expires:  ${data.expiry}`,
          '',
          'This message never includes the card number. You can turn these reminders off in your',
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
