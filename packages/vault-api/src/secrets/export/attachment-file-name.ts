import { EXPORT_ATTACHMENTS_DIR } from './secrets-export.types';

/**
 * Attachment naming inside the backup zip.
 *
 * Zip entry names are stored in clear text even when every entry is AES
 * encrypted: anyone holding the file can list them without the password. So
 * a name is built ONLY from two positional counters and an extension derived
 * from the mime type - never from a secret name, an attachment role or label,
 * or the original file name.
 */

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
};

/** Fallback for a mime type that is missing or not in the table. */
export const DEFAULT_ATTACHMENT_EXTENSION = 'bin';

/**
 * Extension (without the dot) for a mime type. Parameters such as
 * `; charset=utf-8` are ignored and the lookup is case-insensitive. Anything
 * unknown maps to `bin`, so the result is always a short `[a-z0-9]` token.
 */
export function extensionForMimeType(mimeType: string | null | undefined): string {
  if (!mimeType) {
    return DEFAULT_ATTACHMENT_EXTENSION;
  }
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[base] ?? DEFAULT_ATTACHMENT_EXTENSION;
}

/**
 * Opaque zip path of an attachment:
 * `attachments/<secret index, 4 digits>-<attachment index, 2 digits>.<ext>`.
 *
 * Both indexes are 1-based. They are zero-padded to a minimum width only, so a
 * 10000th secret or 100th attachment still gets a unique (wider) name instead
 * of colliding.
 *
 * @throws RangeError when an index is not a positive integer.
 */
export function attachmentFileName(
  secretIndex: number,
  attachmentIndex: number,
  mimeType: string | null | undefined,
): string {
  if (!Number.isInteger(secretIndex) || secretIndex < 1) {
    throw new RangeError('secretIndex must be a positive integer');
  }
  if (!Number.isInteger(attachmentIndex) || attachmentIndex < 1) {
    throw new RangeError('attachmentIndex must be a positive integer');
  }

  const secretPart = String(secretIndex).padStart(4, '0');
  const attachmentPart = String(attachmentIndex).padStart(2, '0');
  return `${EXPORT_ATTACHMENTS_DIR}/${secretPart}-${attachmentPart}.${extensionForMimeType(mimeType)}`;
}

/**
 * `vault-backup-YYYY-MM-DD.zip`, dated in UTC so the name does not depend on
 * the server's time zone.
 */
export function exportArchiveFileName(date: Date): string {
  return `vault-backup-${date.toISOString().slice(0, 10)}.zip`;
}

/**
 * True for formats a browser renders inline, i.e. the ones the HTML report
 * embeds with `<img>`. HEIC/HEIF are deliberately absent: most browsers cannot
 * display them, so they are linked instead of shown as a broken image.
 */
export function isBrowserRenderableImage(mimeType: string | null | undefined): boolean {
  const ext = extensionForMimeType(mimeType);
  return ext === 'jpg' || ext === 'png' || ext === 'gif' || ext === 'webp';
}

/**
 * True for content that is already compressed, so the zip stores it without
 * spending CPU on a deflate pass that would not shrink it.
 */
export function isAlreadyCompressed(mimeType: string | null | undefined): boolean {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (base === 'image/svg+xml' || base === 'image/bmp' || base === 'image/tiff') {
    return false;
  }
  return (
    base.startsWith('image/') ||
    base.startsWith('video/') ||
    base.startsWith('audio/') ||
    base === 'application/zip' ||
    base === 'application/gzip'
  );
}
