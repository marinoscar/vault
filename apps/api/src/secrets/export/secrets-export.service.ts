import { Readable } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { TextReader, ZipWriter } from '@zip.js/zip.js';

import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { RequestUser } from '../../auth/interfaces/authenticated-user.interface';
import { STORAGE_PROVIDER, StorageProvider } from '../../storage/providers';
import { ExportSecretsOptions } from '../dto/export-secrets.dto';
import {
  attachmentFileName,
  exportArchiveFileName,
  isAlreadyCompressed,
} from './attachment-file-name';
import { renderSecretsHtml } from './secrets-export-html.renderer';
import { renderReadme } from './secrets-export-readme.renderer';
import {
  EXPORT_FORMAT_VERSION,
  ExportAttachmentEntry,
  ExportFieldDefinition,
  ExportSecretEntry,
  ExportVersionEntry,
  SecretsExportManifest,
} from './secrets-export.types';

/** Audit action recorded for every export. */
export const SECRETS_EXPORT_AUDIT_ACTION = 'secrets.export';

/** How many storage `exists()` probes run at once during the pre-flight. */
const PREFLIGHT_CONCURRENCY = 8;

/**
 * Above this many attachment bytes the archive is written as ZIP64. Kept a
 * little under 4 GiB so the text entries and headers also fit before the
 * 32-bit offset limit.
 */
export const ZIP64_THRESHOLD_BYTES = 0xf0000000;

/**
 * zip.js writer options every vault archive uses: WinZip AE-2 with AES-256
 * (`encryptionStrength: 3`), never ZipCrypto. Shared with the scheduled
 * system backup so both archives open the same way in 7-Zip / Keka.
 */
export function vaultZipWriterOptions(password: string, zip64: boolean) {
  return {
    password,
    encryptionStrength: 3 as const,
    zipCrypto: false,
    useWebWorkers: false,
    zip64,
  };
}

/** Options of {@link SecretsExportService.writeUserEntries}. */
export interface WriteUserEntriesOptions {
  /**
   * Folder inside the zip the user's files go under, e.g. `users/0001/`
   * (with the trailing slash). Empty for the user export (zip root).
   */
  prefix?: string;
  /** Write `README.txt` too. The user export does; the system backup has its own. */
  includeReadme?: boolean;
  /** Label used in log lines, e.g. `Secrets export` or `System backup`. */
  logLabel?: string;
}

/**
 * Generic message for a failure after the response has started. It is what
 * Fastify logs when the stream errors, so it must never carry anything from
 * the request (in particular, not the password).
 */
const ARCHIVE_FAILED_MESSAGE = 'The backup archive could not be completed';

// ---------------------------------------------------------------------------
// Row shapes read from Prisma. Declared locally (instead of using the
// generated payload types) so the planner can be unit tested with plain
// objects.
// ---------------------------------------------------------------------------

export interface ExportStorageObjectRow {
  id: string;
  name: string;
  size: bigint | number | string;
  mimeType: string;
  storageKey: string;
  status: string;
}

export interface ExportAttachmentRow {
  id: string;
  secretVersionId: string;
  storageObjectId: string;
  role: string | null;
  label: string | null;
  createdAt: Date;
  storageObject: ExportStorageObjectRow | null;
}

export interface ExportVersionRow {
  id: string;
  version: number;
  encryptedData: string;
  iv: string;
  authTag: string;
  createdAt: Date;
  isCurrent: boolean;
}

export interface ExportSecretRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  type: { id: string; name: string; fields: unknown };
  versions: ExportVersionRow[];
  attachments?: ExportAttachmentRow[];
}

/** One blob the archive will contain, shared by every entry that points at it. */
export interface PlannedAttachmentFile {
  storageObjectId: string;
  storageKey: string;
  /** Path inside the zip, e.g. `attachments/0001-01.jpg`. */
  path: string;
  mimeType: string;
  size: number;
  /** Human description used in warnings (inside the encrypted archive only). */
  describe: string;
  /** Manifest entries that reference this blob; their `file` is nulled on skip. */
  entries: ExportAttachmentEntry[];
}

export interface ExportPlan {
  manifest: SecretsExportManifest;
  files: PlannedAttachmentFile[];
}

