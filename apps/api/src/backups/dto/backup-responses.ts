import type { BackupFrequency } from '../backup-schedule';
import { BACKUP_CONTENT_KEYS, BackupContentKey } from '../../secrets/export/backup-contents';

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
  includeSecrets: boolean;
  includeMedia: boolean;
  includeSystem: boolean;
  passwordConfigured: boolean;
  passwordUpdatedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  storageConfigured: boolean;
  updatedAt: string | null;
}

export type BackupRunStatus = 'running' | 'succeeded' | 'failed';
export type BackupRunTrigger = 'schedule' | 'manual';
/** `system`: an administrator's backup of everyone; `user`: a backup a user saved to storage. */
export type BackupRunScope = 'system' | 'user';

export interface BackupRunResponse {
  id: string;
  scope: BackupRunScope;
  status: BackupRunStatus;
  trigger: BackupRunTrigger;
  triggeredBy: { id: string; email: string; displayName: string | null } | null;
  sizeBytes: number | null;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount: number;
  warningCount: number;
  /**
   * The content keys this run was made with, in a fixed order
   * (`secrets`, `attachments`, `versions`, `media`, `system`). Empty while the
   * run has not read its schedule yet, and for runs made before content
   * selection existed.
   */
  contents: BackupContentKey[];
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
  /** Absent only in old fixtures; the column defaults to `system`. */
  scope?: string;
  ownerId?: string | null;
  status: string;
  trigger: string;
  triggeredById: string | null;
  storageKey: string | null;
  sizeBytes: bigint | number | null;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount?: number;
  warningCount: number;
  contents?: string[];
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  deletedAt: Date | null;
  triggeredBy?: { id: string; email: string; displayName: string | null } | null;
  /** The queue job running this backup (absent on rows from before the queue ran backups). */
  job?: { status: string; finishedAt: Date | null } | null;
}

/** Prisma `include` that gives {@link BackupRunRow.triggeredBy} and {@link BackupRunRow.job}. */
export const BACKUP_RUN_INCLUDE = {
  triggeredBy: { select: { id: true, email: true, displayName: true } },
  job: { select: { status: true, finishedAt: true } },
} as const;

/** Shown when a run's job failed without the run recording it (the process died mid-run). */
export const JOB_FAILED_RUN_ERROR = 'Interrupted (the server running it stopped)';

/**
 * The status the UI sees. The row says `running` until the handler records the outcome; if
 * the job ended `failed` first (a crash or a reaped lease), the run is failed, not running.
 */
export function effectiveRunStatus(row: Pick<BackupRunRow, 'status' | 'job'>): BackupRunStatus {
  if (row.status === 'running' && row.job?.status === 'failed') {
    return 'failed';
  }
  return row.status as BackupRunStatus;
}

export function toBackupRunResponse(row: BackupRunRow): BackupRunResponse {
  const status = effectiveRunStatus(row);
  const derivedFailure = status !== row.status;
  return {
    id: row.id,
    scope: row.scope === 'user' ? 'user' : 'system',
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
    mediaFileCount: row.mediaFileCount ?? 0,
    warningCount: row.warningCount,
    contents: toContentKeys(row.contents),
    error: derivedFailure ? JOB_FAILED_RUN_ERROR : (row.error ?? null),
    startedAt: row.startedAt.toISOString(),
    finishedAt: (row.finishedAt ?? (derivedFailure ? row.job?.finishedAt : null))?.toISOString() ?? null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    downloadable: status === 'succeeded' && !row.deletedAt && !!row.storageKey,
  };
}

/** Known keys only, in {@link BACKUP_CONTENT_KEYS} order. */
function toContentKeys(stored: string[] | null | undefined): BackupContentKey[] {
  const set = new Set(stored ?? []);
  return BACKUP_CONTENT_KEYS.filter((key) => set.has(key));
}
