import { Injectable, Logger, Inject } from '@nestjs/common';


import { PERMISSIONS } from '../core/roles.constants';
import {
  VAULT_BACKUP_FAILED_EVENT,
  VAULT_BACKUP_SUCCEEDED_EVENT,
  type VaultBackupNotificationData,
} from '../core/notification-data';
import type { BackupArchiveCounts } from './backup-archive.service';
import type { BackupRunRow } from './dto/backup-responses';
import { VAULT_NOTIFY, type VaultNotifyPort } from '../ports';

/** What the runner knows when a run settles. */
export interface BackupSettledOutcome {
  status: 'succeeded' | 'failed';
  finishedAt: Date;
  sizeBytes: number | null;
  counts: BackupArchiveCounts | null;
  /** The static failure message (`BACKUP_FAILURE_MESSAGES`); only for `failed`. */
  error?: string;
}

/**
 * Raises `vault.backup_succeeded` / `vault.backup_failed` when a run settles (issue #86, E7.2).
 *
 * The audience is the run's owner for a user backup ("My backups") and the holders of
 * `system_settings:read` (the permission the backups admin routes enforce) for a system
 * backup. The runner calls {@link runSettled} AFTER the `backup_runs` update has committed and
 * outside any `$transaction`; `NotificationsService` never rejects, and this wrapper swallows
 * everything else, so a mail outage can never change a run's outcome.
 *
 * The payload carries ids, counts, size, times and the static failure message only; never a
 * password, a storage key, a raw error or any archive content.
 */
@Injectable()
export class BackupNotifier {
  private readonly logger = new Logger(BackupNotifier.name);

  constructor(@Inject(VAULT_NOTIFY) private readonly notifications: VaultNotifyPort) {}

  async runSettled(run: BackupRunRow, outcome: BackupSettledOutcome): Promise<void> {
    try {
      const scope = run.scope === 'user' ? 'user' : 'system';
      const data: VaultBackupNotificationData = {
        runId: run.id,
        scope,
        trigger: run.trigger === 'manual' ? 'manual' : 'schedule',
        startedAt: run.startedAt.toISOString(),
        finishedAt: outcome.finishedAt.toISOString(),
        sizeBytes: outcome.sizeBytes,
        secretCount: outcome.counts?.secretCount ?? 0,
        attachmentCount: outcome.counts?.attachmentCount ?? 0,
        mediaFileCount: outcome.counts?.mediaFileCount ?? 0,
        warningCount: outcome.counts?.warningCount ?? 0,
        ...(outcome.status === 'failed' && outcome.error ? { error: outcome.error } : {}),
        ...(process.env.APP_URL ? { appUrl: process.env.APP_URL } : {}),
      };
      const event = outcome.status === 'succeeded' ? VAULT_BACKUP_SUCCEEDED_EVENT : VAULT_BACKUP_FAILED_EVENT;

      if (scope === 'user') {
        if (!run.ownerId) return;
        await this.notifications.notify(event, run.ownerId, data);
      } else {
        await this.notifications.notifyPermissionHolders(event, PERMISSIONS.SYSTEM_SETTINGS_READ, data);
      }
    } catch (error) {
      this.logger.warn(`Backup run ${run.id}: notification could not be raised: ${(error as Error)?.message}`);
    }
  }
}
