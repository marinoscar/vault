import { Readable } from 'stream';

import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers';
import { encryptBackupPassword } from './backup-password';
import { BackupFrequency, computeNextRunAt } from './backup-schedule';
import {
  BACKUP_FAILURE_MESSAGES,
  BACKUP_SCHEDULE_ID,
  BackupRunnerService,
  SYSTEM_SCOPE,
} from './backup-runner.service';
import { decryptBackupPassword } from './backup-password';
import { systemBackupFileName } from './backup-archive';
import { selectedContentKeys } from '../secrets/export/backup-contents';
import { ExportSystemBackupInput } from './dto/export-system-backup.dto';
import {
  BACKUP_RUN_INCLUDE,
  BackupDownloadResponse,
  BackupRunListResponse,
  BackupRunResponse,
  BackupRunRow,
  BackupScheduleResponse,
  toBackupRunResponse,
} from './dto/backup-responses';
import { BackupRunListQuery } from './dto/backup-run-list-query.dto';
import { UpdateBackupScheduleInput } from './dto/update-backup-schedule.dto';

export const BACKUPS_AUDIT_ACTIONS = {
  scheduleUpdate: 'backups.schedule.update',
  run: 'backups.run',
  download: 'backups.download',
  delete: 'backups.delete',
  export: 'backups.export',
} as const;

export const NO_SCHEDULED_PASSWORD_MESSAGE =
  'No scheduled backup password is set. Enter a password for this download.';

/** Result of {@link BackupsService.exportNow}: headers first, then the zip. */
export interface SystemExportResult {
  fileName: string;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount: number;
  stream: Readable;
}

/** Lifetime of a download link. */
export const BACKUP_DOWNLOAD_URL_TTL_SECONDS = 300;

/** What GET returns when no schedule row exists yet. */
export const DEFAULT_BACKUP_SCHEDULE = {
  enabled: false,
  frequency: 'daily' as BackupFrequency,
  intervalHours: null as number | null,
  timeOfDay: '03:00',
  dayOfWeek: null as number | null,
  dayOfMonth: null as number | null,
  timezone: 'UTC',
  keepCount: 7,
  includeAttachments: true,
  includeVersions: false,
  includeSecrets: true,
  includeMedia: false,
  includeSystem: false,
};

/** The editable fields, in the order the audit meta lists changed ones. */
const EDITABLE_FIELDS = [
  'enabled',
  'frequency',
  'intervalHours',
  'timeOfDay',
  'dayOfWeek',
  'dayOfMonth',
  'timezone',
  'keepCount',
  'includeAttachments',
  'includeVersions',
  'includeSecrets',
  'includeMedia',
  'includeSystem',
] as const;

type EditableSchedule = Pick<typeof DEFAULT_BACKUP_SCHEDULE, (typeof EDITABLE_FIELDS)[number]>;

interface ScheduleRow extends EditableSchedule {
  passwordEncrypted: string | null;
  passwordUpdatedAt: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  updatedAt: Date | null;
}

export const ENABLE_WITHOUT_PASSWORD_MESSAGE =
  'Set a backup password before enabling scheduled backups';
export const ENABLE_WITHOUT_STORAGE_MESSAGE =
  'Object storage is not configured, so scheduled backups cannot be enabled';