export interface SecretsExportResult {
  /** `vault-backup-YYYY-MM-DD.zip` (UTC). */
  fileName: string;
  secretCount: number;
  /** Attachment blobs the archive is expected to contain. */
  attachmentCount: number;
  /** Warnings known before streaming started (pre-flight). */
  warningCount: number;
  /** The zip bytes. Errors (destroys) if the archive cannot be completed. */
  stream: Readable;
}

export type DecryptVersion = (version: ExportVersionRow) => Record<string, unknown>;

const ROLE_ORDER: Readonly<Record<string, number>> = { card_front: 0, card_back: 1 };

function sortAttachments(rows: ExportAttachmentRow[]): ExportAttachmentRow[] {
  return rows.slice().sort((a, b) => {
    const ra = a.role ? (ROLE_ORDER[a.role] ?? 2) : 3;
    const rb = b.role ? (ROLE_ORDER[b.role] ?? 2) : 3;
    if (ra !== rb) {
      return ra - rb;
    }
    const ta = a.createdAt.getTime() - b.createdAt.getTime();
    return ta !== 0 ? ta : a.id.localeCompare(b.id);
  });
}

function toSafeNumber(size: bigint | number | string | null | undefined): number {
  if (size === null || size === undefined) {
    return 0;
  }
  const n = Number(size);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toFieldDefinitions(fields: unknown): ExportFieldDefinition[] {
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields
    .filter(
      (f): f is Record<string, unknown> =>
        !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string',
    )
    .map((f) => {
      const def: ExportFieldDefinition = {
        name: f.name as string,
        label: typeof f.label === 'string' ? f.label : (f.name as string),
        type: typeof f.type === 'string' ? f.type : 'string',
      };
      if (typeof f.required === 'boolean') def.required = f.required;
      if (typeof f.sensitive === 'boolean') def.sensitive = f.sensitive;
      if (Array.isArray(f.options)) def.options = f.options.map(String);
      return def;
    });
}

/**
 * Build the manifest and the list of blobs to write, from the owner's rows.
 *
 * Pure apart from `decrypt`. Numbering is positional: secret N (1-based, in
 * the order given) and its attachments 1..k, numbered current version first,
 * then older versions oldest first. A storage object already numbered (by an
 * earlier version of the same secret, or by another secret) reuses its file,
 * so each blob is written once.
 *
 * An attachment whose storage object is missing or not `ready` is kept in the
 * manifest with `file: null` and produces a warning.
 */
export function buildExportPlan(
  rows: ExportSecretRow[],
  input: {
    owner: { id: string; email: string };
    options: Pick<ExportSecretsOptions, 'includeAttachments' | 'includeVersions'>;
    exportedAt: Date;
    decrypt: DecryptVersion;
    /** Called with ids only when a version cannot be decrypted (for logging). */
    onDecryptFailure?: (secretId: string, versionId: string) => void;
  },
): ExportPlan {
  const { owner, options, exportedAt, decrypt, onDecryptFailure } = input;
  const warnings: string[] = [];
  const files: PlannedAttachmentFile[] = [];
  const fileByObjectId = new Map<string, PlannedAttachmentFile>();

  const secrets: ExportSecretEntry[] = rows.map((secret, secretIdx) => {
    const secretNumber = secretIdx + 1;
    let attachmentCounter = 0;

    const versionsAsc = secret.versions.slice().sort((a, b) => a.version - b.version);
    const current =
      versionsAsc.find((v) => v.isCurrent) ?? versionsAsc[versionsAsc.length - 1] ?? null;

    const attachmentsByVersion = new Map<string, ExportAttachmentRow[]>();
    if (options.includeAttachments) {
      for (const attachment of secret.attachments ?? []) {
        const list = attachmentsByVersion.get(attachment.secretVersionId) ?? [];
        list.push(attachment);
        attachmentsByVersion.set(attachment.secretVersionId, list);
      }
    }

    const buildAttachments = (version: ExportVersionRow): ExportAttachmentEntry[] =>
      sortAttachments(attachmentsByVersion.get(version.id) ?? []).map((row) => {
        const object = row.storageObject;
        const entry: ExportAttachmentEntry = {
          file: null,
          role: row.role ?? null,
          label: row.label ?? null,
          originalName: object?.name ?? '',
          mimeType: object?.mimeType ?? 'application/octet-stream',
          size: toSafeNumber(object?.size),
        };

        if (!object || object.status !== 'ready') {
          warnings.push(
            `An attachment of "${secret.name}" (version ${version.version}` +
              `${entry.originalName ? `, ${entry.originalName}` : ''}) was not included ` +
              'because its upload never completed.',
          );
          return entry;
        }

        let planned = fileByObjectId.get(object.id);
        if (!planned) {
          attachmentCounter += 1;
          planned = {
            storageObjectId: object.id,
            storageKey: object.storageKey,
            path: attachmentFileName(secretNumber, attachmentCounter, object.mimeType),
            mimeType: object.mimeType,
            size: entry.size,
            describe: `"${secret.name}" (${object.name || 'unnamed file'})`,
            entries: [],
          };
          fileByObjectId.set(object.id, planned);
          files.push(planned);
        }

        entry.file = planned.path;
        planned.entries.push(entry);
        return entry;
      });

    const buildVersion = (version: ExportVersionRow): ExportVersionEntry => {
      let data: Record<string, unknown> = {};
      try {
        data = decrypt(version);
      } catch {
        onDecryptFailure?.(secret.id, version.id);
        warnings.push(
          `The values of "${secret.name}" version ${version.version} could not be decrypted ` +
            'and are missing from this backup.',
        );
      }
      return {
        versionId: version.id,
        versionNumber: version.version,
        createdAt: version.createdAt.toISOString(),
        data,
        attachments: buildAttachments(version),
      };
    };

    // Number the current version's files first so `-01`, `-02` are what the
    // user sees today; then the older versions, oldest first.
    const built = new Map<string, ExportVersionEntry>();
    if (current) {
      built.set(current.id, buildVersion(current));
    }
    if (options.includeVersions) {
      for (const version of versionsAsc) {
        if (!built.has(version.id)) {
          built.set(version.id, buildVersion(version));
        }
      }
    }

    const entry: ExportSecretEntry = {
      id: secret.id,
      name: secret.name,
      description: secret.description ?? null,
      type: {
        id: secret.type.id,
        name: secret.type.name,
        fields: toFieldDefinitions(secret.type.fields),
      },
      createdAt: secret.createdAt.toISOString(),
      updatedAt: secret.updatedAt.toISOString(),
      current: current ? (built.get(current.id) ?? null) : null,
    };

    if (options.includeVersions) {
      entry.versions = versionsAsc.map((v) => built.get(v.id) as ExportVersionEntry);
    }

    return entry;
  });

  const manifest: SecretsExportManifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    app: 'vault',
    owner: { id: owner.id, email: owner.email },
    options: {
      includeAttachments: options.includeAttachments,
      includeVersions: options.includeVersions,
    },
    counts: { secrets: secrets.length, attachments: files.length },
    warnings,
    secrets,
  };

  return { manifest, files };
}

