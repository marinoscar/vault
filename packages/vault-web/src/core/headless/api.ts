/**
 * The Vault domain calls, made through the host's one HTTP client.
 *
 * E3.3 (#78): the transport is the platform's `PlatformHttpClient`
 * (`@marinoscar/platform-web/core`): the access-token holder, the one-shot
 * 401 -> refresh -> retry, the cross-page refresh lock and the "session
 * expired" signal the packaged `AuthProvider` drives sessions through.
 * E12.3 (#104): the host builds that client (`apps/web/src/services/api.ts`)
 * and hands it to this package with `configureVaultWeb` (`http.ts`); `api`
 * below is that client.
 *
 * `ApiError` is re-exported so the call sites that import it from here keep
 * doing so; it is the platform's class (same `message`, `status`, `code`,
 * `details`), so `instanceof` still matches.
 */

import { ApiError } from '@marinoscar/platform-web/core';
import type { PlatformHttpBlobWithHeaders, PlatformHttpRequestOptions } from '@marinoscar/platform-web/core';

import { api } from './http.js';

export { ApiError, api };

/** Request options of {@link api}, for the few callers that name the type. */
export type RequestOptions = PlatformHttpRequestOptions;

// Import types
import type {
  FieldDefinition,
  SecretType,
  SecretDetail,
  SecretVersion,
  SecretVersionDetail,
  SecretAttachment,
  SecretsResponse,
  CardSummaryResponse,
  RenewSecretRequest,
  RenewSecretResponse,
  MediaFolder,
  MediaFoldersResponse,
  MediaFile,
  MediaFilesResponse,
  AiStatus,
  AttachmentRole,
  CardExtractionResult,
  ExtractCardRequest,
  SystemSettings,
  BackupSchedule,
  UpdateBackupScheduleRequest,
  BackupRun,
  BackupRunsResponse,
  BackupDownloadLink,
  MyBackupsConfig,
  AdminBackupExportRequest,
} from './types.js';


// =============================================================================
// AI API
// =============================================================================

/**
 * Whether AI-backed features are available to the current user.
 *
 * Readable by any signed-in user (system settings are admin-only). Since E8.1
 * it is the compatibility alias of the platform's `GET /api/ai/config`, same
 * wire shape. `useAiStatus` combines it with the caller's `ai:use`.
 */
export async function getAiStatus(): Promise<AiStatus> {
  return api.get<AiStatus>('/ai/status');
}

/**
 * Locate a card in FULL photos and read its fields.
 *
 * The transport is base64 JSON rather than multipart because `request()` above
 * force-sets `Content-Type: application/json` whenever a body is present — a
 * multipart endpoint would be unreachable through this client. Preparing the
 * photos (downscale, size cap — see `prepareCardPhoto` in `utils/cardImage.ts`)
 * is the caller's job; whatever is passed here is what leaves the device. The
 * response's `crops` boxes are what the client then crops the stored
 * attachments from — the full photos themselves are never uploaded to storage.
 *
 * The response carries card values (never a security code: `cvv` and
 * `security_code_2` are always null since E8.1), so nothing here may log or
 * persist the payload — it is handed straight to the review form and lives only
 * in component state until the user saves.
 */
export async function extractCardFromImages(
  images: ExtractCardRequest,
): Promise<CardExtractionResult> {
  return api.post<CardExtractionResult>('/secrets/cards/extract', images);
}

// System Settings API

/**
 * Set the model card scanning runs on: `PATCH /api/system-settings` with
 * `{ ai: { cardExtractModel } }` (Vault's extension of the platform AI policy,
 * E8.2 #88). Everything else in the `ai` namespace is the platform's and is
 * edited on the packaged AI page (`/api/admin/ai/*`); the provider key is never
 * sent through system settings (the API ignores `ai.apiKey`).
 *
 * `version` goes as `If-Match`; the API answers 409 when the settings changed
 * underneath us.
 */
