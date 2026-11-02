import { extensionForMimeType } from './attachment-file-name';

/**
 * The media library part of a backup (formatVersion 1, additive).
 *
 * ```
 * media/media.json        MediaExportManifest
 * media/0001/0001.mp4     opaque names: <folder index>/<file index>.<ext>
 * ```
 *
 * Zip entry names are readable without the password, so a path is built only
 * from positional counters and an extension derived from the mime type: never
 * from a folder name or an original file name. Which file is which is only in
 * the encrypted `media.json`.
 *
 * Ownership: only folders whose `userId` is the owner, and only files whose
 * `mediaFolderId` is one of those folders, ever reach a plan. The query
 * filters on it and {@link buildMediaPlan} checks it again, so a user's
 * archive can never contain another user's media.
 */

/** Folder inside a user's part of the archive that holds the media library. */
export const EXPORT_MEDIA_DIR = 'media';

/** Path of the media manifest, relative to the user's part of the archive. */
export const EXPORT_MEDIA_MANIFEST_PATH = `${EXPORT_MEDIA_DIR}/media.json`;

/** The storage-object status of a file whose upload completed. */
export const MEDIA_READY_STATUS = 'ready';

/** Extensions for media mime types the attachment table does not know. */
const MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/x-m4v': 'm4v',
  'video/mpeg': 'mpg',
  'video/3gpp': '3gp',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
};

/**
 * Extension (without the dot) for a media file: the video/audio table first,
 * then the attachment table (images, PDF, ...), then `bin`. Always a short
 * `[a-z0-9]` token.
 */
export function mediaExtensionForMimeType(mimeType: string | null | undefined): string {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return MEDIA_EXTENSIONS[base] ?? extensionForMimeType(mimeType);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

/** `media/0001` for the first folder. Padded to a minimum width only. */
export function mediaFolderPath(folderIndex: number): string {
  assertPositiveInteger(folderIndex, 'folderIndex');
  return `${EXPORT_MEDIA_DIR}/${String(folderIndex).padStart(4, '0')}`;
}

/** `media/0001/0001.mp4`. */
export function mediaFilePath(
  folderIndex: number,
  fileIndex: number,
  mimeType: string | null | undefined,
): string {
  assertPositiveInteger(fileIndex, 'fileIndex');
  return (
    `${mediaFolderPath(folderIndex)}/${String(fileIndex).padStart(4, '0')}` +
    `.${mediaExtensionForMimeType(mimeType)}`
  );
}

// ---------------------------------------------------------------------------
// Rows read from Prisma (declared locally so the planner is unit testable)
// ---------------------------------------------------------------------------

export interface ExportMediaFileRow {
  id: string;
  name: string;
  size: bigint | number | string;
  mimeType: string;
  storageKey: string;
  status: string;
  mediaFolderId: string | null;
  createdAt: Date;
}

export interface ExportMediaFolderRow {
  id: string;
  name: string;
  userId: string;
  createdAt: Date;
  files: ExportMediaFileRow[];
}

// ---------------------------------------------------------------------------
// media.json
// ---------------------------------------------------------------------------

export interface ExportMediaFileEntry {
  /** Path inside the user's part of the zip, or `null` when the blob was skipped. */
  file: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface ExportMediaFolderEntry {
  /** `media/0001`. */
  folder: string;
  name: string;
  createdAt: string;
  files: ExportMediaFileEntry[];
}

/** Exactly what is written to `media/media.json`. */
export interface MediaExportManifest {
  folders: ExportMediaFolderEntry[];
  warnings: string[];
}

/** One media blob the archive will contain. */
export interface PlannedMediaFile {
  storageObjectId: string;
  storageKey: string;
  path: string;
  mimeType: string;
  size: number;
  /** Human description used in warnings (inside the encrypted archive only). */
  describe: string;
  entry: ExportMediaFileEntry;
}

export interface MediaExportPlan {
  manifest: MediaExportManifest;
  files: PlannedMediaFile[];
}

function toSafeNumber(size: bigint | number | string | null | undefined): number {
  if (size === null || size === undefined) {
    return 0;
  }
  const n = Number(size);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Build the media manifest and the list of blobs, from the owner's folders.
 *
 * Pure. Folders are numbered in the order given, files within a folder in the
 * order given, both 1-based. A folder not owned by `ownerId`, a file that is
 * not in the folder it is listed under, and a file whose upload is not
 * complete are left out (the first two cannot happen with the service's
 * query; they are checked again so isolation never rests on one filter).
 */
export function buildMediaPlan(
  folders: ExportMediaFolderRow[],
  ownerId: string,
): MediaExportPlan {
  const files: PlannedMediaFile[] = [];
  const entries: ExportMediaFolderEntry[] = [];

  for (const folder of folders) {
    if (folder.userId !== ownerId) {
      continue;
    }
    const folderIndex = entries.length + 1;
    const folderEntry: ExportMediaFolderEntry = {
      folder: mediaFolderPath(folderIndex),
      name: folder.name,
      createdAt: folder.createdAt.toISOString(),
      files: [],
    };

    for (const row of folder.files ?? []) {
      if (row.mediaFolderId !== folder.id || row.status !== MEDIA_READY_STATUS) {
        continue;
      }
      const path = mediaFilePath(folderIndex, folderEntry.files.length + 1, row.mimeType);
      const entry: ExportMediaFileEntry = {
        file: path,
        originalName: row.name,
        mimeType: row.mimeType,
        size: toSafeNumber(row.size),
        createdAt: row.createdAt.toISOString(),
      };
      folderEntry.files.push(entry);
      files.push({
        storageObjectId: row.id,
        storageKey: row.storageKey,
        path,
        mimeType: row.mimeType,
        size: entry.size,
        describe: `"${row.name || 'unnamed file'}" in the folder "${folder.name}"`,
        entry,
      });
    }

    entries.push(folderEntry);
  }

  return { manifest: { folders: entries, warnings: [] }, files };
}

/** Mark a planned media blob as not written: `file: null` and a warning. */
export function skipPlannedMediaFile(plan: MediaExportPlan, file: PlannedMediaFile): void {
  const index = plan.files.indexOf(file);
  if (index === -1) {
    return;
  }
  plan.files.splice(index, 1);
  file.entry.file = null;
  plan.manifest.warnings.push(
    `The media file ${file.describe} could not be read from storage and was not included.`,
  );
}
