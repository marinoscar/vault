const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiService {
  private accessToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Perform a fetch with the bearer token attached, refreshing the access
   * token and retrying ONCE on a 401. Resolves only with an OK response;
   * any non-2xx status is thrown as an ApiError built from the JSON error
   * body. Shared by the JSON (`request`) and binary (`requestBlob`) paths so
   * the refresh flow exists exactly once.
   */
  private async fetchWithAuth(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const { skipAuth = false, ...fetchOptions } = options;

    const headers: HeadersInit = {
      ...fetchOptions.headers,
    };

    // Only set Content-Type for requests with a body (Fastify 5 is strict about this)
    if (fetchOptions.body) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    if (!skipAuth && this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers,
      credentials: 'include', // Include cookies for refresh token
    });

    if (response.status === 401 && !skipAuth) {
      // Try to refresh token (only once, avoid infinite loops)
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Update authorization header with new token and retry ONCE
        const retryHeaders: HeadersInit = {
          'Content-Type': 'application/json',
          ...fetchOptions.headers,
          'Authorization': `Bearer ${this.accessToken}`,
        };

        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...fetchOptions,
          headers: retryHeaders,
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          throw await toApiError(retryResponse);
        }
        return retryResponse;
      }
      throw new ApiError('Unauthorized', 401);
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    return response;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.fetchWithAuth(endpoint, options);

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return data.data ?? data;
  }

  /**
   * POST a JSON body and return the raw response (body unread) for binary
   * downloads. Same auth + refresh-and-retry-once behavior as `post`; the
   * caller reads the body (e.g. `response.blob()`) and any headers.
   */
  postForResponse(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.fetchWithAuth(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async refreshToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = this.doRefreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        this.accessToken = null;
        return false;
      }

      const responseData = await response.json();
      // Unwrap the { data: { accessToken } } structure from TransformInterceptor
      const tokenData = responseData.data ?? responseData;

      // Validate that we actually got a token
      if (!tokenData.accessToken || typeof tokenData.accessToken !== 'string') {
        this.accessToken = null;
        return false;
      }

      this.accessToken = tokenData.accessToken;
      return true;
    } catch {
      this.accessToken = null;
      return false;
    }
  }

  // Generic methods
  get<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const error = await response.json().catch(() => ({}));
  return new ApiError(
    error.message || 'Request failed',
    response.status,
    error.code,
    error.details,
  );
}

export const api = new ApiService();

// Import types
import type {
  AllowlistResponse,
  AllowedEmailEntry,
  UsersResponse,
  UserListItem,
  DeviceActivationInfo,
  DeviceAuthorizationResponse,
  PersonalAccessToken,
  PatCreatedResponse,
  PatDurationUnit,
  FieldDefinition,
  SecretType,
  SecretDetail,
  SecretVersion,
  SecretVersionDetail,
  SecretAttachment,
  SecretsResponse,
  RenewSecretRequest,
  RenewSecretResponse,
  MediaFolder,
  MediaFoldersResponse,
  MediaFile,
  MediaFilesResponse,
  AiSettingsUpdate,
  AiStatus,
  AiVerifyFailure,
  AiVerifyFailureReason,
  AiVerifyRequest,
  AiVerifyResult,
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
} from '../types';

import { AI_VERIFY_FAILURE_REASONS } from '../types';

// =============================================================================
// AI API
// =============================================================================

/**
 * Whether AI-backed features are available to the current user.
 *
 * Readable by any signed-in user (system settings are admin-only), which is
 * what lets a Viewer's UI hide the card-scan entry point instead of offering a
 * button that can only ever return 503.
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
 * The response includes the card security code (`cvv`) among the candidate
 * values, so nothing here may log or persist the payload — it is handed
 * straight to the review form and lives only in component state until the user
 * saves.
 */
export async function extractCardFromImages(
  images: ExtractCardRequest,
): Promise<CardExtractionResult> {
  return api.post<CardExtractionResult>('/secrets/cards/extract', images);
}

// System Settings API

/**
 * PATCH the `ai` block of the system settings.
 *
 * This is the single place the AI patch body is assembled, because the
 * `apiKey` field is three-state and getting it wrong destroys a credential:
 *
 *   absent -> keep the stored key
 *   null   -> clear the stored key
 *   string -> replace the stored key
 *
 * `apiKey` is copied onto the payload ONLY when the caller passed something
 * other than `undefined`, so a caller saving unrelated fields (say, toggling
 * `enabled`) can never wipe the key by accident. `null` is passed through
 * untouched - that is a deliberate "clear it" from the caller.
 *
 * `version` is sent as `If-Match` for optimistic concurrency; the API answers
 * 409 when the settings changed underneath us.
 */
