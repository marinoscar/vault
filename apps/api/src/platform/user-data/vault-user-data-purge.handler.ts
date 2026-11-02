import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import type { Job, JobHandler } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';
import type { StorageProvider } from '@marinoscar/platform-api/storage';

import { PrismaService } from '../../prisma/prisma.service';
import { VAULT_USER_DATA_PURGE_JOB_TYPE } from './user-data.constants';

const payloadSchema = z.object({ userId: z.string().uuid() });

/** A run is in flight only while its status says so AND its job is still alive. */
const ACTIVE_JOB_STATUSES = new Set(['pending', 'running']);

/** What one pass removed. */
export interface VaultUserDataPurgeResult {
  backupRunsDeleted: number;
  backupArchivesDeleted: number;
  backupArchivesFailed: number;
  backupRunsInFlight: number;
  secretTypesDeleted: number;
}

/**
 * `vault.user_data.purge` (issue #91, E9.3): the delegate the platform's `user.data.purge`
 * enqueues AFTER the inline rows of the user's `secrets` category are gone, for the two models it
 * cannot delete by itself:
 *
 *   BackupRun    a user's "My backups" runs (`scope: 'user'`, `ownerId` = the user). The archive of a
 *                run is an object under `user-backups/<userId>/`, NOT a `storage_objects` row, so
 *                the platform never sees its bytes. The handler deletes the bytes first, then the
 *                row; a provider failure keeps the row and the job retries.
 *   SecretType   the user's CUSTOM types that no secret uses any more (the user's secrets were deleted
 *                just before). A type another user's secret still uses stays (its author is detached
 *                when the user row goes); a system type (`is_system`) is never touched.
 *
 * Re-entrant: each pass selects what is left. A run still `running` (its job alive) is skipped and the
 * job fails so the queue retries, because deleting the row under a live runner would orphan an
 * archive. Server-only on purpose: no `nodeResultSchema` / `persistNodeResult`.
 */
@Injectable()
export class VaultUserDataPurgeHandler implements JobHandler, OnModuleInit {
  readonly type = VAULT_USER_DATA_PURGE_JOB_TYPE;
  readonly label = 'Vault user data purge';
  readonly profile = { maxRuntimeMs: 15 * 60_000, maxAttempts: 3 } as const;
  private readonly logger = new Logger(VaultUserDataPurgeHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new Error(`${this.type} job ${job.id}: payload must carry { userId (uuid) }`);
    const result = await this.purge(parsed.data.userId);
    this.logger.log(`${this.type} job ${job.id}: ${JSON.stringify(result)}`);
    if (result.backupArchivesFailed > 0 || result.backupRunsInFlight > 0) {
      throw new Error(
        `${this.type} job ${job.id}: ${result.backupArchivesFailed} archive(s) could not be deleted and ` +
          `${result.backupRunsInFlight} run(s) are still running; their rows are kept for the retry`,
      );
    }
  }

  /** One pass for one user. Exposed for the specs. */
  async purge(userId: string): Promise<VaultUserDataPurgeResult> {
    const result: VaultUserDataPurgeResult = {
      backupRunsDeleted: 0,
      backupArchivesDeleted: 0,
      backupArchivesFailed: 0,
      backupRunsInFlight: 0,
      secretTypesDeleted: 0,
    };

    const runs = await this.prisma.backupRun.findMany({
      where: { scope: 'user', ownerId: userId },
      select: { id: true, status: true, storageKey: true, deletedAt: true, job: { select: { status: true } } },
    });

    const removable: string[] = [];
    for (const run of runs) {
      if (run.status === 'running' && run.job && ACTIVE_JOB_STATUSES.has(run.job.status)) {
        result.backupRunsInFlight += 1;
        continue;
      }
      if (run.storageKey && !run.deletedAt) {
        try {
          await this.storage.delete(run.storageKey);
          result.backupArchivesDeleted += 1;
        } catch (error) {
          result.backupArchivesFailed += 1;
          this.logger.warn(`backup run ${run.id}: archive could not be deleted: ${(error as Error)?.message}`);
          continue;
        }
      }
      removable.push(run.id);
    }
    if (removable.length > 0) {
      result.backupRunsDeleted = (await this.prisma.backupRun.deleteMany({ where: { id: { in: removable } } })).count;
    }

    result.secretTypesDeleted = (
      await this.prisma.secretType.deleteMany({
        where: { createdById: userId, isSystem: false, secrets: { none: {} } },
      })
    ).count;

    return result;
  }
}