/**
 * Mark a planned blob as not written: every manifest entry that pointed at it
 * gets `file: null`, the count drops, and a warning explains why.
 */
export function skipPlannedFile(plan: ExportPlan, file: PlannedAttachmentFile): void {
  const index = plan.files.indexOf(file);
  if (index === -1) {
    return;
  }
  plan.files.splice(index, 1);
  for (const entry of file.entries) {
    entry.file = null;
  }
  plan.manifest.counts.attachments = plan.files.length;
  plan.manifest.warnings.push(
    `The attachment ${file.describe} could not be read from storage and was not included.`,
  );
}

/**
 * Builds the password-protected backup zip of the secrets a user owns.
 *
 * Kept apart from SecretsService on purpose: that service is about one secret
 * at a time and its access rules; this one is about the archive format. It
 * reads with its own query because an export is owner-only by definition
 * (`createdById === user.id`), even for a holder of `secrets:read_any`.
 *
 * Password handling: the password is a parameter of {@link createExport} and
 * is handed to the zip writer only. It is not stored on `this`, not logged,
 * not in the audit meta, and no error message built here can contain it.
 */
@Injectable()
export class SecretsExportService {
  private readonly logger = new Logger(SecretsExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
  ) {}

  /**
   * Prepare an export and return its metadata plus the zip stream.
   *
   * Everything that can fail cheaply (the query, decryption, the storage
   * pre-flight, the audit write) happens before this resolves, so those
   * failures still become a normal JSON error response. Only the streaming
   * itself happens after the HTTP headers are sent.
   */
  async createExport(
    user: Pick<RequestUser, 'id' | 'email'>,
    options: ExportSecretsOptions,
  ): Promise<SecretsExportResult> {
    const { includeAttachments, includeVersions } = options;
    const exportedAt = new Date();

    const plan = await this.prepareUserPlan(
      { id: user.id, email: user.email },
      { includeAttachments, includeVersions },
      exportedAt,
    );

    const secretCount = plan.manifest.counts.secrets;
    const attachmentCount = plan.manifest.counts.attachments;
    const warningCount = plan.manifest.warnings.length;

    // Recorded before the first byte is sent: an export that is interrupted
    // half way has still disclosed data and must still be on the record.
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        action: SECRETS_EXPORT_AUDIT_ACTION,
        targetType: 'user',
        targetId: user.id,
        meta: {
          secretCount,
          attachmentCount,
          includeVersions,
          includeAttachments,
          warningCount,
        },
      },
    });

    this.logger.log(
      `Secrets export for user ${user.id}: ${secretCount} secret(s), ` +
        `${attachmentCount} attachment(s), ${warningCount} warning(s)`,
    );

    return {
      fileName: exportArchiveFileName(exportedAt),
      secretCount,
      attachmentCount,
      warningCount,
      stream: this.streamArchive(plan, options.password, user.id),
    };
  }

  /**
   * Load the secrets `owner` owns, build the manifest and drop blobs missing
   * from storage. This is the per-user part of an archive, shared by the user
   * export and the scheduled system backup. Owner-only by construction.
   */
  async prepareUserPlan(
    owner: { id: string; email: string },
    options: Pick<ExportSecretsOptions, 'includeAttachments' | 'includeVersions'>,
    exportedAt: Date,
    logLabel = 'Secrets export',
  ): Promise<ExportPlan> {
    const { includeAttachments, includeVersions } = options;
    const rows = await this.loadOwnedSecrets(owner.id, includeAttachments, includeVersions);

    const plan = buildExportPlan(rows, {
      owner: { id: owner.id, email: owner.email },
      options: { includeAttachments, includeVersions },
      exportedAt,
      decrypt: (version) => this.decryptVersion(version),
      onDecryptFailure: (secretId, versionId) =>
        this.logger.warn(
          `${logLabel} for user ${owner.id}: version ${versionId} of secret ${secretId} ` +
            'could not be decrypted; exported without values',
        ),
    });

    await this.preflightAttachments(plan, owner.id, logLabel);
    return plan;
  }

  /**
   * Start writing the archive and return its bytes as a Node stream.
   *
   * Order inside the zip: attachments first, then `secrets.json`,
   * `secrets.html` and `README.txt`. The text files are written last so their
   * counts, links and warnings describe the blobs that were actually written,
   * including one that failed mid-stream.
   */
  streamArchive(plan: ExportPlan, password: string, userId: string): Readable {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const output = Readable.fromWeb(readable as unknown as NodeWebReadableStream<Uint8Array>);

    const zip64 = plan.files.reduce((sum, f) => sum + f.size, 0) > ZIP64_THRESHOLD_BYTES;
    const zipWriter = new ZipWriter(writable, vaultZipWriterOptions(password, zip64));

    void this.writeArchive(plan, zipWriter, userId).catch(async (error: unknown) => {
      this.logger.error(
        `Secrets export for user ${userId} failed while streaming: ${describeError(error)}`,
      );
      try {
        await writable.abort(new Error(ARCHIVE_FAILED_MESSAGE));
      } catch {
        // Already errored or closed (e.g. the client went away first).
      }
      output.destroy(new Error(ARCHIVE_FAILED_MESSAGE));
    });

    return output;
  }

  private async writeArchive(
    plan: ExportPlan,
    zipWriter: ZipWriter<unknown>,
    userId: string,
  ): Promise<void> {
    await this.writeUserEntries(plan, zipWriter, userId);
    await zipWriter.close();
  }

  /**
   * Write one user's part of an archive into `zipWriter`, under `prefix`:
   * the attachment blobs, then `secrets.json`, `secrets.html` and (unless
   * disabled) `README.txt`. Does not close the writer.
   *
   * Paths inside the manifest (`attachments/0001-01.jpg`) stay relative to the
   * user's folder, so the HTML report's links work wherever the folder is.
   */
  async writeUserEntries(
    plan: ExportPlan,
    zipWriter: ZipWriter<unknown>,
    userId: string,
    options: WriteUserEntriesOptions = {},
  ): Promise<void> {
    const prefix = options.prefix ?? '';
    const includeReadme = options.includeReadme ?? true;
    const logLabel = options.logLabel ?? 'Secrets export';

    // Copy: skipPlannedFile() mutates plan.files while we iterate.
    for (const file of plan.files.slice()) {
      await this.writeAttachment(plan, zipWriter, file, userId, prefix, logLabel);
    }

    const manifest = plan.manifest;
    await zipWriter.add(
      `${prefix}secrets.json`,
      new TextReader(JSON.stringify(manifest, null, 2)),
    );
    await zipWriter.add(`${prefix}secrets.html`, new TextReader(renderSecretsHtml(manifest)));
    if (includeReadme) {
      await zipWriter.add(`${prefix}README.txt`, new TextReader(renderReadme(manifest)));
    }
  }

  /**
   * Write one blob. A storage failure (cannot open, or the source stream
   * errors part way) skips the blob with a warning and the archive continues;
   * zip.js leaves a failed entry out of the central directory, so the zip
   * stays valid. A failure on the OUTPUT side (the client disconnected) is
   * rethrown and ends the export.
   */
  private async writeAttachment(
    plan: ExportPlan,
    zipWriter: ZipWriter<unknown>,
    file: PlannedAttachmentFile,
    userId: string,
    prefix: string,
    logLabel: string,
  ): Promise<void> {
    let source: Readable;
    try {
      source = await this.storageProvider.download(file.storageKey);
    } catch (error) {
      this.warnUnreadable(userId, file, error, logLabel);
      skipPlannedFile(plan, file);
      return;
    }

    let sourceFailed = false;
    source.once('error', () => {
      sourceFailed = true;
    });

    try {
      await zipWriter.add(
        `${prefix}${file.path}`,
        Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>,
        isAlreadyCompressed(file.mimeType) ? { level: 0 } : undefined,
      );
    } catch (error) {
      if (!sourceFailed) {
        throw error;
      }
      this.warnUnreadable(userId, file, error, logLabel);
      skipPlannedFile(plan, file);
    } finally {
      source.destroy();
    }
  }

  private warnUnreadable(
    userId: string,
    file: PlannedAttachmentFile,
    error: unknown,
    logLabel = 'Secrets export',
  ): void {
    // Ids only: no secret name, file name or storage key in server logs.
    this.logger.warn(
      `${logLabel} for user ${userId}: storage object ${file.storageObjectId} ` +
        `could not be read and was skipped: ${describeError(error)}`,
    );
  }

  /**
   * Drop blobs that are not in storage before any byte is sent, so the
   * `X-Vault-Export-Attachments` header matches the archive in all but a race.
   */
  private async preflightAttachments(
    plan: ExportPlan,
    userId: string,
    logLabel: string,
  ): Promise<void> {
    const files = plan.files.slice();
    const missing: PlannedAttachmentFile[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const file = files[next++];
        let present = false;
        try {
          present = await this.storageProvider.exists(file.storageKey);
        } catch (error) {
          this.warnUnreadable(userId, file, error, logLabel);
          missing.push(file);
          continue;
        }
        if (!present) {
          this.warnUnreadable(userId, file, 'object does not exist', logLabel);
          missing.push(file);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(PREFLIGHT_CONCURRENCY, files.length) }, () => worker()),
    );

    // Skip in plan order so warnings are deterministic.
    for (const file of files) {
      if (missing.includes(file)) {
        skipPlannedFile(plan, file);
      }
    }
  }

  private async loadOwnedSecrets(
    userId: string,
    includeAttachments: boolean,
    includeVersions: boolean,
  ): Promise<ExportSecretRow[]> {
    const rows = await this.prisma.secret.findMany({
      // Owner-only, regardless of secrets:read_any. Not negotiable.
      where: { createdById: userId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        type: true,
        versions: {
          ...(includeVersions ? {} : { where: { isCurrent: true } }),
          orderBy: { version: 'asc' },
        },
        ...(includeAttachments
          ? {
              attachments: {
                // Attachments are copied onto every version; without
                // includeVersions only the current version's set is wanted.
                ...(includeVersions ? {} : { where: { secretVersion: { isCurrent: true } } }),
                include: { storageObject: true },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              },
            }
          : {}),
      },
    });

    return rows as unknown as ExportSecretRow[];
  }

  private decryptVersion(version: ExportVersionRow): Record<string, unknown> {
    const plaintext = this.crypto.decrypt(version.encryptedData, version.iv, version.authTag);
    const parsed: unknown = JSON.parse(plaintext);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