export async function patchSystemSettingsAi(
  ai: AiSettingsUpdate,
  version: number,
): Promise<SystemSettings> {
  const payload: AiSettingsUpdate = {};

  if (ai.enabled !== undefined) payload.enabled = ai.enabled;
  if (ai.model !== undefined) payload.model = ai.model;
  if (ai.maxCallsPerUserPerDay !== undefined) {
    payload.maxCallsPerUserPerDay = ai.maxCallsPerUserPerDay;
  }
  if (ai.apiKey !== undefined) payload.apiKey = ai.apiKey;

  return api.patch<SystemSettings>(
    '/system-settings',
    { ai: payload },
    { headers: { 'If-Match': String(version) } },
  );
}

function isAiVerifyFailureReason(
  value: unknown,
): value is AiVerifyFailureReason {
  return (
    typeof value === 'string' &&
    (AI_VERIFY_FAILURE_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Coerce whatever the endpoint actually returned into the union the UI
 * switches on.
 *
 * Anything unrecognised becomes an `unknown` failure rather than an
 * optimistic pass: a malformed response is not evidence that the
 * configuration works, and rendering a green tick for one would be the exact
 * false reassurance this feature exists to remove.
 */
function normalizeAiVerifyResult(raw: unknown): AiVerifyResult {
  const value = raw as LooseAiVerifyPayload | null | undefined;

  const model = typeof value?.model === 'string' ? value.model : '';
  const durationMs =
    typeof value?.durationMs === 'number' ? value.durationMs : 0;
  const adaptedParameters: string[] = Array.isArray(value?.adaptedParameters)
    ? (value.adaptedParameters as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];

  if (value?.ok === true) {
    // Defensive: success without image support is a failed test for our
    // purposes, whatever the API chose to call it. Card import sends photos.
    if (value.imageSupport === false) {
      return {
        ok: false,
        reason: 'model_no_image_support',
        message: typeof value.message === 'string' ? value.message : '',
        model,
        durationMs,
        adaptedParameters,
      };
    }

    return { ok: true, model, imageSupport: true, durationMs, adaptedParameters };
  }

  if (value?.ok === false) {
    return {
      ok: false,
      reason: isAiVerifyFailureReason(value.reason) ? value.reason : 'unknown',
      message: typeof value.message === 'string' ? value.message : '',
      model,
      durationMs,
      adaptedParameters,
    };
  }

  return {
    ok: false,
    reason: 'unknown',
    message: 'The connection test returned an unrecognised response.',
    model: '',
    durationMs: 0,
    adaptedParameters: [],
  };
}

/**
 * Loosened shape used only while validating an untrusted payload. Every field
 * is optional and none is narrowed, so the checks above are real checks rather
 * than assertions TypeScript has already decided the answer to.
 */
interface LooseAiVerifyPayload {
  ok?: boolean;
  reason?: unknown;
  message?: unknown;
  model?: unknown;
  imageSupport?: unknown;
  durationMs?: unknown;
  adaptedParameters?: unknown;
}

/**
 * Turn a thrown transport/HTTP failure into the same result union, so no path
 * out of `verifyAiConnection` is silent.
 *
 * A `fetch` rejection means the browser never got an answer - that is
 * `network`, and explicitly NOT a rejected key. Conflating the two would send
 * an admin off to reissue a perfectly good credential.
 */
function aiVerifyFailureFromError(err: unknown): AiVerifyFailure {
  if (err instanceof ApiError) {
    const detailReason = (
      err.details as { reason?: unknown } | null | undefined
    )?.reason;

    // Deliberately NOT mapping 5xx to `network`. Our API answering at all
    // means the browser reached it, and it throws on its own failures - a
    // stored key it cannot decrypt (503), or too many checks in a row (429).
    // Calling either of those "could not reach OpenAI" would send an admin to
    // debug their egress firewall over a problem in their own database.
    let reason: AiVerifyFailureReason = 'unknown';
    if (isAiVerifyFailureReason(detailReason)) {
      reason = detailReason;
    } else if (isAiVerifyFailureReason(err.code)) {
      reason = err.code;
    } else if (err.status === 0) {
      reason = 'network';
    }

    return {
      ok: false,
      reason,
      message: err.message,
      model: '',
      durationMs: 0,
      adaptedParameters: [],
    };
  }

  return {
    ok: false,
    reason: 'network',
    message:
      err instanceof Error
        ? err.message
        : 'The connection test could not be completed.',
    model: '',
    durationMs: 0,
    adaptedParameters: [],
  };
}

/**
 * Make one real call to the configured AI provider and report whether the
 * stored key and the given model can actually do card extraction.
 *
 * IMPORTANT: this costs the operator money on every invocation. Call it only
 * from an explicit user action - never from an effect, a blur handler, or a
 * save path.
 *
 * `request.model` is an unsaved candidate to probe instead of the stored model.
 * It is trimmed here, and a name that is empty or only whitespace is dropped
 * rather than sent: the API validates the trimmed length and answers 400 for a
 * blank, whereas an admin who has cleared the field means "test what is saved".
 * Nothing else is ever put in the body - notably not the API key, which the
 * server already holds and which has no business travelling back up the wire.
 *
 * Expected failures (bad key, wrong model, no quota) come back as a 200 with
 * `ok: false`, because they are answers rather than errors. Transport and
 * HTTP failures are normalised into the same shape here so callers render one
 * thing and nothing gets swallowed. This function does not throw.
 */
export async function verifyAiConnection(
  request: AiVerifyRequest = {},
): Promise<AiVerifyResult> {
  const model = request.model?.trim();
  // `undefined` (not `{}`) so `api.post` omits the body and the Content-Type
  // header entirely - which is the path the endpoint's `.default({})` exists to
  // keep working as "probe the stored model".
  const body: AiVerifyRequest | undefined = model ? { model } : undefined;

  try {
    const raw = await api.post<unknown>('/system-settings/ai/verify', body);
    return normalizeAiVerifyResult(raw);
  } catch (err) {
    return aiVerifyFailureFromError(err);
  }
}

// Allowlist API
export async function getAllowlist(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'all' | 'pending' | 'claimed';
}): Promise<AllowlistResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.status) searchParams.set('status', params.status);

  return api.get<AllowlistResponse>(`/allowlist?${searchParams}`);
}

