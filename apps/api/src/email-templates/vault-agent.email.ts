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
  agentCredentialChangedPhrase,
  agentSecretLinkFor,
  type VaultAgentCredentialChangedNotificationData,
  type VaultAgentNewAppNotificationData,
} from '@marinoscar/vault-api/core';
import { absoluteLink, detailRow } from './vault-email-common';

// =============================================================================
// `vault.agent_credential_changed` and `vault.agent_new_app` (E14.7)
// =============================================================================
//
// ⚠ THESE MESSAGES NAME the app, the login (the name the owner gave it) and the website
// origin. The payload types have no field for a password, username, one-time code or token,
// so a template cannot leak one; do not add one. Every interpolation goes through the `html`
// tag (escaped). Both link to the secret and to the Agent activity page.
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'vault-agent-credential-changed': VaultAgentCredentialChangedNotificationData;
    'vault-agent-new-app': VaultAgentNewAppNotificationData;
  }
}

/** Renders "an app saved or changed a login". */
export function vaultAgentCredentialChangedEmail(
  data: VaultAgentCredentialChangedNotificationData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const phrase = agentCredentialChangedPhrase(data);
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, agentSecretLinkFor(data.secretId));
  const activityUrl = absoluteLink(data.appUrl ?? context.appUrl, AGENT_ACTIVITY_SETTINGS_PATH);
  const ctaLabel = ctaUrl ? 'Open login' : undefined;
  const title = data.change === 'created' ? 'A login was saved by an app' : 'A password was changed by an app';

  const rows = [
    detailRow('App', data.clientName),
    detailRow('Login', data.secretName),
    ...(data.origin ? [detailRow('Website', data.origin)] : []),
  ];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">${phrase}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      If this was not you or an app you trust, turn off agent access for the login and remove the app
      in Connected apps.${activityUrl ? html` Review everything agents did on <a href="${activityUrl}">Agent activity</a>.` : ''}
      This message never includes a password.
    </p>
  `;

  return {
    subject: `${APP_NAME}: ${phrase}`,
    html: renderLayout({ title, previewText: phrase, bodyHtml, ctaLabel, ctaUrl }, context),
    text: plainText(
      {
        title,
        lines: [
          `${phrase}.`,
          '',
          `  App:      ${data.clientName}`,
          `  Login:    ${data.secretName}`,
          ...(data.origin ? [`  Website:  ${data.origin}`] : []),
          '',
          'If this was not you or an app you trust, turn off agent access for the login and remove',
          'the app in Connected apps.',
          ...(activityUrl ? [`Agent activity: ${activityUrl}`] : []),
          'This message never includes a password.',
        ],
        ctaLabel,
        ctaUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/** Renders "an app you have not seen before used a login". */
export function vaultAgentNewAppEmail(data: VaultAgentNewAppNotificationData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const phrase = `${data.clientName} used the login ${data.secretName}${data.origin ? ` on ${data.origin}` : ''} for the first time`;
  const ctaUrl = absoluteLink(data.appUrl ?? context.appUrl, AGENT_ACTIVITY_SETTINGS_PATH);
  const ctaLabel = ctaUrl ? 'Review agent activity' : undefined;
  const title = 'A new app used a login';

  const rows = [
    detailRow('App', data.clientName),
    detailRow('Login', data.secretName),
    ...(data.origin ? [detailRow('Website', data.origin)] : []),
  ];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">${phrase}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      If you do not recognise this app, remove it in Connected apps. This message never includes a password.
    </p>
  `;

  return {
    subject: `${APP_NAME}: ${phrase}`,
    html: renderLayout({ title, previewText: phrase, bodyHtml, ctaLabel, ctaUrl }, context),
    text: plainText(
      {
        title,
        lines: [
          `${phrase}.`,
          '',
          `  App:      ${data.clientName}`,
          `  Login:    ${data.secretName}`,
          ...(data.origin ? [`  Website:  ${data.origin}`] : []),
          '',
          'If you do not recognise this app, remove it in Connected apps.',
          'This message never includes a password.',
        ],
        ctaLabel,
        ctaUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
