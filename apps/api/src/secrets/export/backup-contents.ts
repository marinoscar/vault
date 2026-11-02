/**
 * What a backup contains: the content sections a user (or an administrator,
 * for the scheduled system backup) picks.
 *
 * | Key           | User export | System backup | Default |
 * |---------------|-------------|---------------|---------|
 * | `secrets`     | own         | every user    | on      |
 * | `attachments` | own         | every user    | on (requires secrets) |
 * | `versions`    | own         | every user    | off (requires secrets) |
 * | `media`       | own folders | every user    | off     |
 * | `system`      | not offered | yes           | off     |
 *
 * Shared by the user export DTO and the backup schedule DTO so both apply
 * exactly the same rules and messages. Every message is static text.
 */

/** Content keys, in the order they are listed (e.g. on a run's `contents`). */
export const BACKUP_CONTENT_KEYS = ['secrets', 'attachments', 'versions', 'media', 'system'] as const;

export type BackupContentKey = (typeof BACKUP_CONTENT_KEYS)[number];

export const BACKUP_CONTENT_DEFAULTS = {
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  includeSystem: false,
} as const;

export const BACKUP_CONTENT_MESSAGES = {
  nothingSelected: 'Choose at least one thing to back up',
  attachmentsWithoutSecrets: 'Attachments can only be backed up together with secrets',
  versionsWithoutSecrets: 'Old versions can only be backed up together with secrets',
  systemNotOffered:
    'System configuration can only be included in a scheduled system backup',
} as const;

/** The flags as received; `undefined` means "not sent". */
export interface RawContentSelection {
  includeSecrets?: boolean;
  includeAttachments?: boolean;
  includeVersions?: boolean;
  includeMedia?: boolean;
  includeSystem?: unknown;
}

/** What a user export can contain. */
export interface UserContentSelection {
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
}

/** What a system backup can contain. */
export interface BackupContentSelection extends UserContentSelection {
  includeSystem: boolean;
}

export interface ContentSelectionIssue {
  path: keyof RawContentSelection;
  message: string;
}

/**
 * Validation rules of a content selection.
 *
 * - `system` is offered only by the system backup; at the user level sending
 *   `includeSystem` at all (even `false`) is an error.
 * - Attachments and old versions are part of a secret: asking for them
 *   explicitly (`true`) while secrets are off is an error. Left out, they are
 *   simply off when secrets are off.
 * - At least one of secrets, media and system must be selected.
 *
 * @returns the issues, in a fixed order; empty when the selection is valid.
 */
export function contentSelectionIssues(
  raw: RawContentSelection,
  level: 'user' | 'system',
): ContentSelectionIssue[] {
  const issues: ContentSelectionIssue[] = [];

  if (level === 'user' && raw.includeSystem !== undefined) {
    issues.push({ path: 'includeSystem', message: BACKUP_CONTENT_MESSAGES.systemNotOffered });
    return issues;
  }

  const secrets = raw.includeSecrets ?? BACKUP_CONTENT_DEFAULTS.includeSecrets;
  const media = raw.includeMedia ?? BACKUP_CONTENT_DEFAULTS.includeMedia;
  const system = level === 'system' && raw.includeSystem === true;

  if (!secrets && !media && !system) {
    issues.push({ path: 'includeSecrets', message: BACKUP_CONTENT_MESSAGES.nothingSelected });
  }
  if (!secrets && raw.includeAttachments === true) {
    issues.push({
      path: 'includeAttachments',
      message: BACKUP_CONTENT_MESSAGES.attachmentsWithoutSecrets,
    });
  }
  if (!secrets && raw.includeVersions === true) {
    issues.push({
      path: 'includeVersions',
      message: BACKUP_CONTENT_MESSAGES.versionsWithoutSecrets,
    });
  }
  return issues;
}

/**
 * Apply the defaults to a (valid, or stored) selection. Attachments and
 * versions are always off when secrets are off.
 */
export function resolveContentSelection(raw: RawContentSelection): BackupContentSelection {
  const includeSecrets = raw.includeSecrets ?? BACKUP_CONTENT_DEFAULTS.includeSecrets;
  return {
    includeSecrets,
    includeAttachments:
      includeSecrets && (raw.includeAttachments ?? BACKUP_CONTENT_DEFAULTS.includeAttachments),
    includeVersions:
      includeSecrets && (raw.includeVersions ?? BACKUP_CONTENT_DEFAULTS.includeVersions),
    includeMedia: raw.includeMedia ?? BACKUP_CONTENT_DEFAULTS.includeMedia,
    includeSystem: raw.includeSystem === true,
  };
}

/** The selected keys, in {@link BACKUP_CONTENT_KEYS} order. */
export function selectedContentKeys(
  selection: UserContentSelection & { includeSystem?: boolean },
): BackupContentKey[] {
  const keys: BackupContentKey[] = [];
  if (selection.includeSecrets) keys.push('secrets');
  if (selection.includeSecrets && selection.includeAttachments) keys.push('attachments');
  if (selection.includeSecrets && selection.includeVersions) keys.push('versions');
  if (selection.includeMedia) keys.push('media');
  if (selection.includeSystem) keys.push('system');
  return keys;
}

/** Human summary for a README, e.g. `secrets (with attachments), media library`. */
export function describeContents(
  selection: UserContentSelection & { includeSystem?: boolean },
): string {
  const parts: string[] = [];
  if (selection.includeSecrets) {
    const extras: string[] = [];
    if (selection.includeAttachments) extras.push('attachments');
    if (selection.includeVersions) extras.push('old versions');
    parts.push(extras.length ? `secrets (with ${extras.join(' and ')})` : 'secrets');
  }
  if (selection.includeMedia) parts.push('media library');
  if (selection.includeSystem) parts.push('system configuration');
  return parts.length ? parts.join(', ') : 'nothing';
}
