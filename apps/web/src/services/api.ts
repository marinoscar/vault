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

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
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
          const error = await retryResponse.json().catch(() => ({}));
          throw new ApiError(
            error.message || 'Request failed',
            retryResponse.status,
            error.code,
            error.details,
          );
        }

        if (retryResponse.status === 204) {
          return undefined as T;
        }

        const data = await retryResponse.json();
        return data.data ?? data;
      }
      throw new ApiError('Unauthorized', 401);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.message || 'Request failed',
        response.status,
        error.code,
        error.details,
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();
    return data.data ?? data;
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
  AiVerifyResult,
  AttachmentRole,
  CardExtractionResult,
  ExtractCardRequest,
  SystemSettings,
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
 * Read card fields from already-cropped images.
 *
 * The transport is base64 JSON rather than multipart because `request()` above
 * force-sets `Content-Type: application/json` whenever a body is present — a
 * multipart endpoint would be unreachable through this client. Cropping is the
 * caller's job (see `utils/cardImage.ts`); whatever is passed here is what
 * leaves the device.
 *
 * The response never contains a CVV. The API does not ask the model for one.
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
 * stored key and model can actually do card extraction.
 *
 * IMPORTANT: this costs the operator money on every invocation. Call it only
 * from an explicit user action - never from an effect, a blur handler, or a
 * save path.
 *
 * Expected failures (bad key, wrong model, no quota) come back as a 200 with
 * `ok: false`, because they are answers rather than errors. Transport and
 * HTTP failures are normalised into the same shape here so callers render one
 * thing and nothing gets swallowed. This function does not throw.
 */
export async function verifyAiConnection(): Promise<AiVerifyResult> {
  try {
    const raw = await api.post<unknown>('/system-settings/ai/verify');
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
