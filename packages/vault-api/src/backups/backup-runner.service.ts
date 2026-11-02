import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Job } from '@marinoscar/platform-api/jobs';




import {
  SecretsExportService,
  userArchiveBlobBytes,
  userArchiveCounts,
  ZIP64_THRESHOLD_BYTES,
} from '../secrets/export/secrets-export.service';
import { systemBackupStorageKey, userBackupStorageKey } from './backup-archive';
import {
  BackupContentSelection,
  resolveContentSelection,
  selectedContentKeys,
  UserContentSelection,
} from '../secrets/export/backup-contents';
import {
  ArchiveWriteFn,
  BACKUP_FAILURE_MESSAGES,
  BackupArchiveCounts,
  BackupArchiveService,
  BackupRunFailure,
  describeError,
} from './backup-archive.service';
import { BackupNotifier } from './backup-notifier.service';

import { decryptBackupPassword } from './backup-password';
import { pickRunsToDelete } from './backup-retention';
import { BACKUP_RUN_INCLUDE, BackupRunRow, BackupRunTrigger } from './dto/backup-responses';
import {
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_METRICS,
  VAULT_OBJECT_STORE,
  VAULT_PRISMA,
  type VaultAuditPort,
  type VaultCryptoPort,
  type VaultMetricsPort,
  type VaultObjectStorePort,
  type VaultPrismaClient,
} from '../ports';

// Re-exported: the failure vocabulary lives with the archive writer that raises it.
export { BACKUP_FAILURE_MESSAGES, BackupRunFailure };
export type { BackupArchiveCounts };

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

export const USER_RUN_ALREADY_RUNNING_MESSAGE = 'You already have a backup running';
export const RUN_ALREADY_RUNNING_MESSAGE = 'A backup is already running';

/** What a finished run reports to its job handler, which fails the job on `failed`. */
export type BackupRunOutcome = { status: 'succeeded' } | { status: 'failed'; error: string };

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

/** The fields of a scheduled job's payload the runner reads (a manual one also names the actor). */
interface SystemJobPayload {
  trigger?: unknown;
  triggeredById?: unknown;
}

/**
 * The life of one backup run, executed by the `vault.backup.run` and
 * `vault.user_backup.run` job handlers: adopt (or create) the `backup_runs` row of the job,
 * build and upload the archive, record the outcome, audit, apply retention.
 *
 * "Is a run active" is the queue's dedup key, not a lock: see `BackupQueueService`.
 * The archive itself is built by {@link BackupArchiveService}.
 *
 * The backup password is decrypted inside the run only, kept in a local variable, handed
 * to the zip writer and never logged, stored on `this`, or put on an error, a span or audit meta.
 */
@Injectable()
export class BackupRunnerService {
  private readonly logger = new Logger(BackupRunnerService.name);

