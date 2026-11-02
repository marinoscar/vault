import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers';
import { ExportSecretsOptions } from '../secrets/dto/export-secrets.dto';
import { selectedContentKeys } from '../secrets/export/backup-contents';
import { USER_BACKUP_KEEP_COUNT, USER_SCOPE } from './backup-runner.service';
import { BackupArchiveService } from './backup-archive.service';
import { BackupQueueService } from './backup-queue.service';
import { BACKUP_DOWNLOAD_URL_TTL_SECONDS } from './backups.service';
import {
  BACKUP_RUN_INCLUDE,
  BackupDownloadResponse,
  BackupRunListResponse,
  BackupRunResponse,
  BackupRunRow,
  effectiveRunStatus,
  toBackupRunResponse,
} from './dto/backup-responses';
import { BackupRunListQuery } from './dto/backup-run-list-query.dto';

export const MY_BACKUPS_AUDIT_ACTIONS = {
  run: 'backups.user.run',
  download: 'backups.user.download',
  delete: 'backups.user.delete',
} as const;

export const USER_STORAGE_NOT_CONFIGURED_MESSAGE =
  "Saving to storage isn't set up. Ask an administrator, or download the backup instead.";

/** `GET /api/backups/me/config`. */
export interface MyBackupsConfigResponse {
  storageConfigured: boolean;
  keepCount: number;
}

/**
 * A user's backups saved to object storage ("Save to the storage account").
 *
 * Every query is `scope: 'user' AND owner_id = <caller>`: a user only ever
 * sees, downloads or deletes their own saved backups, whatever permissions
 * they hold, and another user's run answers 404 exactly like an unknown id.
 *
 * The backup password is used only while the run builds the zip: it travels in the job
 * payload as `CryptoService` ciphertext (removed when the run settles) and is never
 * logged or audited.
 */
@Injectable()
export class MyBackupsService {
  private readonly logger = new Logger(MyBackupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly archive: BackupArchiveService,
    private readonly queue: BackupQueueService,
  ) {}

  getConfig(): MyBackupsConfigResponse {
    return { storageConfigured: this.archive.isStorageConfigured(), keepCount: USER_BACKUP_KEEP_COUNT };
  }

  /**
   * Queue saving a backup of the caller's data to storage. 202 with the
   * `running` row; a worker runs the `vault.user_backup.run` job.
   *
   * @throws BadRequestException when storage is not configured.
   * @throws ConflictException when the caller already has a run in progress.
   */
  async runNow(
    user: { id: string; email: string },
    options: ExportSecretsOptions,
  ): Promise<BackupRunResponse> {
    if (!this.archive.isStorageConfigured()) {
      throw new BadRequestException({ message: USER_STORAGE_NOT_CONFIGURED_MESSAGE });
    }

    const { password, ...selection } = options;
    const run = await this.queue.queueUserRun(user.id, selection, password);

    await this.audit(user.id, MY_BACKUPS_AUDIT_ACTIONS.run, run.id, {
      runId: run.id,
      contents: selectedContentKeys(selection),
    });

    return toBackupRunResponse(run);
  }

  async listRuns(userId: string, query: BackupRunListQuery): Promise<BackupRunListResponse> {
    const { page, pageSize } = query;
    const where = { scope: USER_SCOPE, ownerId: userId };
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

  /** @throws NotFoundException unless it is the caller's, succeeded, and still stored. */
  async getDownload(id: string, userId: string): Promise<BackupDownloadResponse> {
    const run = await this.findOwnRun(id, userId);
    if (!run || run.status !== 'succeeded' || run.deletedAt || !run.storageKey) {
      throw new NotFoundException({ message: 'Backup not found or no longer available' });
    }

    const fileName = run.storageKey.split('/').pop() || 'vault-backup.zip';
    const expiresAt = new Date(Date.now() + BACKUP_DOWNLOAD_URL_TTL_SECONDS * 1000);
    const url = await this.storageProvider.getSignedDownloadUrl(run.storageKey, {
      expiresIn: BACKUP_DOWNLOAD_URL_TTL_SECONDS,
      responseContentDisposition: `attachment; filename="${fileName}"`,
      responseContentType: 'application/zip',
    });

    await this.audit(userId, MY_BACKUPS_AUDIT_ACTIONS.download, run.id, { runId: run.id });
    return { url, expiresAt: expiresAt.toISOString(), fileName };
  }

  /**
   * Delete the object and set `deleted_at` (the row stays). Same semantics as
   * the admin delete: 409 while running, no-op when already deleted.
   *
   * @throws NotFoundException unless it is the caller's.
   */
  async deleteRun(id: string, userId: string): Promise<void> {
    const run = await this.findOwnRun(id, userId);
    if (!run) {
      throw new NotFoundException({ message: 'Backup not found' });
    }
    if (effectiveRunStatus(run) === 'running') {
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
    await this.audit(userId, MY_BACKUPS_AUDIT_ACTIONS.delete, run.id, { runId: run.id });
  }

  /** The caller's own user-saved run, or `null` (another user's run included). */
  private findOwnRun(id: string, userId: string) {
    return this.prisma.backupRun.findFirst({
      where: { id, scope: USER_SCOPE, ownerId: userId },
      include: { job: BACKUP_RUN_INCLUDE.job },
    });
  }

  private async audit(
    actorUserId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId, action, targetType: 'backup_run', targetId, meta: meta as never },
    });
  }
}
