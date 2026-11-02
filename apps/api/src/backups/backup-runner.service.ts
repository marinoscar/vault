import { Readable, Transform } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TextReader, ZipWriter } from '@zip.js/zip.js';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers';
import {
  SecretsExportService,
  userArchiveBlobBytes,
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
  systemBackupStorageKey,
  userBackupStorageKey,
  userFolderName,
} from './backup-archive';
import { SystemSettingsService } from '../settings/system-settings/system-settings.service';
import {
  BackupContentSelection,
  resolveContentSelection,
  selectedContentKeys,
  UserContentSelection,
} from '../secrets/export/backup-contents';
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
import { decryptBackupPassword } from './backup-password';
import { pickRunsToDelete } from './backup-retention';
import { computeNextRunAt } from './backup-schedule';
import { BACKUP_RUN_INCLUDE, BackupRunRow, BackupRunTrigger } from './dto/backup-responses';

export const BACKUP_SCHEDULE_ID = 'default';

/** Audit action written when a run finishes, successfully or not. */
export const BACKUPS_RUN_COMPLETED_AUDIT_ACTION = 'backups.run.completed';
/** Audit action written when a user-saved run finishes. */
export const BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION = 'backups.user.run.completed';

/** `backup_runs.scope` of an administrator's system backup. */
export const SYSTEM_SCOPE = 'system';
/** `backup_runs.scope` of a backup a user saved to storage. */
export const USER_SCOPE = 'user';

/** How many saved backups each user keeps; older ones are deleted after a successful run. */
export const USER_BACKUP_KEEP_COUNT = 10;

/**
 * First key of the two-key advisory lock serializing one user's saved runs
 * (the second is `hashtext(userId)`). Two-key locks live in a different key
 * space from the single bigint {@link BACKUP_RUN_LOCK_KEY}, so they never
 * collide with the system lock.
 */
export const USER_BACKUP_LOCK_NAMESPACE = 731_104;

export const USER_RUN_ALREADY_RUNNING_MESSAGE = 'You already have a backup running';

/** How often a live run refreshes its `heartbeat_at`. */
export const BACKUP_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * A `running` row whose `heartbeat_at` (or `started_at`, when it never beat)
 * is older than this is dead: the instance running it stopped. Six missed
 * heartbeats, so a slow database write does not fail a live run.
 */
export const BACKUP_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

/**
 * Key of the Postgres transaction-scoped advisory lock that serializes "is a
 * run in progress? if not, insert one" across every API instance. Arbitrary,
 * fixed, and used for nothing else.
 */
export const BACKUP_RUN_LOCK_KEY = 7_311_042_001;

export const STALE_RUN_ERROR = 'Interrupted (the server running it stopped)';
export const RUN_ALREADY_RUNNING_MESSAGE = 'A backup is already running';

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

/** The fields of a run the stale rule looks at. */
export interface StaleCandidate {
  status: string;
  startedAt: Date;
  heartbeatAt?: Date | null;
}

/**
 * True when a `running` row's last sign of life (`heartbeatAt`, else
 * `startedAt`) is more than {@link BACKUP_HEARTBEAT_STALE_MS} before `now`.
 * The in-memory twin of {@link staleRunsWhere}; both encode the same rule.
 */
export function isRunStale(run: StaleCandidate, now: Date): boolean {
  if (run.status !== 'running') {
    return false;
  }
  const lastSeen = run.heartbeatAt ?? run.startedAt;
  return lastSeen.getTime() < now.getTime() - BACKUP_HEARTBEAT_STALE_MS;
}

/** Prisma `where` selecting the stale `running` rows at `now` (see {@link isRunStale}). */
export function staleRunsWhere(now: Date) {
  const cutoff = new Date(now.getTime() - BACKUP_HEARTBEAT_STALE_MS);
  return {
    status: 'running',
    OR: [
      { heartbeatAt: { lt: cutoff } },
      { heartbeatAt: null, startedAt: { lt: cutoff } },
    ],
  };
}

/** Writes one archive into a zip writer, closes it, and returns its counts. */
type ArchiveWriteFn = (zipWriter: ZipWriter<unknown>) => Promise<BackupArchiveCounts>;

