import { SecretsExportManifest } from './secrets-export.types';

/**
 * Renders `README.txt`, the plain-text guide at the root of a backup.
 *
 * Pure function of the manifest so it is unit testable. Lines use CRLF so the
 * file reads correctly in Windows Notepad as well as everywhere else.
 */
export function renderReadme(manifest: SecretsExportManifest): string {
  const lines: string[] = [
    'VAULT BACKUP',
    '============',
    '',
    'This archive is a backup of the secrets you own in Vault, exported on',
    `${manifest.exportedAt} for ${manifest.owner.email}.`,
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
    'README.txt     This file.',
    'secrets.html   A readable report of every secret. Open it in any web',
    '               browser. It contains no scripts and loads nothing from',
    '               the internet.',
    'secrets.json   The same data in a machine-readable form',
    `               (formatVersion ${manifest.formatVersion}).`,
  ];

  if (manifest.options.includeAttachments) {
    lines.push(
      'attachments/   Attached files. Names are numbers on purpose',
      '               (<secret>-<attachment>.<ext>): file names in a zip are',
      '               visible without the password, so they reveal nothing.',
      '               secrets.html and secrets.json say which file belongs',
      '               to which secret.',
    );
  }

  lines.push(
    '',
    'SUMMARY',
    '-------',
    `Exported at:   ${manifest.exportedAt}`,
    `Secrets:       ${manifest.counts.secrets}`,
    `Attachments:   ${manifest.counts.attachments}` +
      (manifest.options.includeAttachments ? '' : ' (attachments were excluded)'),
    `Versions:      ${manifest.options.includeVersions ? 'all versions' : 'current versions only'}`,
    '',
    'WARNINGS',
    '--------',
  );

  if (manifest.warnings.length === 0) {
    lines.push('None.');
  } else {
    for (const warning of manifest.warnings) {
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
