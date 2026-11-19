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
  AGENT_ACTIVITY_SETTINGS_PATH,
  AGENT_CARD_DECLINE_REASONS,
  agentCardAmountPhrase,
  agentSecretLinkFor,
  type VaultAgentCardDeclinedNotificationData,
  type VaultAgentCardFirstReleaseNotificationData,
  type VaultAgentCardGrantRequestedNotificationData,
  type VaultAgentCardNotificationData,
} from '@marinoscar/vault-api/core';
import { absoluteLink, detailRow } from './vault-email-common';

// =============================================================================
// Agent release of cards (ADR-0003): grant requested, first release, declined
// =============================================================================
//
// ⚠ THESE MESSAGES NAME the app, the card (the name the owner gave it), the shop and the
// amount. The payload types have no field for a card number, last four digits, expiry or
// security code, so a template cannot leak one; do not add one. Every interpolation goes
// through the `html` tag (escaped). A request's reason is the app's own text, shown as a quote.
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'vault-agent-card-grant-requested': VaultAgentCardGrantRequestedNotificationData;
    'vault-agent-card-first-release': VaultAgentCardFirstReleaseNotificationData;
    'vault-agent-card-declined': VaultAgentCardDeclinedNotificationData;
  }
}

const NEVER = 'This message never includes a card number or security code.';

interface CardEmailParts {
  title: string;
  phrase: string;
  ctaLabel: string;
  ctaPath: string;
  extraRows?: Array<[string, string]>;
  note: string;
}

function renderCardEmail(data: VaultAgentCardNotificationData, parts: CardEmailParts, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, parts.ctaPath);
  const ctaLabel = ctaUrl ? parts.ctaLabel : undefined;
  const facts: Array<[string, string]> = [
    ['App', data.clientName],
    ['Card', data.secretName],
    ...(data.origin ? ([['Shop', data.origin]] as Array<[string, string]>) : []),
    ['Amount', agentCardAmountPhrase(data)],
    ...(parts.extraRows ?? []),
  ];
  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">${parts.phrase}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${facts.map(([label, value]) => detailRow(label, value))}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">${parts.note} ${NEVER}</p>
  `;
  return {
    subject: `${APP_NAME}: ${parts.phrase}`,
    html: renderLayout({ title: parts.title, previewText: parts.phrase, bodyHtml, ctaLabel, ctaUrl }, context),
    text: plainText(
      {
        title: parts.title,
        lines: [`${parts.phrase}.`, '', ...facts.map(([label, value]) => `  ${`${label}:`.padEnd(9)} ${value}`), '', parts.note, NEVER],
        ctaLabel,
        ctaUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/** Renders "an app asks to use a card at a shop". */
export function vaultAgentCardGrantRequestedEmail(
  data: VaultAgentCardGrantRequestedNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  return renderCardEmail(
    data,
    {
      title: 'An app asks to use a card',
      phrase: `${data.clientName} asks to use ${data.secretName}${data.origin ? ` at ${data.origin}` : ''}`,
      ctaLabel: 'Review the request',
      ctaPath: agentSecretLinkFor(data.secretId),
      extraRows: [['Reason', `"${data.reason}"`]],
      note: 'Nothing is allowed until you approve it in Vault. Decline it if you did not ask for this purchase.',
    },
    ctx,
  );
}

/** Renders "a card was used at a shop for the first time". */
export function vaultAgentCardFirstReleaseEmail(
  data: VaultAgentCardFirstReleaseNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  return renderCardEmail(
    data,
    {
      title: 'A card was used by an app',
      phrase: `${data.clientName} used ${data.secretName}${data.origin ? ` at ${data.origin}` : ''} for the first time`,
      ctaLabel: 'Review agent activity',
      ctaPath: AGENT_ACTIVITY_SETTINGS_PATH,
      note: 'If this was not you, revoke the shop on the card or close the card to agents.',
    },
    ctx,
  );
}

/** Renders "Vault declined a card use". */
export function vaultAgentCardDeclinedEmail(data: VaultAgentCardDeclinedNotificationData, ctx?: EmailRenderContext): RenderedEmail {
  return renderCardEmail(
    data,
    {
      title: 'Vault declined a card use',
      phrase: `Vault did not give ${data.secretName} to ${data.clientName}: ${AGENT_CARD_DECLINE_REASONS[data.reason]}`,
      ctaLabel: 'Review agent activity',
      ctaPath: AGENT_ACTIVITY_SETTINGS_PATH,
      note: 'No card details were released. If you did not expect this, close the card to agents.',
    },
    ctx,
  );
}
