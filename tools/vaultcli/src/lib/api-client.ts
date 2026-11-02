import { config } from '../utils/config.js';
import { loadAuth } from './auth-store.js';
import type {
  HealthResponse,
  PaginatedResponse,
  Secret,
  SecretAttachment,
  SecretListItem,
  SecretType,
  SecretVersion,
  StorageObject,
  UserInfo,
} from '../utils/types.js';
import type {
  AdminBackupDownload,
  AdminBackupRun,
  AdminBackupRunList,
  AdminBackupSchedule,
  AdminBackupScheduleBody,
} from './admin-backups.js';

function getToken(): string {
  const auth = loadAuth();
  if (!auth) {
    throw new Error('Not authenticated. Run: vaultcli auth login');
  }
  return auth.token;
}

export interface ApiRequestOptions extends RequestInit {
  requireAuth?: boolean;
}

export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const { requireAuth = true, ...fetchOptions } = options;
  const url = `${config.apiUrl}${path}`;
  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (requireAuth) {
    headers['Authorization'] = `Bearer ${getToken()}`;
  }

  if (fetchOptions.body && typeof fetchOptions.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...fetchOptions, headers });

  if (response.status === 401 && requireAuth) {
    throw new Error('Authentication failed. Your token may be expired or revoked. Run: vaultcli auth login');
  }

  return response;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getCurrentUser(): Promise<UserInfo> {
  const res = await apiRequest('/auth/me');
  if (!res.ok) throw new Error('Failed to get user info');
  const json = (await res.json()) as { data: UserInfo };
  return json.data;
}

export async function validateToken(token: string): Promise<UserInfo> {
  const url = `${config.apiUrl}/auth/me`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Invalid token');
  const json = (await res.json()) as { data: UserInfo };
  return json.data;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export async function listSecrets(params: {
  page?: number;
  pageSize?: number;
  typeId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}): Promise<PaginatedResponse<SecretListItem>> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.typeId) query.set('typeId', params.typeId);
  if (params.search) query.set('search', params.search);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  const qs = query.toString();
  const res = await apiRequest(`/secrets${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`Failed to list secrets: ${res.status}`);
  const json = (await res.json()) as { data: PaginatedResponse<SecretListItem> };
  return json.data;
}

export async function getSecret(id: string): Promise<Secret> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to get secret: ${res.status}`);
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

export async function getSecretByName(name: string): Promise<Secret> {
  const res = await apiRequest(`/secrets/by-name/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to get secret: ${res.status}`);
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

/**
 * Resolve an ID-or-name argument to a Secret.
 * If the argument looks like a UUID, fetch by ID; otherwise fetch by name.
 */
export async function resolveSecret(idOrName: string): Promise<Secret> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_RE.test(idOrName)) {
    return getSecret(idOrName);
  }
  return getSecretByName(idOrName);
}

export async function createSecret(dto: {
  name: string;
  typeId: string;
  description?: string;
  data: Record<string, unknown>;
}): Promise<Secret> {
  const res = await apiRequest('/secrets', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create secret: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

export async function updateSecret(
  id: string,
  dto: { name?: string; description?: string; data?: Record<string, unknown> },
): Promise<Secret> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to update secret: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

export async function deleteSecret(id: string): Promise<void> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete secret: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function listVersions(secretId: string): Promise<SecretVersion[]> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(secretId)}/versions`);
  if (!res.ok) throw new Error(`Failed to list versions: ${res.status}`);
  const json = (await res.json()) as { data: SecretVersion[] };
  return json.data;
}

export async function getVersion(secretId: string, versionId: string): Promise<SecretVersion> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/versions/${encodeURIComponent(versionId)}`,
  );
  if (!res.ok) throw new Error(`Failed to get version: ${res.status}`);
  const json = (await res.json()) as { data: SecretVersion };
  return json.data;
}

export async function rollbackVersion(secretId: string, versionId: string): Promise<Secret> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/versions/${encodeURIComponent(versionId)}/rollback`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`Failed to rollback: ${res.status}`);
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

// ---------------------------------------------------------------------------
// Secret Types
// ---------------------------------------------------------------------------

export async function listSecretTypes(params?: {
  search?: string;
}): Promise<SecretType[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);

  const qs = query.toString();
  const res = await apiRequest(`/secret-types${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`Failed to list secret types: ${res.status}`);
  const json = (await res.json()) as { data: SecretType[] };
  return json.data;
}

export async function getSecretType(id: string): Promise<SecretType> {
  const res = await apiRequest(`/secret-types/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to get secret type: ${res.status}`);
  const json = (await res.json()) as { data: SecretType };
  return json.data;
}

// ---------------------------------------------------------------------------
// Storage objects & attachments
// ---------------------------------------------------------------------------

/**
 * Upload a file via the simple (single-request) storage endpoint.
 * The body is a FormData instance — apiRequest only forces a JSON
 * Content-Type for string bodies, so fetch sets the multipart boundary.
 */
export async function uploadStorageObject(params: {
  content: string | Buffer;
  filename: string;
  mimeType?: string;
}): Promise<StorageObject> {
  const form = new FormData();
  const blob = new Blob([params.content], {
    type: params.mimeType ?? 'text/plain',
  });
  form.append('file', blob, params.filename);

  const res = await apiRequest('/storage/objects', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to upload file: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data: StorageObject };
  return json.data;
}