/** What {@link BackupRunnerService.performRun} needs to run one archive. */
interface RunJob {
  auditAction: string;
  fallbackKey: () => string;
  /** Checks and loads everything; a throw here fails the run before upload. */
  prepare: () => Promise<{
    password: string;
    selection: BackupContentSelection | UserContentSelection;
    zip64: boolean;
    write: ArchiveWriteFn;
  }>;
  afterSuccess?: (finishedAt: Date) => Promise<void>;
  retention: () => Promise<void>;
}

/** The schedule's content columns resolved with the defaults. */
function scheduleSelection(schedule: {
  includeSecrets?: boolean | null;
  includeAttachments?: boolean | null;
  includeVersions?: boolean | null;
  includeMedia?: boolean | null;
  includeSystem?: boolean | null;
}): BackupContentSelection {
  return resolveContentSelection({
    includeSecrets: schedule.includeSecrets ?? undefined,
    includeAttachments: schedule.includeAttachments ?? undefined,
    includeVersions: schedule.includeVersions ?? undefined,
    includeMedia: schedule.includeMedia ?? undefined,
    includeSystem: schedule.includeSystem ?? undefined,
  });
}

/** Generic stream error text: what the storage SDK sees if the archive aborts. */
const ARCHIVE_ABORTED_MESSAGE = 'The backup archive could not be completed';

/**
 * Runs system backups: the every-minute schedule check, the atomic claim,
 * the archive writer, retention and the recovery of interrupted runs.
 *
 * Multi-instance safety:
 * - A scheduled slot is claimed with a compare-and-set on `next_run_at`
 *   (`updateMany where next_run_at = <value read>`): exactly one instance
 *   moves it to the following slot, the others update 0 rows and stop.
 * - "Only one run at a time" is a check-then-insert under a Postgres
 *   transaction-scoped advisory lock, so two instances (or a manual run
 *   racing a scheduled one) cannot both insert a `running` row.
 * - A live run refreshes `heartbeat_at` every 30 s. Only a row whose
 *   heartbeat is older than {@link BACKUP_HEARTBEAT_STALE_MS} is swept as
 *   interrupted, so a restarting instance never fails another instance's
 *   live run.
 *
 * The backup password is decrypted inside {@link execute} only, kept in a
 * local variable, handed to the zip writer and never logged, stored on
 * `this`, put on an error, a span or audit meta.
 */
