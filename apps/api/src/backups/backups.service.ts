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
import { BACKUP_SCHEDULE_ID, BackupRunnerService } from './backup-runner.service';
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
} as const;

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
    const [rows, total] = await Promise.all([
      this.prisma.backupRun.findMany({
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: BACKUP_RUN_INCLUDE,
      }),
      this.prisma.backupRun.count(),
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
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
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
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
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
