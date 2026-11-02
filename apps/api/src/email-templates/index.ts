// =============================================================================
// This app's email templates (issue #86, E7.2, epic #62)
// =============================================================================
//
// The platform's email slice owns the layout, the safe-HTML helpers, the registry and
// the transports (`@marinoscar/platform-api/email`); this folder holds the templates of
// Vault's own events plus the brand mark. Registered by
// `platform/notifications/notification.manifest.ts` AFTER the platform templates and
// BEFORE the notifications that bind them.
//
// THE NAMES ARE PERSISTED by the event bindings: never rename one, add a new name.
// =============================================================================

import { registerEmailTemplates, type EmailTemplateEntry } from '@marinoscar/platform-api/email';

import {
  VAULT_BACKUP_FAILED_TEMPLATE,
  VAULT_BACKUP_SUCCEEDED_TEMPLATE,
  VAULT_CARD_EXPIRING_TEMPLATE,
} from '@marinoscar/vault-api/core';
import { vaultBackupFailedEmail, vaultBackupSucceededEmail } from './vault-backup-result.email';
import { vaultCardExpiringEmail } from './vault-card-expiring.email';

/** The registrant recorded for these templates in the bootstrap log. */
export const VAULT_EMAIL_REGISTRANT = 'app';

/** This app's own templates, in the order the preference matrix lists their events. */
export const VAULT_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: VAULT_BACKUP_SUCCEEDED_TEMPLATE, render: vaultBackupSucceededEmail, registrant: VAULT_EMAIL_REGISTRANT },
  { name: VAULT_BACKUP_FAILED_TEMPLATE, render: vaultBackupFailedEmail, registrant: VAULT_EMAIL_REGISTRANT },
  { name: VAULT_CARD_EXPIRING_TEMPLATE, render: vaultCardExpiringEmail, registrant: VAULT_EMAIL_REGISTRANT },
];

let registered = false;

/** Registers {@link VAULT_EMAIL_TEMPLATES}. Idempotent per process; call after the platform templates. */
export function registerVaultEmailTemplates(): void {
  if (registered) return;
  registered = true;
  registerEmailTemplates(VAULT_EMAIL_TEMPLATES);
}

export { vaultBackupFailedEmail, vaultBackupSucceededEmail, vaultCardExpiringEmail };
export { emailBrandMark, EMAIL_LOGO_CID, EMAIL_LOGO_PATH, EMAIL_LOGO_RENDERED_SIZE } from './brand-logo';