@Injectable()
export class BackupRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackupRunnerService.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly exportService: SecretsExportService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  /** True when an object-storage bucket is configured. */
  isStorageConfigured(): boolean {
    try {
      return !!this.storageProvider.getBucket();
    } catch {
      return false;
    }
  }

  /**
   * A run left `running` by a stopped process can never finish: mark it
   * failed. Uses the heartbeat rule, so a run another live instance is still
   * doing is left alone. Never throws (the API must start even if the DB is slow).
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.failStaleRuns(new Date());
    } catch (error) {
      this.logger.error(`Could not recover interrupted backup runs: ${describeError(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick(): Promise<void> {
    try {
      await this.failStaleRuns(new Date());
      await this.runDueSchedule(new Date());
    } catch (error) {
      this.logger.error(`Backup schedule check failed: ${describeError(error)}`);
    }
  }

  /** Mark stale `running` rows (see {@link isRunStale}) as failed. */
  async failStaleRuns(now: Date): Promise<number> {
    const result = await this.prisma.backupRun.updateMany({
      where: staleRunsWhere(now),
      data: { status: 'failed', error: STALE_RUN_ERROR, finishedAt: now },
    });
    const count = result?.count ?? 0;
    if (count > 0) {
      this.logger.warn(`Marked ${count} stale backup run(s) as failed`);
    }
    return count;
  }

  /**
   * If the schedule is enabled and due, claim the slot and start a run.
   *
   * The claim moves `next_run_at` to the slot after `now` (not after the old
   * value), so an API that was down for days runs once and resumes, instead of
   * replaying every missed slot.
   *
   * @returns the started run, or `null` when nothing was due, another
   * instance won the claim, or a run was already in progress.
   */
  async runDueSchedule(now: Date): Promise<BackupRunRow | null> {
    const schedule = await this.prisma.backupSchedule.findUnique({
      where: { id: BACKUP_SCHEDULE_ID },
    });
    if (!schedule || !schedule.enabled || !schedule.nextRunAt || schedule.nextRunAt > now) {
      return null;
    }

    let following: Date | null = null;
    try {
      following = computeNextRunAt(schedule, now);
    } catch (error) {
      // An invalid stored schedule must not re-fire every minute: clear the
      // slot (it is recomputed on the next save) and still run this one.
      this.logger.error(`Backup schedule is invalid, next run cleared: ${describeError(error)}`);
    }

    const claim = await this.prisma.backupSchedule.updateMany({
      where: { id: BACKUP_SCHEDULE_ID, enabled: true, nextRunAt: schedule.nextRunAt },
      data: { nextRunAt: following },
    });
    if (claim.count !== 1) {
      return null; // Another instance claimed this slot.
    }

    let run: BackupRunRow;
    try {
      run = await this.startRun('schedule', null);
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn('Scheduled backup skipped: a backup is already running');
        return null;
      }
      throw error;
    }
    this.launch(run);
    return run;
  }

  /**
   * Insert a `running` system run, unless one exists. Atomic across instances
   * (see the class comment). Only `scope: 'system'` rows count: a user's
   * saved backup never blocks the schedule. Does not start the work: call
   * {@link launch}.
   *
   * @throws ConflictException when a system run is already in progress.
   */
  async startRun(trigger: BackupRunTrigger, triggeredById: string | null): Promise<BackupRunRow> {
    const startedAt = new Date();
    const storageKey = systemBackupStorageKey(startedAt);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${BACKUP_RUN_LOCK_KEY}::bigint)`;

      await tx.backupRun.updateMany({
        where: staleRunsWhere(startedAt),
        data: { status: 'failed', error: STALE_RUN_ERROR, finishedAt: startedAt },
      });

      const running = await tx.backupRun.count({
        where: { status: 'running', scope: SYSTEM_SCOPE },
      });
      if (running > 0) {
        throw new ConflictException({ message: RUN_ALREADY_RUNNING_MESSAGE });
      }

      return tx.backupRun.create({
        data: {
          scope: SYSTEM_SCOPE,
          status: 'running',
          trigger,
          triggeredById,
          storageKey,
          startedAt,
          heartbeatAt: startedAt,
        },
        include: BACKUP_RUN_INCLUDE,
      });
    }) as Promise<BackupRunRow>;
  }

  /**
   * Insert a `running` user-saved run for `ownerId`, unless that user already
   * has one. Serialized per user with a two-key advisory lock
   * ({@link USER_BACKUP_LOCK_NAMESPACE}, `hashtext(ownerId)`): the two-key
   * space never overlaps the single bigint key of the system lock, so users
   * never wait on the schedule or on each other.
   *
   * @throws ConflictException when this user already has a run in progress.
   */
  async startUserRun(
    ownerId: string,
    selection: UserContentSelection,
  ): Promise<BackupRunRow> {
    const startedAt = new Date();
    const storageKey = userBackupStorageKey(ownerId, startedAt);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${USER_BACKUP_LOCK_NAMESPACE}::int, hashtext(${ownerId}::text))`;

      await tx.backupRun.updateMany({
        where: staleRunsWhere(startedAt),
        data: { status: 'failed', error: STALE_RUN_ERROR, finishedAt: startedAt },
      });

      const running = await tx.backupRun.count({
        where: { status: 'running', scope: USER_SCOPE, ownerId },
      });
      if (running > 0) {
        throw new ConflictException({ message: USER_RUN_ALREADY_RUNNING_MESSAGE });
      }

      return tx.backupRun.create({
        data: {
          scope: USER_SCOPE,
          ownerId,
          status: 'running',
          trigger: 'manual',
          triggeredById: ownerId,
          storageKey,
          startedAt,
          heartbeatAt: startedAt,
          contents: selectedContentKeys(selection),
        },
        include: BACKUP_RUN_INCLUDE,
      });
    }) as Promise<BackupRunRow>;
  }

  /** Execute a started system run in the background. Never rejects. */
  launch(run: BackupRunRow): void {
    this.track(run.id, this.execute(run));
  }

  /**
   * Execute a started user-saved run in the background. Never rejects.
   * `password` lives only in this call's closure for the duration of the run:
   * it is not stored on `this`, on the row, in a log line or in audit meta.
   */
  launchUserRun(
    run: BackupRunRow,
    owner: { id: string; email: string },
    selection: UserContentSelection,
    password: string,
  ): void {
    this.track(run.id, this.executeUserRun(run, owner, selection, password));
  }

  private track(runId: string, work: Promise<void>): void {
    const promise = work
      .catch((error: unknown) => {
        this.logger.error(`Backup run ${runId} crashed: ${describeError(error)}`);
      })
      .finally(() => {
        this.inFlight.delete(promise);
      });
    this.inFlight.add(promise);
  }

  /** Resolves when every launched run has settled. For tests and shutdown. */
  async waitForIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  /**
   * Run a scheduled or manual system backup: write the archive, upload it,
   * record the outcome, apply retention. Every failure ends as a `failed`
   * row with a static message.
   */
  async execute(run: BackupRunRow): Promise<void> {
    await this.performRun(run, {
      auditAction: BACKUPS_RUN_COMPLETED_AUDIT_ACTION,
      fallbackKey: () => systemBackupStorageKey(run.startedAt),
      prepare: async () => {
        if (!this.isStorageConfigured()) {
          throw new BackupRunFailure(BACKUP_FAILURE_MESSAGES.storageNotConfigured);
        }

        const schedule = await this.prisma.backupSchedule.findUnique({
          where: { id: BACKUP_SCHEDULE_ID },
        });
        if (!schedule?.passwordEncrypted) {
          throw new BackupRunFailure(BACKUP_FAILURE_MESSAGES.noPassword);
        }

        let password: string;
        try {
          password = decryptBackupPassword(this.crypto, schedule.passwordEncrypted);
        } catch (error) {
          throw new BackupRunFailure(BACKUP_FAILURE_MESSAGES.passwordUnreadable, describeError(error));
        }

        const selection = scheduleSelection(schedule);
        if (!selection.includeSecrets && !selection.includeMedia && !selection.includeSystem) {
          throw new BackupRunFailure(BACKUP_FAILURE_MESSAGES.nothingSelected);
        }

        return {
          password,
          selection,
          zip64: await this.needsZip64(selection),
          write: (zipWriter) => this.writeArchive(zipWriter, selection, run.startedAt),
        };
      },
      afterSuccess: async (finishedAt) => {
        await this.prisma.backupSchedule.updateMany({
          where: { id: BACKUP_SCHEDULE_ID },
          data: { lastRunAt: finishedAt },
        });
      },
      retention: () => this.applyRetention(run.id),
    });
  }

  /**
   * Run a user-saved backup: the same zip as the user's download (README,
   * secrets, media) uploaded under `user-backups/<userId>/`. Retention keeps
   * that user's newest {@link USER_BACKUP_KEEP_COUNT}.
   */
  async executeUserRun(
    run: BackupRunRow,
    owner: { id: string; email: string },
    selection: UserContentSelection,
    password: string,
  ): Promise<void> {
    await this.performRun(run, {
      auditAction: BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
      fallbackKey: () => userBackupStorageKey(owner.id, run.startedAt),
      prepare: async () => {
        if (!this.isStorageConfigured()) {
          throw new BackupRunFailure(BACKUP_FAILURE_MESSAGES.storageNotConfigured);
        }
        const plan = await this.exportService.prepareUserPlan(
          owner,
          selection,
          run.startedAt,
          'User backup',
        );
        return {
          password,
          selection,
          zip64: userArchiveBlobBytes(plan) > ZIP64_THRESHOLD_BYTES,
          write: async (zipWriter) => {
            await this.exportService.writeUserEntries(plan, zipWriter, owner.id, {
              logLabel: 'User backup',
            });
            await zipWriter.close();
            const counts = userArchiveCounts(plan);
            return {
              userCount: 1,
              secretCount: counts.secrets,
              attachmentCount: counts.attachments,
              mediaFileCount: counts.mediaFiles,
              warningCount: counts.warnings.length,
            };
          },
        };
      },
      retention: () => this.applyUserRetention(owner.id, run.id),
    });
  }

  /**
   * The shared life of a run: prepare (may fail before anything is
   * uploaded), stream the archive into storage, record the outcome, audit,
   * retention. A failure deletes the partial object and stores a static
   * message only. The password returned by `prepare` is a local here.
   */
  private async performRun(run: BackupRunRow, job: RunJob): Promise<void> {
    const storageKey = run.storageKey ?? job.fallbackKey();
    let uploadStarted = false;
    let selection: BackupContentSelection | UserContentSelection | null = null;
    const heartbeat = this.startHeartbeat(run.id);

    try {
      const prepared = await job.prepare();
      selection = prepared.selection;

      uploadStarted = true;
      const { counts, sizeBytes } = await this.writeAndUpload(
        storageKey,
        prepared.password,
        prepared.zip64,
        prepared.write,
      );

      const finishedAt = new Date();
      // By id, unconditionally: if the row was marked stale/interrupted
      // meanwhile, the run did in fact succeed and the object exists.
      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: 'succeeded',
          finishedAt,
          storageKey,
          sizeBytes: BigInt(sizeBytes),
          userCount: counts.userCount,
          secretCount: counts.secretCount,
          attachmentCount: counts.attachmentCount,
          mediaFileCount: counts.mediaFileCount,
          warningCount: counts.warningCount,
          contents: selectedContentKeys(selection),
          error: null,
        },
      });
      await job.afterSuccess?.(finishedAt);

      this.logger.log(
        `Backup run ${run.id} succeeded: ${counts.userCount} user(s), ${counts.secretCount} secret(s), ` +
          `${counts.attachmentCount} attachment(s), ${counts.mediaFileCount} media file(s), ` +
          `${counts.warningCount} warning(s), ${sizeBytes} bytes`,
      );
      await this.auditCompleted(run, job.auditAction, 'succeeded', sizeBytes, counts, selection);

      await job.retention();
    } catch (error) {
      const message =
        error instanceof BackupRunFailure ? error.message : BACKUP_FAILURE_MESSAGES.unknown;
      const detail =
        error instanceof BackupRunFailure ? (error.causeDetail ?? error.message) : describeError(error);
      this.logger.error(`Backup run ${run.id} failed: ${detail}`);

      if (uploadStarted) {
        try {
          await this.storageProvider.delete(storageKey);
        } catch (deleteError) {
          this.logger.warn(
            `Backup run ${run.id}: partial object could not be deleted: ${describeError(deleteError)}`,
          );
        }
      }

      await this.prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: message,
          ...(selection ? { contents: selectedContentKeys(selection) } : {}),
        },
      });
      await this.auditCompleted(run, job.auditAction, 'failed', null, null, selection);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Refresh `heartbeat_at` every {@link BACKUP_HEARTBEAT_INTERVAL_MS} while
   * the row is still `running` (by id, so a finished row is never touched).
   * Unref'd so it never keeps the process alive. A failed beat is logged only.
   */
  private startHeartbeat(runId: string): NodeJS.Timeout {
    const timer = setInterval(() => {
      Promise.resolve()
        .then(() =>
          this.prisma.backupRun.updateMany({
            where: { id: runId, status: 'running' },
            data: { heartbeatAt: new Date() },
          }),
        )
        .catch((error: unknown) => {
          this.logger.warn(`Backup run ${runId}: heartbeat failed: ${describeError(error)}`);
        });
    }, BACKUP_HEARTBEAT_INTERVAL_MS);
    timer.unref?.();
    return timer;
  }

  /**
   * Stream the zip straight into `storageProvider.upload`; the archive is
   * never buffered. Both sides are awaited: the archive writer and the upload.
   * If either fails, the other is unblocked and the run fails.
   */
  private async writeAndUpload(
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
  private async writeArchive(
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

  /**
   * Write `system/*.json`. Every query selects explicit columns and every
   * file is built by an explicit mapper (see backup-system-section.ts), so no
   * token, key, credential, ciphertext or password can reach the archive.
   */
  private async writeSystemSection(zipWriter: ZipWriter<unknown>): Promise<void> {
    const [users, allowlist, secretTypes, settings] = await Promise.all([
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
      // The masked projection used by GET /api/system-settings.
      this.systemSettings.getSettings(),
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
        toSystemSettings(settings as unknown as SystemSettingsProjectionInput),
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
  private async needsZip64(selection: BackupContentSelection): Promise<boolean> {
    let total = 0;
    if (selection.includeSecrets && selection.includeAttachments) {
      const aggregate = await this.prisma.storageObject.aggregate({
        _sum: { size: true },
        where: { status: 'ready', secretAttachments: { some: {} } },
      });
      total += Number(aggregate?._sum?.size ?? 0);
    }
    if (selection.includeMedia) {
      const aggregate = await this.prisma.storageObject.aggregate({
        _sum: { size: true },
        where: { status: 'ready', mediaFolderFile: { isNot: null } },
      });
      total += Number(aggregate?._sum?.size ?? 0);
    }
    return total > ZIP64_THRESHOLD_BYTES;
  }

  /**
   * Keep the newest `keepCount` successful system backups; delete the
   * objects of the older ones and set their `deleted_at`. Never deletes
   * `justWrittenId`; never looks at user-saved runs. Failures are logged and
   * do not fail the run.
   */
  async applyRetention(justWrittenId: string): Promise<void> {
    try {
      const schedule = await this.prisma.backupSchedule.findUnique({
        where: { id: BACKUP_SCHEDULE_ID },
        select: { keepCount: true },
      });
      await this.deleteBeyond({ scope: SYSTEM_SCOPE }, schedule?.keepCount ?? 7, justWrittenId);
    } catch (error) {
      this.logger.warn(`Backup retention failed: ${describeError(error)}`);
    }
  }

  /**
   * Keep `ownerId`'s newest {@link USER_BACKUP_KEEP_COUNT} saved backups.
   * Same rules as {@link applyRetention}, limited to that user's runs.
   */
  async applyUserRetention(ownerId: string, justWrittenId: string): Promise<void> {
    try {
      await this.deleteBeyond({ scope: USER_SCOPE, ownerId }, USER_BACKUP_KEEP_COUNT, justWrittenId);
    } catch (error) {
      this.logger.warn(`User backup retention failed for user ${ownerId}: ${describeError(error)}`);
    }
  }

  private async deleteBeyond(
    where: { scope: string; ownerId?: string },
    keepCount: number,
    justWrittenId: string,
  ): Promise<void> {
    const candidates = await this.prisma.backupRun.findMany({
      where: { ...where, status: 'succeeded', deletedAt: null, storageKey: { not: null } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true, startedAt: true, deletedAt: true, storageKey: true },
    });

    for (const run of pickRunsToDelete(candidates, keepCount, justWrittenId)) {
      try {
        await this.storageProvider.delete(run.storageKey as string);
        await this.prisma.backupRun.update({
          where: { id: run.id },
          data: { deletedAt: new Date() },
        });
        this.logger.log(`Retention deleted backup ${run.id}`);
      } catch (error) {
        this.logger.warn(`Retention could not delete backup ${run.id}: ${describeError(error)}`);
      }
    }
  }

  private async auditCompleted(
    run: BackupRunRow,
    action: string,
    status: 'succeeded' | 'failed',
    sizeBytes: number | null,
    counts: BackupArchiveCounts | null,
    selection: BackupContentSelection | UserContentSelection | null,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorUserId: run.triggeredById,
          action,
          targetType: 'backup_run',
          targetId: run.id,
          meta: {
            runId: run.id,
            status,
            trigger: run.trigger,
            sizeBytes,
            contents: selection ? selectedContentKeys(selection) : null,
            counts: counts
              ? {
                  users: counts.userCount,
                  secrets: counts.secretCount,
                  attachments: counts.attachmentCount,
                  mediaFiles: counts.mediaFileCount,
                  warnings: counts.warningCount,
                }
              : null,
          },
        },
      });
    } catch (error) {
      this.logger.warn(`Backup run ${run.id}: audit event could not be written: ${describeError(error)}`);
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
