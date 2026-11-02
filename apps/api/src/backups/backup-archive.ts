/**
 * The system backup archive (formatVersion 1, kind "system-backup").
 *
 * ```
 * README.txt                        what it is, how to open it, counts, warnings
 * index.json                        SystemBackupIndex
 * users/0001/secrets.html           same renderer as the user export
 * users/0001/secrets.json           same shape as the user export's secrets.json
 * users/0001/attachments/0001-01.jpg
 * ```
 *
 * Zip entry NAMES are readable without the password, so folder names are
 * opaque numbers: no email, name or id appears in a path. Which folder is
 * whose is only in the encrypted index.json.
 */

export const SYSTEM_BACKUP_FORMAT_VERSION = 1;
export const SYSTEM_BACKUP_KIND = 'system-backup';

/** Object-storage prefix of every system backup. */
export const SYSTEM_BACKUP_KEY_PREFIX = 'system-backups/';

export interface SystemBackupUserEntry {
  /** `users/0001`, or `null` for a user with no secrets (no folder written). */
  folder: string | null;
  id: string;
  email: string;
  displayName: string | null;
  secretCount: number;
  attachmentCount: number;
}

export interface SystemBackupIndex {
  formatVersion: typeof SYSTEM_BACKUP_FORMAT_VERSION;
  kind: typeof SYSTEM_BACKUP_KIND;
  createdAt: string;
  options: { includeAttachments: boolean; includeVersions: boolean };
  counts: { users: number; usersWithSecrets: number; secrets: number; attachments: number };
  users: SystemBackupUserEntry[];
  warnings: string[];
}

/** `users/0001` for the first user folder. */
export function userFolderName(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError('index must be a positive integer');
  }
  return `users/${String(index).padStart(4, '0')}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `vault-backup-YYYY-MM-DD_HHmmss.zip`, in UTC. */
export function systemBackupFileName(date: Date): string {
  return (
    `vault-backup-${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    `_${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}.zip`
  );
}

/** `system-backups/vault-backup-YYYY-MM-DD_HHmmss.zip` (UTC). */
export function systemBackupStorageKey(date: Date): string {
  return `${SYSTEM_BACKUP_KEY_PREFIX}${systemBackupFileName(date)}`;
}

/** Renders `README.txt` of the system backup. CRLF, like the user export's README. */
export function renderSystemBackupReadme(index: SystemBackupIndex): string {
  const lines: string[] = [
    'VAULT SYSTEM BACKUP',
    '===================',
    '',
    'This archive is an automatic backup of the vault data of every user,',
    `created on ${index.createdAt} by an administrator's backup schedule.`,
    '',
    'Every file in it is encrypted with AES-256 using the backup password the',
    'administrator set. Without that password the files cannot be opened, and',
    'there is no way to recover it.',
    '',
    'HOW TO OPEN IT',
    '--------------',
    '- Windows: 7-Zip (https://www.7-zip.org). Right-click the file, choose',
    '  7-Zip > Extract, and enter the password.',
    '- macOS:   Keka or The Unarchiver. The built-in Archive Utility cannot',
    '  open AES-encrypted zips.',
    '- Linux:   7z x <file>   (p7zip / 7zip package), or File Roller.',
    '',
    'WHAT IS INSIDE',
    '--------------',
    'README.txt     This file.',
    `index.json     Which folder belongs to which user, the options and the`,
    `               counts (formatVersion ${index.formatVersion}, kind "${index.kind}").`,
    'users/NNNN/    One folder per user who owns at least one secret. Folder',
    '               names are numbers on purpose: file names in a zip are',
    '               visible without the password, so they reveal nothing.',
    '               Look the number up in index.json. Users without secrets',
    '               are listed in index.json but have no folder.',
    '  secrets.html A readable report of that user\'s secrets. Open it in any',
    '               web browser.',
    '  secrets.json The same data in a machine-readable form.',
  ];
  if (index.options.includeAttachments) {
    lines.push('  attachments/ That user\'s attached files.');
  }

  lines.push(
    '',
    'SUMMARY',
    '-------',
    `Created at:    ${index.createdAt}`,
    `Users:         ${index.counts.users} (${index.counts.usersWithSecrets} with secrets)`,
    `Secrets:       ${index.counts.secrets}`,
    `Attachments:   ${index.counts.attachments}` +
      (index.options.includeAttachments ? '' : ' (attachments were excluded)'),
    `Versions:      ${index.options.includeVersions ? 'all versions' : 'current versions only'}`,
    '',
    'WARNINGS',
    '--------',
  );

  if (index.warnings.length === 0) {
    lines.push('None.');
  } else {
    for (const warning of index.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push(
    '',
    'KEEP IT SAFE',
    '------------',
    'Once extracted, the files are NOT encrypted. Delete the extracted copy',
    'when you are done, and store the zip and its password separately.',
    '',
  );

  return lines.join('\r\n');
}