export async function patchCardExtractModel(
  cardExtractModel: string,
  version: number,
): Promise<SystemSettings> {
  return api.patch<SystemSettings>(
    '/system-settings',
    { ai: { cardExtractModel } },
    { headers: { 'If-Match': version.toString() } },
  );
}

// Secret Types API
export async function getSecretTypes(params?: {
  search?: string;
  includeSystem?: boolean;
}): Promise<SecretType[]> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.includeSystem !== undefined) searchParams.set('includeSystem', String(params.includeSystem));
  const query = searchParams.toString();
  return api.get<SecretType[]>(`/secret-types${query ? `?${query}` : ''}`);
}

export async function getSecretType(id: string): Promise<SecretType> {
  return api.get<SecretType>(`/secret-types/${id}`);
}

export async function createSecretType(data: {
  name: string;
  description?: string;
  icon?: string;
  fields: FieldDefinition[];
  allowAttachments: boolean;
}): Promise<SecretType> {
  return api.post<SecretType>('/secret-types', data);
}

export async function updateSecretType(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    fields?: FieldDefinition[];
    allowAttachments?: boolean;
  },
): Promise<SecretType> {
  return api.put<SecretType>(`/secret-types/${id}`, data);
}

export async function deleteSecretType(id: string): Promise<void> {
  await api.delete<void>(`/secret-types/${id}`);
}

// Secrets API
export async function getSecrets(params?: {
  page?: number;
  pageSize?: number;
  typeId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}): Promise<SecretsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.typeId) searchParams.set('typeId', params.typeId);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  return api.get<SecretsResponse>(`/secrets?${searchParams}`);
}

/**
 * One page of the caller's card summaries (#118), sorted soonest expiry first.
 * `pageSize` is capped at 100 by the API.
 */
export async function getCardSummaries(params?: {
  page?: number;
  pageSize?: number;
}): Promise<CardSummaryResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params?.page ?? 1));
  searchParams.set('pageSize', String(params?.pageSize ?? 20));
  return api.get<CardSummaryResponse>(`/secrets/cards/summary?${searchParams}`);
}

export async function getSecret(id: string): Promise<SecretDetail> {
  return api.get<SecretDetail>(`/secrets/${id}`);
}

export async function createSecret(data: {
  name: string;
  description?: string;
  typeId: string;
  data: Record<string, unknown>;
}): Promise<SecretDetail> {
  return api.post<SecretDetail>('/secrets', data);
}

export async function updateSecret(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<SecretDetail> {
  return api.put<SecretDetail>(`/secrets/${id}`, data);
}

export async function deleteSecret(id: string): Promise<void> {
  await api.delete<void>(`/secrets/${id}`);
}

export async function getSecretVersions(secretId: string): Promise<SecretVersion[]> {
  return api.get<SecretVersion[]>(`/secrets/${secretId}/versions`);
}

export async function getSecretVersion(
  secretId: string,
  versionId: string,
): Promise<SecretVersionDetail> {
  return api.get<SecretVersionDetail>(`/secrets/${secretId}/versions/${versionId}`);
}

export async function rollbackSecretVersion(
  secretId: string,
  versionId: string,
): Promise<SecretDetail> {
  return api.post<SecretDetail>(`/secrets/${secretId}/versions/${versionId}/rollback`);
}

/**
 * Renew a secret: create the next version from a new full field set, swapping
 * only the attachment roles named in the request.
 *
 * This is the ONE call the renewal flow makes to commit. It is atomic on the
 * server — version bump, attachment carry-forward and replacement insert all
 * happen in a single transaction — so there is no half-renewed state to unwind
 * on failure, unlike creating a secret and then linking files to it.
 *
 * `body.data` must be the COMPLETE field set for the renewed secret. The API
 * replaces rather than merges, so any field left out is gone from the new
 * version even though it was present on the old one.
 */
export async function renewSecret(
  secretId: string,
  body: RenewSecretRequest,
): Promise<RenewSecretResponse> {
  return api.post<RenewSecretResponse>(`/secrets/${secretId}/renew`, body);
}

/**
 * Link an already-uploaded storage object to a secret.
 *
 * `role` marks the object as a card face. The API enforces one attachment per
 * role per secret version and applies image mime/size constraints to
 * role-bearing attachments, so passing a role is not cosmetic — it changes what
 * the server will accept.
 */
export async function linkSecretAttachment(
  secretId: string,
  storageObjectId: string,
  label?: string,
  role?: AttachmentRole,
): Promise<SecretAttachment> {
  return api.post<SecretAttachment>(`/secrets/${secretId}/attachments`, {
    storageObjectId,
    label,
    role,
  });
}

export async function unlinkSecretAttachment(
  secretId: string,
  attachmentId: string,
): Promise<void> {
  await api.delete<void>(`/secrets/${secretId}/attachments/${attachmentId}`);
}

// =============================================================================
// Media API
// =============================================================================

export async function getMediaFolders(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}): Promise<MediaFoldersResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  return api.get<MediaFoldersResponse>(`/media/folders?${searchParams}`);
}

