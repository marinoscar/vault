export interface Role {
  name: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: Role[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  updatedAt: string;
  version: number;
}

/**
 * Masked AI settings, as returned by `GET /api/system-settings`.
 *
 * Mirrors `aiSettingsResponseSchema` in the API. The stored credential is
 * never sent to the client - all the UI ever learns is whether one exists,
 * its last 4 characters, and when it was last changed.
 */
export interface AiSettings {
  enabled: boolean;
  provider: 'openai';
  model: string;
  maxCallsPerUserPerDay: number;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  apiKeyUpdatedAt: string | null;
}

/**
 * The `ai` block accepted by `PATCH /api/system-settings`.
 *
 * Mirrors the `ai` member of `patchSystemSettingsSchema` in the API. `apiKey`
 * is write-only plaintext and is THREE-STATE - the distinction is load-bearing:
 *
 *   omitted -> keep the stored key
 *   null    -> clear the stored key (disables the feature for everyone)
 *   string  -> encrypt and replace the stored key
 *
 * Never populate `apiKey` unless the admin explicitly asked to set or clear it.
 * An unrelated edit that carries `apiKey: null` along silently destroys a
 * working credential.
 */
export interface AiSettingsUpdate {
  enabled?: boolean;
  model?: string;
  maxCallsPerUserPerDay?: number;
  apiKey?: string | null;
}

/** API-side validation bounds for the AI settings, mirrored for client-side checks. */
export const AI_API_KEY_MIN_LENGTH = 20;
export const AI_API_KEY_MAX_LENGTH = 300;
export const AI_MAX_CALLS_MIN = 0;
export const AI_MAX_CALLS_MAX = 10000;

/** API-side defaults (`DEFAULT_AI_SETTINGS`), used to seed the form when `ai` is null. */
export const AI_SETTINGS_DEFAULTS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxCallsPerUserPerDay: 50,
} as const;

export interface SystemSettings {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: Record<string, boolean>;
  /** `null` when the stored settings row predates the AI block. */
  ai: AiSettings | null;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

export interface AuthProvider {
  name: string;
  authUrl: string;
}

export interface AllowedEmailEntry {
  id: string;
  email: string;
  addedBy: { id: string; email: string } | null;
  addedAt: string;
  claimedBy: { id: string; email: string } | null;
  claimedAt: string | null;
  notes: string | null;
}

export interface AllowlistResponse {
  items: AllowedEmailEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  profileImageUrl: string | null;
  providerProfileImageUrl?: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeviceActivationInfo {
  userCode: string;
  clientInfo: {
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  };
  expiresAt: string;
}

export interface DeviceAuthorizationResponse {
  success: boolean;
  message: string;
}

// Personal Access Tokens
export type PatDurationUnit = 'minutes' | 'days' | 'months';

export interface PersonalAccessToken {
  id: string;
  name: string;
  tokenPrefix: string;
  durationValue: number;
  durationUnit: PatDurationUnit;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface PatCreatedResponse {
  token: string;
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string;
  createdAt: string;
}

// =============================================================================
// Secret Types
// =============================================================================

export interface FieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'select';
  required: boolean;
  sensitive: boolean;
  /** Allowed values; only meaningful when type is 'select'. */
  options?: string[];
}

export interface SecretType {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  fields: FieldDefinition[];
  allowAttachments: boolean;
  isSystem: boolean;
  createdAt: string;
}

// =============================================================================
// Secrets
// =============================================================================

export interface SecretListItem {
  id: string;
  name: string;
  description: string | null;
  type: SecretType;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecretAttachment {
  id: string;
  label: string | null;
  storageObject: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
  };
  createdAt: string;
}

export interface SecretDetail extends SecretListItem {
  values: Record<string, unknown>;
  createdBy: { id: string; email: string } | null;
  attachments: SecretAttachment[];
}

export interface SecretVersion {
  id: string;
  version: number;
  createdAt: string;
  createdBy: { id: string; email: string } | null;
  isCurrent: boolean;
}

export interface SecretVersionDetail extends SecretVersion {
  values: Record<string, unknown>;
}

export interface SecretsResponse {
  items: SecretListItem[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

// =============================================================================
// Media Types
// =============================================================================

export interface MediaFolder {
  id: string;
  name: string;
  userId: string;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFoldersResponse {
  items: MediaFolder[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface MediaFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFilesResponse {
  items: MediaFile[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
