// =============================================================================
// Payloads of Vault's own notification events (issue #86, E7.2, epic #62)
// =============================================================================
//
// What `notify()` carries for `vault.backup_succeeded`, `vault.backup_failed` and
// `vault.card_expiring`, and the copy helpers the email and bell renderers share.
//
// ⚠ THESE SHAPES ARE THE SECURITY BOUNDARY OF THE EVENTS. A payload is stored
// (inbox row, delivery row) and rendered into mail, so it names only what the
// reader may be told:
//
//   * backups: ids, scope, counts, size, times, and for a failure the STATIC
//     message of `BACKUP_FAILURE_MESSAGES`, never a raw error, path or password;
//   * card expiry: the secret's id and NAME, the expiry as month and year, and the
//     threshold. NEVER a card number, last four, CVV, holder or any field value.
//
// Adding a field here is a security review, not a convenience.
// =============================================================================

/** Event keys. PERSISTED (preferences, deliveries): never rename one. */
export const VAULT_BACKUP_SUCCEEDED_EVENT = 'vault.backup_succeeded';
export const VAULT_BACKUP_FAILED_EVENT = 'vault.backup_failed';
export const VAULT_CARD_EXPIRING_EVENT = 'vault.card_expiring';

/** Email template names. PERSISTED by the registry bindings: never rename one. */
export const VAULT_BACKUP_SUCCEEDED_TEMPLATE = 'vault-backup-succeeded';
export const VAULT_BACKUP_FAILED_TEMPLATE = 'vault-backup-failed';
export const VAULT_CARD_EXPIRING_TEMPLATE = 'vault-card-expiring';

/** Where the bell and the email CTA go (the routes `adminSections.tsx` and `userSettingsSections.tsx` declare). */
export const USER_BACKUPS_PATH = '/settings/backups';
export const SYSTEM_BACKUPS_PATH = '/admin/settings/backups';

/** The payload of both backup events. */
export interface VaultBackupNotificationData {
  runId: string;
  /** `system`: an administrator's backup of everyone; `user`: a backup a user saved. */
  scope: 'system' | 'user';
  trigger: 'schedule' | 'manual';
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601. */
  finishedAt: string;
  /** Archive size; `null` on a failure. */
  sizeBytes: number | null;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount: number;
  warningCount: number;
  /** Failure only: one of the static `BACKUP_FAILURE_MESSAGES`. Never a raw error. */
  error?: string;
  /** The deployment base URL, for the email CTA. */
  appUrl?: string;
}

/** The days-before-expiry thresholds, most distant first. 0 is the last day of the expiry month. */
export const CARD_EXPIRY_THRESHOLDS = [30, 7, 0] as const;
export type CardExpiryThreshold = (typeof CARD_EXPIRY_THRESHOLDS)[number];

/** The payload of `vault.card_expiring`. No number, last four, CVV or field value, ever. */
export interface VaultCardExpiringNotificationData {
  secretId: string;
  /** The secret's name (what the owner called the card). */
  secretName: string;
  /** `MM/YYYY`. */
  expiry: string;
  threshold: CardExpiryThreshold;
  /** The deployment base URL, for the email CTA. */
  appUrl?: string;
}

/** `1.5 MB`, `812 KB`, `0 B`; `unknown size` for a missing value. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** `12 secrets, 3 attachments, 0 media files` for the parts that were counted. */
export function backupCountsSummary(data: VaultBackupNotificationData): string {
  const parts = [plural(data.secretCount, 'secret', 'secrets')];
  if (data.attachmentCount > 0) parts.push(plural(data.attachmentCount, 'attachment', 'attachments'));
  if (data.mediaFileCount > 0) parts.push(plural(data.mediaFileCount, 'media file', 'media files'));
  return parts.join(', ');
}

/** `Scheduled system backup`, `Manual backup of your secrets`, and so on. */
export function backupScopeLabel(data: Pick<VaultBackupNotificationData, 'scope' | 'trigger'>): string {
  if (data.scope === 'user') return 'Your saved backup';
  return data.trigger === 'schedule' ? 'Scheduled system backup' : 'Manual system backup';
}

export const backupLinkFor = (scope: 'system' | 'user'): string =>
  scope === 'user' ? USER_BACKUPS_PATH : SYSTEM_BACKUPS_PATH;

/** The one-line status of a card expiry, e.g. "expires in 7 days". */
export function cardExpiryPhrase(threshold: CardExpiryThreshold, expiry: string): string {
  if (threshold === 0) return `expires today (${expiry})`;
  return `expires in ${plural(threshold, 'day', 'days')} (${expiry})`;
}

export const cardLinkFor = (secretId: string): string => `/secrets/${secretId}`;