export async function getMediaFolder(folderId: string): Promise<MediaFolder> {
  return api.get<MediaFolder>(`/media/folders/${folderId}`);
}

export async function createMediaFolder(name: string): Promise<MediaFolder> {
  return api.post<MediaFolder>('/media/folders', { name });
}

export async function updateMediaFolder(folderId: string, name: string): Promise<MediaFolder> {
  return api.patch<MediaFolder>(`/media/folders/${folderId}`, { name });
}

export async function deleteMediaFolder(folderId: string): Promise<void> {
  await api.delete<void>(`/media/folders/${folderId}`);
}

export async function getMediaFiles(
  folderId: string,
  params?: { page?: number; pageSize?: number; search?: string },
): Promise<MediaFilesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  return api.get<MediaFilesResponse>(`/media/folders/${folderId}/files?${searchParams}`);
}

export async function getMediaFile(folderId: string, fileId: string): Promise<MediaFile> {
  return api.get<MediaFile>(`/media/folders/${folderId}/files/${fileId}`);
}

export async function linkMediaFile(folderId: string, storageObjectId: string): Promise<MediaFile> {
  return api.post<MediaFile>(`/media/folders/${folderId}/files`, { storageObjectId });
}

export async function renameMediaFile(
  folderId: string,
  fileId: string,
  name: string,
): Promise<MediaFile> {
  return api.patch<MediaFile>(`/media/folders/${folderId}/files/${fileId}`, { name });
}

export async function deleteMediaFile(folderId: string, fileId: string): Promise<void> {
  await api.delete<void>(`/media/folders/${folderId}/files/${fileId}`);
}

export async function getMediaFileDownloadUrl(
  folderId: string,
  fileId: string,
): Promise<{ url: string; expiresIn: number }> {
  return api.get<{ url: string; expiresIn: number }>(
    `/media/folders/${folderId}/files/${fileId}/download`,
  );
}

// =============================================================================
// Storage objects
// =============================================================================

/**
 * Signed download URL for any storage object the caller owns.
 *
 * The media variant above is scoped to a folder and cannot address an object
 * linked as a secret attachment, which is what card face images are.
 */
export async function getStorageObjectDownloadUrl(
  objectId: string,
  expiresIn?: number,
): Promise<{ url: string; expiresIn: number }> {
  const query = expiresIn !== undefined ? `?expiresIn=${expiresIn}` : '';
  return api.get<{ url: string; expiresIn: number }>(
    `/storage/objects/${objectId}/download${query}`,
  );
}

/**
 * Delete a storage object outright.
 *
 * Used to clean up after an abandoned or half-failed card import: an image
 * uploaded before the flow was cancelled would otherwise sit in storage with
 * nothing pointing at it and no UI able to reach it.
 */
export async function deleteStorageObject(objectId: string): Promise<void> {
  await api.delete<void>(`/storage/objects/${objectId}`);
}

