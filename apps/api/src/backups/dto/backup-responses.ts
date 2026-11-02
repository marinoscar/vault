import type { BackupFrequency } from '../backup-schedule';

/**
 * Wire shapes of the backups API. Binding contract with the web client
 * (`apps/web/src/types`): do not change a field without changing both.
 * Responses are wrapped in `{ data }` by the global TransformInterceptor.
 */

/** `GET`/`PUT /api/admin/backups/schedule`. Never carries the password or its ciphertext. */
export interface BackupScheduleResponse {
  enabled: boolean;
  frequency: BackupFrequency;
  intervalHours: number | null;
  timeOfDay: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  keepCount: number;
  includeAttachments: boolean;
  includeVersions: boolean;
  passwordConfigured: boolean;
  passwordUpdatedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  storageConfigured: boolean;
  updatedAt: string | null;
}

export type BackupRunStatus = 'running' | 'succeeded' | 'failed';
export type BackupRunTrigger = 'schedule' | 'manual';

export interface BackupRunResponse {
  id: string;
  status: BackupRunStatus;
  trigger: BackupRunTrigger;
  triggeredBy: { id: string; email: string; displayName: string | null } | null;
  sizeBytes: number | null;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  warningCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  deletedAt: string | null;
  /** `status === 'succeeded' && !deletedAt`. */
  downloadable: boolean;
}

export interface BackupRunListResponse {
  items: BackupRunResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** `GET /api/admin/backups/:id/download`. */
export interface BackupDownloadResponse {
  url: string;
  expiresAt: string;
  fileName: string;
}

/** Row shape the mapper needs (a Prisma BackupRun with `triggeredBy` selected). */
export interface BackupRunRow {
  id: string;
  status: string;
  trigger: string;
  triggeredById: string | null;
  storageKey: string | null;
  sizeBytes: bigint | number | null;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  warningCount: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  deletedAt: Date | null;
  triggeredBy?: { id: string; email: string; displayName: string | null } | null;
}

/** Prisma `include` that gives {@link BackupRunRow.triggeredBy}. */
export const BACKUP_RUN_INCLUDE = {
  triggeredBy: { select: { id: true, email: true, displayName: true } },
} as const;

export function toBackupRunResponse(row: BackupRunRow): BackupRunResponse {
  const status = row.status as BackupRunStatus;
  return {
    id: row.id,
    status,
    trigger: row.trigger as BackupRunTrigger,
    triggeredBy: row.triggeredBy
      ? {
          id: row.triggeredBy.id,
          email: row.triggeredBy.email,
          displayName: row.triggeredBy.displayName ?? null,
        }
      : null,
    sizeBytes: row.sizeBytes === null || row.sizeBytes === undefined ? null : Number(row.sizeBytes),
    userCount: row.userCount,
    secretCount: row.secretCount,
    attachmentCount: row.attachmentCount,
    warningCount: row.warningCount,
    error: row.error ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    downloadable: status === 'succeeded' && !row.deletedAt && !!row.storageKey,
  };
}