  /**
   * Vault's metrics (E9.2, #90). Property-injected and optional so the constructor stays as the
   * specs build it. Labels are the closed enums only (scope, trigger, outcome); never a run id,
   * owner or storage key.
   */
  @Optional()
  @Inject(VAULT_METRICS)
  private readonly vaultMetrics?: VaultMetricsPort;

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_CRYPTO) private readonly crypto: VaultCryptoPort,
    @Inject(VAULT_OBJECT_STORE)
    private readonly storageProvider: VaultObjectStorePort,
    private readonly archive: BackupArchiveService,
    private readonly exportService: SecretsExportService,
    @Inject(VAULT_AUDIT) private readonly auditLog: VaultAuditPort,
    // Optional: unit specs build the runner by hand; the module always provides it (E7.2, #86).
    @Optional() private readonly notifier?: BackupNotifier,
  ) {}

  /** True when an object-storage bucket is configured. */
  isStorageConfigured(): boolean {
    return this.archive.isStorageConfigured();
  }

  /**
   * The `backup_runs` row of a system job. A manual run created it when it was queued; a
   * scheduled one (queued by the minute tick, which writes no rows) gets it here. A job
   * that runs again after a lease expiry finds its row instead of writing a second one.
   */
  async runForSystemJob(job: Job): Promise<BackupRunRow> {
    const existing = await this.prisma.backupRun.findFirst({
      where: { jobId: job.id },
      include: BACKUP_RUN_INCLUDE,
    });
    if (existing) {
      return existing as unknown as BackupRunRow;
    }
    const payload = (job.payload ?? {}) as SystemJobPayload;
    const startedAt = new Date();
    const triggeredById = typeof payload.triggeredById === 'string' ? payload.triggeredById : null;
    const runId = randomUUID();
    return (await this.prisma.backupRun.create({
      data: {
        id: runId,
        scope: SYSTEM_SCOPE,
        status: 'running',
        trigger: (payload.trigger === 'manual' ? 'manual' : 'schedule') satisfies BackupRunTrigger,
        triggeredById,
        storageKey: systemBackupStorageKey(startedAt, runId),
        startedAt,
        jobId: job.id,
      },
      include: BACKUP_RUN_INCLUDE,
    })) as unknown as BackupRunRow;
  }

  /** The `backup_runs` row a user job was queued with. */
  async runForUserJob(job: Job): Promise<BackupRunRow | null> {
    return (await this.prisma.backupRun.findFirst({
      where: { jobId: job.id },
      include: BACKUP_RUN_INCLUDE,
    })) as unknown as BackupRunRow | null;
  }

  /**
   * Run a scheduled or manual system backup: write the archive, upload it,
   * record the outcome, apply retention. Every failure ends as a `failed`
   * row with a static message, and is reported as the outcome.
   */
  async execute(run: BackupRunRow): Promise<BackupRunOutcome> {
    return this.performRun(run, {
      auditAction: BACKUPS_RUN_COMPLETED_AUDIT_ACTION,
      fallbackKey: () => systemBackupStorageKey(run.startedAt, run.id),
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
          zip64: await this.archive.needsZip64(selection),
          write: (zipWriter) => this.archive.writeArchive(zipWriter, selection, run.startedAt),
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
   *
   * `password` lives only in this call's closure for the duration of the run.
   */
  async executeUserRun(
    run: BackupRunRow,
    owner: { id: string; email: string },
    selection: UserContentSelection,
    password: string,
  ): Promise<BackupRunOutcome> {
    return this.performRun(run, {
      auditAction: BACKUPS_USER_RUN_COMPLETED_AUDIT_ACTION,
      fallbackKey: () => userBackupStorageKey(owner.id, run.startedAt, run.id),
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

  /** One finished run on `app.vault.backups.runs` and `.duration`, after its row committed. */
  private recordRunMetrics(run: BackupRunRow, outcome: 'succeeded' | 'failed', finishedAt: Date): void {
    this.vaultMetrics?.backupFinished({
      scope: run.scope === 'user' ? 'user' : 'system',
      trigger: run.trigger === 'manual' ? 'manual' : 'schedule',
      outcome,
      durationMs: finishedAt.getTime() - new Date(run.startedAt).getTime(),
    });
  }

  /** Records a failure that happened before the archive could start (e.g. an unreadable password). */
  async failRun(run: BackupRunRow, auditAction: string, error: string): Promise<BackupRunOutcome> {
    this.logger.error(`Backup run ${run.id} failed: ${error}`);
    await this.prisma.backupRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), error },
    });
    await this.auditCompleted(run, auditAction, 'failed', null, null, null);
    await this.notifier?.runSettled(run, { status: 'failed', finishedAt: new Date(), sizeBytes: null, counts: null, error });
    this.recordRunMetrics(run, 'failed', new Date());
    return { status: 'failed', error };
  }

  /**
   * The shared life of a run: prepare (may fail before anything is
   * uploaded), stream the archive into storage, record the outcome, audit,
   * retention. A failure deletes the partial object and stores a static
   * message only. The password returned by `prepare` is a local here.
   */
  private async performRun(run: BackupRunRow, job: RunJob): Promise<BackupRunOutcome> {
    const storageKey = run.storageKey ?? job.fallbackKey();
    let uploadStarted = false;
    let selection: BackupContentSelection | UserContentSelection | null = null;

    try {
      const prepared = await job.prepare();
      selection = prepared.selection;

      uploadStarted = true;
      const { counts, sizeBytes } = await this.archive.uploadArchive(
        storageKey,
        prepared.password,
        prepared.zip64,
        prepared.write,
      );

      const finishedAt = new Date();
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
      // After the run row committed, outside any transaction (E7.2, #86).
      await this.notifier?.runSettled(run, { status: 'succeeded', finishedAt, sizeBytes, counts });
      this.recordRunMetrics(run, 'succeeded', finishedAt);

      await job.retention();
      return { status: 'succeeded' };
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
      await this.notifier?.runSettled(run, { status: 'failed', finishedAt: new Date(), sizeBytes: null, counts: null, error: message });
      this.recordRunMetrics(run, 'failed', new Date());
      return { status: 'failed', error: message };
    }
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
      await this.auditLog.record({
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
      });
    } catch (error) {
      this.logger.warn(`Backup run ${run.id}: audit event could not be written: ${describeError(error)}`);
    }
  }
}