export async function simpleStorageUpload(
  file: File,
): Promise<{ id: string; name: string; mimeType: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  return api.postFormData('/storage/objects', formData);
}

// =============================================================================
// Data backup API
// =============================================================================

export interface SecretsBackupOptions {
  password: string;
  /** Default true. */
  includeSecrets?: boolean;
  /** Default true; only sent as true while includeSecrets is on. */
  includeAttachments?: boolean;
  /** Default false; only sent as true while includeSecrets is on. */
  includeVersions?: boolean;
  /** Default false: the user's own media library. */
  includeMedia?: boolean;
}

export interface SecretsBackupResult {
  blob: Blob;
  filename: string;
  secretCount: number | null;
  attachmentCount: number | null;
  mediaFileCount: number | null;
}

/** `vault-backup-YYYY-MM-DD.zip` for the given date (UTC, matching the server). */
export function defaultBackupFilename(date: Date = new Date()): string {
  return `vault-backup-${date.toISOString().slice(0, 10)}.zip`;
}

/**
 * Extract the file name from a Content-Disposition header. Supports the
 * RFC 5987 `filename*=UTF-8''...` form and quoted/unquoted `filename=`.
 * Path separators are stripped so the value can only name a file.
 */
export function parseContentDispositionFilename(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  let name: string | null = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i.exec(header);
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
    if (plain) name = (plain[1] ?? plain[2] ?? '').trim();
  }
  if (!name) return null;
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  return base.length > 0 ? base : null;
}