/**
 * Admin API of the scheduled system backup: the schedule, the run history,
 * download links and deletion. The work itself is {@link BackupRunnerService}.
 *
 * The schedule's password is write-only: encrypted on the way in, and neither
 * it nor its ciphertext is ever returned, logged or audited.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly runner: BackupRunnerService,
  ) {}

  async getSchedule(): Promise<BackupScheduleResponse> {
    const row = await this.prisma.backupSchedule.findUnique({ where: { id: BACKUP_SCHEDULE_ID } });
    return this.toScheduleResponse(row as ScheduleRow | null);
  }

  async updateSchedule(
    input: UpdateBackupScheduleInput,
    actorUserId: string,
  ): Promise<BackupScheduleResponse> {
    const existing = (await this.prisma.backupSchedule.findUnique({
      where: { id: BACKUP_SCHEDULE_ID },
    })) as ScheduleRow | null;

    const passwordChanged = input.password !== undefined;
    if (input.enabled) {
      if (!existing?.passwordEncrypted && !passwordChanged) {
        throw new BadRequestException({ message: ENABLE_WITHOUT_PASSWORD_MESSAGE });
      }
      if (!this.runner.isStorageConfigured()) {
        throw new BadRequestException({ message: ENABLE_WITHOUT_STORAGE_MESSAGE });
      }
    }

    // Only the fields the frequency uses are kept; the others are stored null.
    const next: EditableSchedule = {
      enabled: input.enabled,
      frequency: input.frequency,
      intervalHours: input.frequency === 'hourly' ? input.intervalHours : null,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.frequency === 'weekly' ? input.dayOfWeek : null,
      dayOfMonth: input.frequency === 'monthly' ? input.dayOfMonth : null,
      timezone: input.timezone,
      keepCount: input.keepCount,
      includeAttachments: input.includeAttachments,
      includeVersions: input.includeVersions,
      includeSecrets: input.includeSecrets,
      includeMedia: input.includeMedia,
      includeSystem: input.includeSystem,
    };

    const now = new Date();
    const nextRunAt = next.enabled ? computeNextRunAt(next, now) : null;

    let passwordFields: { passwordEncrypted: string; passwordUpdatedAt: Date } | undefined;
    if (passwordChanged) {
      try {
        passwordFields = {
          passwordEncrypted: encryptBackupPassword(this.crypto, input.password as string),
          passwordUpdatedAt: now,
        };
      } catch (error) {
        this.logger.error(`Failed to encrypt the backup password: ${(error as Error)?.message}`);
        throw new ServiceUnavailableException({
          code: 'ENCRYPTION_UNAVAILABLE',
          message:
            'Encryption is not available, so the backup password could not be stored. Check that VAULT_ENCRYPTION_KEY is configured.',
        });
      }
    }

    const data = { ...next, nextRunAt, updatedById: actorUserId, ...(passwordFields ?? {}) };
    const saved = await this.prisma.backupSchedule.upsert({
      where: { id: BACKUP_SCHEDULE_ID },
      create: { id: BACKUP_SCHEDULE_ID, ...data },
      update: data,
    });

    const before: EditableSchedule = existing ?? DEFAULT_BACKUP_SCHEDULE;
    const changedFields = EDITABLE_FIELDS.filter((field) => before[field] !== next[field]);

    await this.audit(actorUserId, BACKUPS_AUDIT_ACTIONS.scheduleUpdate, 'backup_schedule', BACKUP_SCHEDULE_ID, {
      changedFields,
      passwordChanged,
    });

    return this.toScheduleResponse(saved as ScheduleRow);
  }

  /**
   * Start a manual run. 202 with the `running` row; the work continues in
   * the background.
   *
   * @throws ConflictException when a run is already in progress.
   */
  async runNow(actorUserId: string): Promise<BackupRunResponse> {
    const run = await this.runner.startRun('manual', actorUserId);
    await this.audit(actorUserId, BACKUPS_AUDIT_ACTIONS.run, 'backup_run', run.id, {
      runId: run.id,
      trigger: 'manual',
    });
    this.runner.launch(run);
    return toBackupRunResponse(run);
  }

  async listRuns(query: BackupRunListQuery): Promise<BackupRunListResponse> {
    const { page, pageSize } = query;
    // System runs only: a backup a user saved to storage is theirs alone.
    const where = { scope: SYSTEM_SCOPE };
    const [rows, total] = await Promise.all([
      this.prisma.backupRun.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: BACKUP_RUN_INCLUDE,
      }),
      this.prisma.backupRun.count({ where }),
    ]);
    return {
      items: (rows as BackupRunRow[]).map(toBackupRunResponse),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** @throws NotFoundException unless the run succeeded and its object still exists. */
  async getDownload(id: string, actorUserId: string): Promise<BackupDownloadResponse> {
    const run = await this.findSystemRun(id);
    if (!run || run.status !== 'succeeded' || run.deletedAt || !run.storageKey) {
      throw new NotFoundException({ message: 'Backup not found or no longer available' });
    }

    const fileName = run.storageKey.split('/').pop() || 'vault-backup.zip';
    const expiresAt = new Date(Date.now() + BACKUP_DOWNLOAD_URL_TTL_SECONDS * 1000);
    const url = await this.storageProvider.getSignedDownloadUrl(run.storageKey, {
      expiresIn: BACKUP_DOWNLOAD_URL_TTL_SECONDS,
      // The web uses a hidden <a download>, whose attribute is ignored for a
      // cross-origin URL: the storage response itself must say "attachment".
      responseContentDisposition: `attachment; filename="${fileName}"`,
      responseContentType: 'application/zip',
    });

    await this.audit(actorUserId, BACKUPS_AUDIT_ACTIONS.download, 'backup_run', run.id, {
      runId: run.id,
    });

    return { url, expiresAt: expiresAt.toISOString(), fileName };
  }

  /**
   * Delete the backup's object and set `deleted_at`; the row stays for
   * history. Deleting an already deleted backup is a no-op.
   *
   * @throws NotFoundException for an unknown id; ConflictException while running.
   */
  async deleteRun(id: string, actorUserId: string): Promise<void> {
    const run = await this.findSystemRun(id);
    if (!run) {
      throw new NotFoundException({ message: 'Backup not found' });
    }
    if (run.status === 'running') {
      throw new ConflictException({ message: 'A running backup cannot be deleted' });
    }
    if (run.deletedAt) {
      return;
    }

    if (run.storageKey) {
      try {
        await this.storageProvider.delete(run.storageKey);
      } catch (error) {
        this.logger.error(`Backup ${run.id} could not be deleted from storage: ${(error as Error)?.message}`);
        throw new BadGatewayException({ message: 'The backup could not be deleted from storage' });
      }
    }

    await this.prisma.backupRun.update({ where: { id: run.id }, data: { deletedAt: new Date() } });
    await this.audit(actorUserId, BACKUPS_AUDIT_ACTIONS.delete, 'backup_run', run.id, {
      runId: run.id,
    });
  }

  /**
   * Stream a system backup to the caller now ("Download a backup now"):
   * same writer and layout as a scheduled run, nothing stored, no run row.
   *
   * The password is either the one given or the stored schedule password,
   * decrypted here and handed to the zip writer only. Counts are computed
   * (without decrypting values) and audited before the first byte is sent.
   *
   * @throws BadRequestException when the scheduled password is asked for but
   *   none is stored (or it cannot be decrypted).
   */
  async exportNow(input: ExportSystemBackupInput, actorUserId: string): Promise<SystemExportResult> {
    let password: string;
    if (input.useScheduledPassword) {
      const schedule = await this.prisma.backupSchedule.findUnique({
        where: { id: BACKUP_SCHEDULE_ID },
        select: { passwordEncrypted: true },
      });
      if (!schedule?.passwordEncrypted) {
        throw new BadRequestException({ message: NO_SCHEDULED_PASSWORD_MESSAGE });
      }
      try {
        password = decryptBackupPassword(this.crypto, schedule.passwordEncrypted);
      } catch (error) {
        this.logger.error(`Scheduled backup password could not be decrypted: ${(error as Error)?.message}`);
        throw new BadRequestException({ message: BACKUP_FAILURE_MESSAGES.passwordUnreadable });
      }
    } else {
      password = input.password as string;
    }

    const createdAt = new Date();
    const counts = await this.runner.countSystemArchive(input.selection, createdAt);

    await this.audit(actorUserId, BACKUPS_AUDIT_ACTIONS.export, 'backup_export', actorUserId, {
      contents: selectedContentKeys(input.selection),
      passwordSource: input.useScheduledPassword ? 'scheduled' : 'provided',
      counts: {
        users: counts.userCount,
        secrets: counts.secretCount,
        attachments: counts.attachmentCount,
        mediaFiles: counts.mediaFileCount,
        warnings: counts.warningCount,
      },
    });
    this.logger.log(
      `System backup export by ${actorUserId}: ${counts.userCount} user(s), ${counts.secretCount} secret(s), ` +
        `${counts.attachmentCount} attachment(s), ${counts.mediaFileCount} media file(s)`,
    );

    return {
      fileName: systemBackupFileName(createdAt),
      userCount: counts.userCount,
      secretCount: counts.secretCount,
      attachmentCount: counts.attachmentCount,
      mediaFileCount: counts.mediaFileCount,
      stream: await this.runner.streamSystemArchive(input.selection, password, createdAt),
    };
  }

  /** A system run by id; a user-saved run is invisible here (`null`). */
  private async findSystemRun(id: string) {
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run || (run.scope ?? SYSTEM_SCOPE) !== SYSTEM_SCOPE) {
      return null;
    }
    return run;
  }

  private toScheduleResponse(row: ScheduleRow | null): BackupScheduleResponse {
    const source = row ?? { ...DEFAULT_BACKUP_SCHEDULE };
    return {
      enabled: source.enabled,
      frequency: source.frequency as BackupFrequency,
      intervalHours: source.intervalHours ?? null,
      timeOfDay: source.timeOfDay,
      dayOfWeek: source.dayOfWeek ?? null,
      dayOfMonth: source.dayOfMonth ?? null,
      timezone: source.timezone,
      keepCount: source.keepCount,
      includeAttachments: source.includeAttachments,
      includeVersions: source.includeVersions,
      includeSecrets: source.includeSecrets ?? DEFAULT_BACKUP_SCHEDULE.includeSecrets,
      includeMedia: source.includeMedia ?? DEFAULT_BACKUP_SCHEDULE.includeMedia,
      includeSystem: source.includeSystem ?? DEFAULT_BACKUP_SCHEDULE.includeSystem,
      passwordConfigured: !!row?.passwordEncrypted,
      passwordUpdatedAt: row?.passwordUpdatedAt ? row.passwordUpdatedAt.toISOString() : null,
      nextRunAt: row?.nextRunAt ? row.nextRunAt.toISOString() : null,
      lastRunAt: row?.lastRunAt ? row.lastRunAt.toISOString() : null,
      storageConfigured: this.runner.isStorageConfigured(),
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  private async audit(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId, action, targetType, targetId, meta: meta as never },
    });
  }
}