export async function listAttachments(secretId: string): Promise<SecretAttachment[]> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/attachments`,
  );
  if (!res.ok) throw new Error(`Failed to list attachments: ${res.status}`);
  const json = (await res.json()) as { data: SecretAttachment[] };
  return json.data;
}

export async function linkAttachment(
  secretId: string,
  dto: { storageObjectId: string; label?: string },
): Promise<SecretAttachment> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/attachments`,
    { method: 'POST', body: JSON.stringify(dto) },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to link attachment: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data: SecretAttachment };
  return json.data;
}

export async function deleteAttachment(
  secretId: string,
  attachmentId: string,
): Promise<void> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete attachment: ${res.status}`);
  }
}

/**
 * Find the id of the system "Document" secret type (the one that
 * allows attachments). Used by the sync engine to create file secrets.
 */
export async function findDocumentTypeId(): Promise<string> {
  const types = await listSecretTypes();
  const doc = types.find((t) => t.name === 'Document' && t.allowAttachments);
  if (!doc) {
    throw new Error('Document secret type not found on server');
  }
  return doc.id;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function healthLive(): Promise<HealthResponse> {
  const res = await apiRequest('/health/live', { requireAuth: false });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export async function healthReady(): Promise<HealthResponse> {
  const res = await apiRequest('/health/ready', { requireAuth: false });
  if (!res.ok) throw new Error(`Readiness check failed: ${res.status}`);
  return (await res.json()) as HealthResponse;
}

// ---------------------------------------------------------------------------
// Raw / streaming requests
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from an API error response. Understands the
 * standard `{ code, message, details }` body (and a `{ error: {...} }` wrapper);
 * falls back to the status line. Consumes the response body.
 */
export async function readApiErrorMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`;
  let text = '';
  try {
    text = await res.text();
  } catch {
    return fallback;
  }
  if (!text) return fallback;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const src = (body.error && typeof body.error === 'object' ? body.error : body) as Record<string, unknown>;
    const msg = src.message ?? body.message;
    if (Array.isArray(msg)) return msg.map(String).join('; ');
    if (typeof msg === 'string' && msg) return msg;
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Not JSON; ignore the body (it may be HTML from a proxy).
  }
  return fallback;
}

/**
 * Like {@link apiRequest} (same URL resolution, Bearer auth and 401 handling)
 * but intended for binary/streaming responses: the body is never read here.
 * On a non-2xx status it throws with the API's error message, so a returned
 * Response is always ok and its `body` is ready to stream.
 */
export async function apiStreamRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const res = await apiRequest(path, options);
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res));
  }
  return res;
}

export interface SecretsExportRequest {
  password: string;
  /** Current secret values (server default true). */
  includeSecrets?: boolean;
  /** Secret attachments; requires includeSecrets (server default true). */
  includeAttachments?: boolean;
  /** Old secret versions; requires includeSecrets (server default false). */
  includeVersions?: boolean;
  /** The caller's media library folders and files (server default false). */
  includeMedia?: boolean;
}

/**
 * POST /api/secrets/export. Returns the ok streaming Response whose body is
 * the AES-256 encrypted zip; counts are in the X-Vault-Export-* headers
 * (`-Secrets`, `-Attachments`, `-Media-Files`).
 * The password travels only in the request body.
 */
export async function exportSecretsBackup(dto: SecretsExportRequest): Promise<Response> {
  try {
    return await apiStreamRequest('/secrets/export', {
      method: 'POST',
      body: JSON.stringify(dto),
      headers: { Accept: 'application/zip, application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Authentication failed')) throw err;
    throw new Error(`Backup failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Admin backups (/api/admin/backups, system_settings:read / :write)
// ---------------------------------------------------------------------------

/** A failed API call that keeps the HTTP status (for 403 / 404 / 409 handling). */
export class ApiStatusError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiStatusError';
  }
}

async function adminJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const res = await apiRequest(path, options);
  if (!res.ok) throw new ApiStatusError(res.status, await readApiErrorMessage(res));
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data: T };
  return json.data;
}

export function getAdminBackupSchedule(): Promise<AdminBackupSchedule> {
  return adminJson<AdminBackupSchedule>('/admin/backups/schedule');
}

/** PUT the full schedule; the password travels only in this body, and only when set. */
export function putAdminBackupSchedule(body: AdminBackupScheduleBody): Promise<AdminBackupSchedule> {
  return adminJson<AdminBackupSchedule>('/admin/backups/schedule', { method: 'PUT', body: JSON.stringify(body) });
}

export function startAdminBackupRun(): Promise<AdminBackupRun> {
  return adminJson<AdminBackupRun>('/admin/backups/run', { method: 'POST' });
}

export function listAdminBackupRuns(params: { page?: number; pageSize?: number } = {}): Promise<AdminBackupRunList> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return adminJson<AdminBackupRunList>(`/admin/backups${qs ? '?' + qs : ''}`);
}

/**
 * Find one run by id. The API has no single-run route, so this pages through
 * the list (newest first; a run being watched is on the first page). Returns
 * null when it is not found in the first `maxPages` pages.
 */
export async function findAdminBackupRun(id: string, maxPages = 5): Promise<AdminBackupRun | null> {
  for (let page = 1; page <= maxPages; page++) {
    const list = await listAdminBackupRuns({ page, pageSize: 100 });
    const hit = list.items.find((r) => r.id === id);
    if (hit) return hit;
    if (page >= list.totalPages) break;
  }
  return null;
}

export function getAdminBackupDownload(id: string): Promise<AdminBackupDownload> {
  return adminJson<AdminBackupDownload>(`/admin/backups/${encodeURIComponent(id)}/download`);
}

export async function deleteAdminBackupRun(id: string): Promise<void> {
  await adminJson<void>(`/admin/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