function parseCountHeader(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The streamed zip of a backup export, with the counts the server reports. */
export interface BackupStreamResult {
  blob: Blob;
  filename: string;
  /** Admin downloads only (X-Vault-Export-Users); null when absent. */
  userCount: number | null;
  secretCount: number | null;
  attachmentCount: number | null;
  mediaFileCount: number | null;
}

/**
 * Read a raw backup zip response: the body as a Blob, the file name from
 * Content-Disposition (falling back to `vault-backup-YYYY-MM-DD.zip`) and
 * the X-Vault-Export-* counts. Shared by every streamed backup download.
 */
function readBackupStream(response: PlatformHttpBlobWithHeaders): BackupStreamResult {
  const { blob } = response;
  return {
    blob,
    filename:
      parseContentDispositionFilename(response.headers.get('Content-Disposition')) ??
      defaultBackupFilename(),
    userCount: parseCountHeader(response.headers.get('X-Vault-Export-Users')),
    secretCount: parseCountHeader(response.headers.get('X-Vault-Export-Secrets')),
    attachmentCount: parseCountHeader(response.headers.get('X-Vault-Export-Attachments')),
    mediaFileCount: parseCountHeader(response.headers.get('X-Vault-Export-Media-Files')),
  };
}

/**
 * The user backup body shared by the download (`/secrets/export`) and the
 * save-to-storage (`/backups/me`) routes. Attachments and versions are part
 * of a secret: the API rejects them without secrets, so they are forced off
 * when secrets is off.
 */
function toUserBackupBody(options: SecretsBackupOptions) {
  const includeSecrets = options.includeSecrets ?? true;
  return {
    password: options.password,
    includeSecrets,
    includeAttachments: includeSecrets && (options.includeAttachments ?? true),
    includeVersions: includeSecrets && (options.includeVersions ?? false),
    includeMedia: options.includeMedia ?? false,
  };
}

/**
 * Download a password-protected (AES-256 zip) backup of what the current
 * user owns: secrets (with attachments / old versions) and/or their media
 * library. The password travels only in the request body; it is
 * never logged or stored here.
 */
export async function downloadSecretsBackup(
  options: SecretsBackupOptions,
): Promise<SecretsBackupResult> {
  const response = await api.post<PlatformHttpBlobWithHeaders>('/secrets/export', toUserBackupBody(options), {
    responseType: 'blobWithHeaders',
  });
  const { userCount: _users, ...result } = readBackupStream(response);
  return result;
}

// =============================================================================
// Saved backups API (the current user's backups in object storage)
// =============================================================================

/** Whether saving to storage is available, and how many saved backups are kept. */
export async function getMyBackupsConfig(): Promise<MyBackupsConfig> {
  return api.get<MyBackupsConfig>('/backups/me/config');
}

/**
 * Build the same zip as `downloadSecretsBackup` on the server and save it to
 * object storage (202, runs in the background). The password is used only
 * while building and never stored. Rejects with a 409 ApiError while one of
 * the user's backups is running, 400 when storage is not configured.
 */
export async function saveMyBackupToStorage(options: SecretsBackupOptions): Promise<BackupRun> {
  return api.post<BackupRun>('/backups/me', toUserBackupBody(options));
}

/** The current user's saved backups, newest first. */
export async function getMyBackups(params?: {
  page?: number;
  pageSize?: number;
}): Promise<BackupRunsResponse> {
  return api.get<BackupRunsResponse>(`/backups/me${pageQuery(params)}`);
}

/** Short-lived signed download URL for one of the user's saved backups. */
export async function getMyBackupDownloadUrl(id: string): Promise<BackupDownloadLink> {
  return api.get<BackupDownloadLink>(`/backups/me/${encodeURIComponent(id)}/download`);
}

/** Delete one of the user's saved backups from storage (the row stays, marked deleted). */
export async function deleteMyBackup(id: string): Promise<void> {
  await api.delete<void>(`/backups/me/${encodeURIComponent(id)}`);
}

function pageQuery(params?: { page?: number; pageSize?: number }): string {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// =============================================================================
// Scheduled backups API (admin)
// =============================================================================

/** Current backup schedule (server defaults when none was saved). Never the password. */
export async function getBackupSchedule(): Promise<BackupSchedule> {
  return api.get<BackupSchedule>('/admin/backups/schedule');
}

/**
 * Replace the backup schedule. `password` is write-only: leave it out to keep
 * the stored one. The password travels only in this request body.
 */
export async function updateBackupSchedule(
  data: UpdateBackupScheduleRequest,
): Promise<BackupSchedule> {
  return api.put<BackupSchedule>('/admin/backups/schedule', data);
}

/** Start a manual backup run (202). Rejects with a 409 ApiError while one is running. */
export async function runBackupNow(): Promise<BackupRun> {
  return api.post<BackupRun>('/admin/backups/run');
}

/** Backup run history, newest first. */
export async function getBackupRuns(params?: {
  page?: number;
  pageSize?: number;
}): Promise<BackupRunsResponse> {
  return api.get<BackupRunsResponse>(`/admin/backups${pageQuery(params)}`);
}

/** Short-lived signed download URL for a succeeded, not deleted backup. */
export async function getBackupDownloadUrl(id: string): Promise<BackupDownloadLink> {
  return api.get<BackupDownloadLink>(`/admin/backups/${encodeURIComponent(id)}/download`);
}

/** Delete a backup's archive from storage (the run row stays, marked deleted). */
export async function deleteBackupRun(id: string): Promise<void> {
  await api.delete<void>(`/admin/backups/${encodeURIComponent(id)}`);
}

/**
 * Build a backup now and stream it to the browser; nothing is stored. Send
 * either a `password` or `useScheduledPassword: true` (the stored schedule
 * password), never both. The password travels only in the request body.
 */
export async function downloadAdminBackup(
  request: AdminBackupExportRequest,
): Promise<BackupStreamResult> {
  const { password, useScheduledPassword, ...flags } = request;
  // Attachments and versions are part of a secret: forced off without secrets.
  const contents = {
    ...flags,
    includeAttachments: flags.includeSecrets && flags.includeAttachments,
    includeVersions: flags.includeSecrets && flags.includeVersions,
  };
  const body = useScheduledPassword
    ? { useScheduledPassword: true, ...contents }
    : { password, ...contents };
  const response = await api.post<PlatformHttpBlobWithHeaders>('/admin/backups/export', body, {
    responseType: 'blobWithHeaders',
  });
  return readBackupStream(response);
}
