import { BACKUP_CONTENT_KEYS, type BackupContentKey } from './backup-contents.js';
import type { BackupFrequency } from './index.js';

/**
 * Wire shapes of the backups API. Binding contract between the API and
 * every client: do not change a field without changing both ends.
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
