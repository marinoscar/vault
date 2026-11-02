/**
 * Pure helpers for the "What to back up" group shared by the user's
 * "Back up my data" card and the admin "Scheduled backups" card: defaults,
 * the nested-option rule, validation, the summary line and the request
 * payloads. The API re-validates everything; these only shape the form.
 */

/** A content section key, as stored in a backup run's `contents`. */
export type BackupContentKey = 'secrets' | 'attachments' | 'versions' | 'media' | 'system';

/** The checkboxes of the "What to back up" group. */
export interface BackupContentSelection {
  secrets: boolean;
  /** Nested under secrets: only effective while `secrets` is on. */
  attachments: boolean;
  /** Nested under secrets: only effective while `secrets` is on. */
  versions: boolean;
  media: boolean;
  /** Admin schedule only; the user backup never offers or sends it. */
  system: boolean;
}

/** The include flags the API accepts (user export and admin schedule). */
export interface BackupContentFlags {
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
  includeSystem: boolean;
}

/** The user export body flags: no `includeSystem` (the API rejects it there). */
export type UserBackupContentFlags = Omit<BackupContentFlags, 'includeSystem'>;

/** Default for every backup: secrets with their attachments, nothing else. */
export const DEFAULT_BACKUP_CONTENTS: Readonly<BackupContentSelection> = Object.freeze({
  secrets: true,
  attachments: true,
  versions: false,
  media: false,
  system: false,
});

export const BACKUP_NOTHING_SELECTED_MESSAGE = 'Choose at least one thing to back up';

export const BACKUP_CONTENT_LABELS: Record<BackupContentKey, string> = {
  secrets: 'Secrets',
  attachments: 'Include attachments',
  versions: 'Include old versions',
  media: 'Media library',
  system: 'System configuration (users, roles, allowlist, custom secret types, settings)',
};

/** A fresh copy of the defaults. */
export function defaultBackupContents(): BackupContentSelection {
  return { ...DEFAULT_BACKUP_CONTENTS };
}

/** True when the nested secret options cannot be changed (Secrets is off). */
export function areSecretOptionsDisabled(selection: BackupContentSelection): boolean {
  return !selection.secrets;
}

/**
 * What will actually be backed up: attachments and versions only count
 * while Secrets is selected. The raw selection keeps their values so that
 * turning Secrets back on restores them.
 */
export function effectiveBackupContents(
  selection: BackupContentSelection,
): BackupContentSelection {
  return {
    ...selection,
    attachments: selection.secrets && selection.attachments,
    versions: selection.secrets && selection.versions,
  };
}

/** Blocking validation: at least one of secrets, media or system. */
export function validateBackupContents(selection: BackupContentSelection): string | null {
  if (!selection.secrets && !selection.media && !selection.system) {
    return BACKUP_NOTHING_SELECTED_MESSAGE;
  }
  return null;
}

/**
 * Summary line under the group, e.g. "Secrets with attachments" or
 * "Secrets with attachments and old versions, media library".
 */
export function describeBackupContents(selection: BackupContentSelection): string {
  const s = effectiveBackupContents(selection);
  const parts: string[] = [];
  if (s.secrets) {
    const extras: string[] = [];
    if (s.attachments) extras.push('attachments');
    if (s.versions) extras.push('old versions');
    parts.push(extras.length > 0 ? `secrets with ${extras.join(' and ')}` : 'secrets only');
  }
  if (s.media) parts.push('media library');
  if (s.system) parts.push('system configuration');
  if (parts.length === 0) return 'Nothing selected';
  // "secrets only" reads oddly when other sections follow.
  if (parts.length > 1 && parts[0] === 'secrets only') parts[0] = 'secrets';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every include flag exactly as selected, nested ones included even while
 * Secrets is off (for holding form state, not for sending).
 */
export function rawBackupContentFlags(selection: BackupContentSelection): BackupContentFlags {
  return {
    includeSecrets: selection.secrets,
    includeAttachments: selection.attachments,
    includeVersions: selection.versions,
    includeMedia: selection.media,
    includeSystem: selection.system,
  };
}

/** Every include flag, with the nested ones forced off while Secrets is off. */
export function toBackupContentFlags(selection: BackupContentSelection): BackupContentFlags {
  const s = effectiveBackupContents(selection);
  return {
    includeSecrets: s.secrets,
    includeAttachments: s.attachments,
    includeVersions: s.versions,
    includeMedia: s.media,
    includeSystem: s.system,
  };
}

/** Body flags for `POST /api/secrets/export` (never `includeSystem`). */
export function toUserBackupRequest(selection: BackupContentSelection): UserBackupContentFlags {
  const { includeSystem: _omit, ...flags } = toBackupContentFlags(selection);
  return flags;
}

/**
 * Selection from stored flags. Missing flags (an older API response) take
 * the defaults.
 */
export function fromBackupContentFlags(
  flags: Partial<BackupContentFlags> | null | undefined,
): BackupContentSelection {
  return {
    secrets: flags?.includeSecrets ?? DEFAULT_BACKUP_CONTENTS.secrets,
    attachments: flags?.includeAttachments ?? DEFAULT_BACKUP_CONTENTS.attachments,
    versions: flags?.includeVersions ?? DEFAULT_BACKUP_CONTENTS.versions,
    media: flags?.includeMedia ?? DEFAULT_BACKUP_CONTENTS.media,
    system: flags?.includeSystem ?? DEFAULT_BACKUP_CONTENTS.system,
  };
}

const RUN_CHIP_ORDER: Array<{ key: BackupContentKey; label: string }> = [
  { key: 'secrets', label: 'Secrets' },
  { key: 'media', label: 'Media' },
  { key: 'system', label: 'System' },
];

/**
 * Chip labels for a backup run's `contents`, in a fixed order
 * (Secrets, Media, System). Nested keys and unknown keys get no chip.
 */
export function backupRunContentChips(contents: readonly string[] | null | undefined): string[] {
  if (!contents || contents.length === 0) return [];
  const set = new Set(contents);
  return RUN_CHIP_ORDER.filter((c) => set.has(c.key)).map((c) => c.label);
}