export async function addToAllowlist(
  email: string,
  notes?: string,
): Promise<AllowedEmailEntry> {
  return api.post<AllowedEmailEntry>('/allowlist', { email, notes });
}

export async function removeFromAllowlist(id: string): Promise<void> {
  await api.delete<void>(`/allowlist/${id}`);
}

// Users API
export async function getUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  isActive?: boolean;
}): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.role) searchParams.set('role', params.role);
  if (params?.isActive !== undefined)
    searchParams.set('isActive', String(params.isActive));

  return api.get<UsersResponse>(`/users?${searchParams}`);
}

export async function updateUser(
  id: string,
  data: { displayName?: string; isActive?: boolean },
): Promise<UserListItem> {
  return api.patch<UserListItem>(`/users/${id}`, data);
}

export async function updateUserRoles(
  id: string,
  roles: string[],
): Promise<UserListItem> {
  return api.put<UserListItem>(`/users/${id}/roles`, { roles });
}

// Device Activation API
export async function getDeviceActivationInfo(
  userCode: string,
): Promise<DeviceActivationInfo> {
  return api.get<DeviceActivationInfo>(`/auth/device/activate?code=${userCode}`);
}

export async function authorizeDevice(
  userCode: string,
  approve: boolean,
): Promise<DeviceAuthorizationResponse> {
  return api.post<DeviceAuthorizationResponse>('/auth/device/authorize', {
    userCode,
    approve,
  });
}

// Personal Access Tokens API
export async function getPersonalAccessTokens(): Promise<PersonalAccessToken[]> {
  return api.get<PersonalAccessToken[]>('/pat');
}

export async function createPersonalAccessToken(data: {
  name: string;
  durationValue: number;
  durationUnit: PatDurationUnit;
}): Promise<PatCreatedResponse> {
  return api.post<PatCreatedResponse>('/pat', data);
}

export async function revokePersonalAccessToken(id: string): Promise<void> {
  await api.delete<void>(`/pat/${id}`);
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
  const token = api.getAccessToken();
  const response = await fetch('/api/storage/objects', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Upload failed');
  }
  const data = await response.json();
  return data.data ?? data;
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
async function readBackupStream(response: Response): Promise<BackupStreamResult> {
  const blob = await response.blob();
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
  const response = await api.postForResponse('/secrets/export', toUserBackupBody(options));
  const { userCount: _users, ...result } = await readBackupStream(response);
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
  const response = await api.postForResponse('/admin/backups/export', body);
  return readBackupStream(response);
}
