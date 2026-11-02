import { Readable, Transform } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { TextReader, ZipWriter } from '@zip.js/zip.js';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../prisma/prisma.service';
import { defaultOrgClient } from '../prisma/default-org';
import { STORAGE_PROVIDER, StorageProvider } from '@marinoscar/platform-api/storage';
import {
  SecretsExportService,
  userArchiveCounts,
  vaultZipWriterOptions,
  ZIP64_THRESHOLD_BYTES,
} from '../secrets/export/secrets-export.service';
import {
  renderSystemBackupReadme,
  SYSTEM_BACKUP_FORMAT_VERSION,
  SYSTEM_BACKUP_KIND,
  SystemBackupIndex,
  SystemBackupUserEntry,
  userFolderName,
} from './backup-archive';
import { AiKeyPresence } from '../platform/credentials/ai-key-presence.service';
import { BackupContentSelection } from '../secrets/export/backup-contents';
import {
  SYSTEM_ALLOWLIST_SELECT,
  SYSTEM_SECRET_TYPES_SELECT,
  SYSTEM_SECTION_FILES,
  SYSTEM_USERS_SELECT,
  SystemAllowlistRow,
  SystemSecretTypeRow,
  SystemSettingsProjectionInput,
  SystemUserRow,
  toSystemAllowlist,
  toSystemSecretTypes,
  toSystemSettings,
  toSystemUsers,
} from './backup-system-section';

/** Static, user-facing failure messages. They never carry data, keys or the password. */
export const BACKUP_FAILURE_MESSAGES = {
  storageNotConfigured:
    'Object storage is not configured, so the backup could not be stored. Configure S3 storage and try again.',
  noPassword: 'No backup password is set. Set one in the backup schedule and try again.',
  nothingSelected:
    'The backup schedule selects nothing to back up. Choose at least one thing to back up and try again.',
  passwordUnreadable:
    'The stored backup password could not be decrypted (the encryption key may be missing or rotated). Set the password again.',
  archive: 'The backup archive could not be written. See the server log for details.',
  upload: 'The backup could not be uploaded to object storage. See the server log for details.',
  unknown: 'The backup could not be completed. See the server log for details.',
} as const;

/** Error raised inside a run whose message is safe to store on the run row. */
export class BackupRunFailure extends Error {
  constructor(message: string, readonly causeDetail?: string) {
    super(message);
    this.name = 'BackupRunFailure';
  }
}

export interface BackupArchiveCounts {
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount: number;
  warningCount: number;
}

/** Writes one archive into a zip writer, closes it, and returns its counts. */
export type ArchiveWriteFn = (zipWriter: ZipWriter<unknown>) => Promise<BackupArchiveCounts>;

/** Generic stream error text: what the storage SDK sees if the archive aborts. */
const ARCHIVE_ABORTED_MESSAGE = 'The backup archive could not be completed';

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Builds backup archives and streams them: the zip writer for a system backup, the upload
 * of any archive into object storage, the counts and the direct-download stream. No run
 * lifecycle lives here (that is `BackupRunnerService`, driven by the queue handlers).
 *
 * The archive is never buffered: the zip writer feeds the storage upload through a
 * transform stream, and both the writer and the upload are awaited.
 */
@Injectable()
export class BackupArchiveService {
  private readonly logger = new Logger(BackupArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly exportService: SecretsExportService,
    private readonly systemSettings: SystemSettingsService,
    private readonly aiKey: AiKeyPresence,
  ) {}

  /**
   * PLATFORM-ADOPTION-SHIM(multi-org): reads that touch `storage_objects` (a
   * row-level-security table) run in the default organization's scope; the API
   * is an ordinary role.
   */
  private get orgDb() {
    return defaultOrgClient(this.prisma);
  }

  /** True when an object-storage bucket is configured. */
  isStorageConfigured(): boolean {
    try {
      return !!this.storageProvider.getBucket();
    } catch {
      return false;
    }
  }

