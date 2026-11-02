import { describeContents, UserContentSelection } from './backup-contents';
import { EXPORT_FORMAT_VERSION, SecretsExportManifest } from './secrets-export.types';

/** Everything the user export's README describes. */
export interface UserBackupReadmeInput {
  exportedAt: string;
  ownerEmail: string;
  selection: UserContentSelection;
  /** `null` when secrets were not selected (no secrets.html / secrets.json). */
  secrets: SecretsExportManifest | null;
  /** `null` when the media library was not selected. */
  media: { folders: number; files: number } | null;
  /** Every warning of the archive (secrets and media). */
  warnings: string[];
}

/**
 * Renders `README.txt` of a secrets-only archive. Kept for callers that have
 * only the manifest; see {@link renderUserBackupReadme}.
 */
export function renderReadme(manifest: SecretsExportManifest): string {
  return renderUserBackupReadme({
    exportedAt: manifest.exportedAt,
    ownerEmail: manifest.owner.email,
    selection: {
      includeSecrets: true,
      includeAttachments: manifest.options.includeAttachments,
      includeVersions: manifest.options.includeVersions,
      includeMedia: false,
    },
    secrets: manifest,
    media: null,
    warnings: manifest.warnings,
  });
}

/**
 * Renders `README.txt`, the plain-text guide at the root of a user backup.
 * Always present, and lists what the archive includes.
 *
 * Pure function so it is unit testable. Lines use CRLF so the file reads
 * correctly in Windows Notepad as well as everywhere else.
 */
export function renderUserBackupReadme(input: UserBackupReadmeInput): string {
  const { selection, secrets, media } = input;
  const what =
    secrets && !media
      ? 'the secrets you own'
      : !secrets && media
        ? 'your media library'
        : 'the secrets and the media library you own';

  const lines: string[] = [
    'VAULT BACKUP',
    '============',
    '',
    `This archive is a backup of ${what} in Vault, exported on`,
    `${input.exportedAt} for ${input.ownerEmail}.`,
    '',
    'Every file in it is encrypted with AES-256 using the password you chose',
    'when you created the backup. Without that password the files cannot be',
    'opened, and there is no way to recover it.',
    '',
    'HOW TO OPEN IT',
    '--------------',
    '- Windows: 7-Zip (https://www.7-zip.org). Right-click the file, choose',
    '  7-Zip > Extract, and enter the password.',
    '- macOS:   Keka or The Unarchiver. The built-in Archive Utility cannot',
    '  open AES-encrypted zips.',
    '- Linux:   7z x <file>   (p7zip / 7zip package), or File Roller.',
    '',
    'Note: the Windows Explorer and macOS built-in zip tools do not support',
    'AES encryption and will report the archive as damaged or ask for a',
    'password they then reject. Use one of the tools above.',
    '',
    'WHAT IS INSIDE',
    '--------------',
    `Contents:      ${describeContents(selection)}`,
    '',
    'README.txt     This file.',
  ];

  if (secrets) {
    lines.push(
      'secrets.html   A readable report of every secret. Open it in any web',
      '               browser. It contains no scripts and loads nothing from',
      '               the internet.',
      'secrets.json   The same data in a machine-readable form',
      `               (formatVersion ${secrets.formatVersion}).`,
    );
    if (secrets.options.includeAttachments) {
      lines.push(
        'attachments/   Attached files. Names are numbers on purpose',
        '               (<secret>-<attachment>.<ext>): file names in a zip are',
        '               visible without the password, so they reveal nothing.',
        '               secrets.html and secrets.json say which file belongs',
        '               to which secret.',
      );
    }
  }

  if (media) {
    lines.push(
      'media/         Your media library. media/media.json lists every folder',
      `               and file (formatVersion ${EXPORT_FORMAT_VERSION}). Folder and file`,
      '               names are numbers on purpose (media/<folder>/<file>.<ext>);',
      '               media.json gives each one its original name.',
    );
  }

  lines.push('', 'SUMMARY', '-------', `Exported at:   ${input.exportedAt}`);

  if (secrets) {
    lines.push(
      `Secrets:       ${secrets.counts.secrets}`,
      `Attachments:   ${secrets.counts.attachments}` +
        (secrets.options.includeAttachments ? '' : ' (attachments were excluded)'),
      `Versions:      ${secrets.options.includeVersions ? 'all versions' : 'current versions only'}`,
    );
  } else {
    lines.push('Secrets:       not included');
  }

  if (media) {
    lines.push(`Media:         ${media.files} file(s) in ${media.folders} folder(s)`);
  } else {
    lines.push('Media:         not included');
  }

  lines.push('', 'WARNINGS', '--------');

  if (input.warnings.length === 0) {
    lines.push('None.');
  } else {
    for (const warning of input.warnings) {
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