  /**
   * Stream the zip straight into `storageProvider.upload`; the archive is
   * never buffered. Both sides are awaited: the archive writer and the upload.
   * If either fails, the other is unblocked and the run fails.
   */
  async uploadArchive(
    storageKey: string,
    password: string,
    zip64: boolean,
    write: ArchiveWriteFn,
  ): Promise<{ counts: BackupArchiveCounts; sizeBytes: number }> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const zipBytes = Readable.fromWeb(readable as unknown as NodeWebReadableStream<Uint8Array>);

    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        callback(null, chunk);
      },
    });
    zipBytes.once('error', (error) => counter.destroy(error));
    zipBytes.pipe(counter);

    const abortArchive = async (): Promise<void> => {
      try {
        await writable.abort(new Error(ARCHIVE_ABORTED_MESSAGE));
      } catch {
        // Locked by the zip writer or already errored/closed.
      }
      zipBytes.destroy(new Error(ARCHIVE_ABORTED_MESSAGE));
    };

    const zipWriter = new ZipWriter(writable, vaultZipWriterOptions(password, zip64));

    const uploadPromise = this.storageProvider.upload(storageKey, counter, {
      mimeType: 'application/zip',
    });
    // An upload failure stops reading; cancel the stream so the writer's
    // pending writes reject instead of waiting forever on backpressure.
    // The side that fails first is the cause; the other then fails because
    // of the abort, so it must not decide the message.
    let firstFailure: 'archive' | 'upload' | null = null;
    uploadPromise.catch(() => {
      firstFailure ??= 'upload';
      void abortArchive();
    });

    const writePromise = write(zipWriter);
    writePromise.catch(() => {
      firstFailure ??= 'archive';
      void abortArchive();
    });

    const [written, uploaded] = await Promise.allSettled([writePromise, uploadPromise]);

    if (written.status === 'rejected' || uploaded.status === 'rejected') {
      const cause =
        firstFailure ?? (written.status === 'rejected' ? 'archive' : 'upload');
      const reason =
        cause === 'archive'
          ? (written as PromiseRejectedResult).reason
          : (uploaded as PromiseRejectedResult).reason;
      throw new BackupRunFailure(BACKUP_FAILURE_MESSAGES[cause], describeError(reason));
    }
    return { counts: written.value, sizeBytes };
  }

  /**
   * Counts of a system archive with `selection`, without decrypting any
   * secret value: for the headers of a streamed export, sent before the
   * archive is written. The archive itself may differ only by a race (a blob
   * that disappears between this pass and the write).
   */
  async countSystemArchive(
    selection: BackupContentSelection,
    createdAt: Date,
  ): Promise<BackupArchiveCounts> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, email: true },
    });
    const totals: BackupArchiveCounts = {
      userCount: users.length,
      secretCount: 0,
      attachmentCount: 0,
      mediaFileCount: 0,
      warningCount: 0,
    };
    if (!selection.includeSecrets && !selection.includeMedia) {
      return totals;
    }
    for (const user of users) {
      const plan = await this.exportService.prepareUserPlan(
        { id: user.id, email: user.email },
        selection,
        createdAt,
        'System export',
        { decrypt: false },
      );
      const counts = userArchiveCounts(plan);
      totals.secretCount += counts.secrets;
      totals.attachmentCount += counts.attachments;
      totals.mediaFileCount += counts.mediaFiles;
      totals.warningCount += counts.warnings.length;
    }
    return totals;
  }

  /**
   * Stream a system archive with `selection` straight to the caller (the
   * admin "Download a backup now"): same writer, so the same layout as a
   * scheduled backup. Nothing is stored. `password` is handed to the zip
   * writer only. A failure part way destroys the stream with a generic
   * message.
   */
  async streamSystemArchive(
    selection: BackupContentSelection,
    password: string,
    createdAt: Date,
  ): Promise<Readable> {
    const zip64 = await this.needsZip64(selection);
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const output = Readable.fromWeb(readable as unknown as NodeWebReadableStream<Uint8Array>);
    const zipWriter = new ZipWriter(writable, vaultZipWriterOptions(password, zip64));

    void this.writeArchive(zipWriter, selection, createdAt).catch(async (error: unknown) => {
      this.logger.error(`System backup export failed while streaming: ${describeError(error)}`);
      try {
        await writable.abort(new Error(ARCHIVE_ABORTED_MESSAGE));
      } catch {
        // Already errored or closed (e.g. the client went away first).
      }
      output.destroy(new Error(ARCHIVE_ABORTED_MESSAGE));
    });

    return output;
  }

  /**
   * Write every user's folder, then the `system/` section, `index.json` and
   * `README.txt`, and close. Users are processed one at a time, so only one
   * user's decrypted data is in memory at once.
   *
   * Each user's part comes from `prepareUserPlan`, which is owner-only for
   * secrets and for media: a user's folder never holds another user's data.
   */
  async writeArchive(
    zipWriter: ZipWriter<unknown>,
    selection: BackupContentSelection,
    createdAt: Date,
  ): Promise<BackupArchiveCounts> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, email: true, displayName: true },
    });

    const perUser = selection.includeSecrets || selection.includeMedia;
    const entries: SystemBackupUserEntry[] = [];
    const warnings: string[] = [];
    let folderNumber = 0;
    let usersWithSecrets = 0;
    let secretCount = 0;
    let attachmentCount = 0;
    let mediaFolderCount = 0;
    let mediaFileCount = 0;

    for (const user of users) {
      const entry: SystemBackupUserEntry = {
        folder: null,
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? null,
        secretCount: 0,
        attachmentCount: 0,
        mediaFolderCount: 0,
        mediaFileCount: 0,
      };
      entries.push(entry);
      if (!perUser) {
        continue;
      }

      const plan = await this.exportService.prepareUserPlan(
        { id: user.id, email: user.email },
        selection,
        createdAt,
        'System backup',
      );

      const before = userArchiveCounts(plan);
      if (before.secrets === 0 && before.mediaFolders === 0) {
        continue;
      }

      folderNumber += 1;
      const folder = userFolderName(folderNumber);
      await this.exportService.writeUserEntries(plan, zipWriter, user.id, {
        prefix: `${folder}/`,
        includeReadme: false,
        logLabel: 'System backup',
      });

      // Read after writing: a blob that failed mid-stream lowered the count.
      const counts = userArchiveCounts(plan);
      entry.folder = folder;
      entry.secretCount = counts.secrets;
      entry.attachmentCount = counts.attachments;
      entry.mediaFolderCount = counts.mediaFolders;
      entry.mediaFileCount = counts.mediaFiles;
      if (counts.secrets > 0) usersWithSecrets += 1;
      secretCount += counts.secrets;
      attachmentCount += counts.attachments;
      mediaFolderCount += counts.mediaFolders;
      mediaFileCount += counts.mediaFiles;
      for (const warning of counts.warnings) {
        warnings.push(`${folder}: ${warning}`);
      }
    }

    if (selection.includeSecrets) {
      const unowned = await this.prisma.secret.count({ where: { createdById: null } });
      if (unowned > 0) {
        warnings.push(
          `${unowned} secret(s) have no owner (their user was deleted) and are not in this backup.`,
        );
      }
    }

    if (selection.includeSystem) {
      await this.writeSystemSection(zipWriter);
    }

    const index: SystemBackupIndex = {
      formatVersion: SYSTEM_BACKUP_FORMAT_VERSION,
      kind: SYSTEM_BACKUP_KIND,
      createdAt: createdAt.toISOString(),
      options: {
        includeSecrets: selection.includeSecrets,
        includeAttachments: selection.includeAttachments,
        includeVersions: selection.includeVersions,
        includeMedia: selection.includeMedia,
        includeSystem: selection.includeSystem,
      },
      counts: {
        users: entries.length,
        usersWithSecrets,
        secrets: secretCount,
        attachments: attachmentCount,
        mediaFolders: mediaFolderCount,
        mediaFiles: mediaFileCount,
        system: selection.includeSystem,
      },
      users: entries,
      warnings,
    };

    await zipWriter.add('index.json', new TextReader(JSON.stringify(index, null, 2)));
    await zipWriter.add('README.txt', new TextReader(renderSystemBackupReadme(index)));
    await zipWriter.close();

    return {
      userCount: entries.length,
      secretCount,
      attachmentCount,
      mediaFileCount,
      warningCount: warnings.length,
    };
  }

  /** The system settings document with the AI block reduced to `apiKeyConfigured`. */
  private settingsProjection(settings: unknown, apiKeyConfigured: boolean): SystemSettingsProjectionInput {
    const doc = settings as SystemSettingsProjectionInput;
    return { ...doc, ai: doc.ai ? { ...doc.ai, apiKeyConfigured } : null };
  }

  /**
   * Write `system/*.json`. Every query selects explicit columns and every
   * file is built by an explicit mapper (see backup-system-section.ts), so no
   * token, key, credential, ciphertext or password can reach the archive.
   */
  private async writeSystemSection(zipWriter: ZipWriter<unknown>): Promise<void> {
    const [users, allowlist, secretTypes, settings, aiKey] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: SYSTEM_USERS_SELECT,
      }),
      this.prisma.allowedEmail.findMany({
        orderBy: [{ addedAt: 'asc' }, { email: 'asc' }],
        select: SYSTEM_ALLOWLIST_SELECT,
      }),
      this.prisma.secretType.findMany({
        // System types are seeded; only custom ones are configuration.
        where: { isSystem: false },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: SYSTEM_SECRET_TYPES_SELECT,
      }),
      // The settings document of GET /api/system-settings; the AI key is reduced
      // to whether one is stored (`AiKeyPresence`: a `describe`, never the secret).
      this.systemSettings.getSettings(),
      this.aiKey.isConfigured(),
    ]);

    const files: Array<[string, unknown]> = [
      [SYSTEM_SECTION_FILES.users, toSystemUsers(users as unknown as SystemUserRow[])],
      [SYSTEM_SECTION_FILES.allowlist, toSystemAllowlist(allowlist as unknown as SystemAllowlistRow[])],
      [
        SYSTEM_SECTION_FILES.secretTypes,
        toSystemSecretTypes(secretTypes as unknown as SystemSecretTypeRow[]),
      ],
      [
        SYSTEM_SECTION_FILES.settings,
        toSystemSettings(this.settingsProjection(settings, aiKey)),
      ],
    ];
    for (const [path, data] of files) {
      await zipWriter.add(path, new TextReader(JSON.stringify(data, null, 2)));
    }
  }

  /**
   * ZIP64 when the blobs could pass the 32-bit limit. Over-estimates (every
   * ready object that is attached anywhere, plus every ready file in any media
   * folder), which is harmless: 7-Zip and Keka read ZIP64.
   */
  async needsZip64(selection: BackupContentSelection): Promise<boolean> {
    let total = 0;
    if (selection.includeSecrets && selection.includeAttachments) {
      const aggregate = await this.orgDb.storageObject.aggregate({
        _sum: { size: true },
        where: { status: 'ready', secretAttachments: { some: {} } },
      });
      total += Number(aggregate?._sum?.size ?? 0);
    }
    if (selection.includeMedia) {
      const aggregate = await this.orgDb.storageObject.aggregate({
        _sum: { size: true },
        where: { status: 'ready', mediaFolderFile: { isNot: null } },
      });
      total += Number(aggregate?._sum?.size ?? 0);
    }
    return total > ZIP64_THRESHOLD_BYTES;
  }
}
