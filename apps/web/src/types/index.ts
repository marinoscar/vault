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

/**
 * Response of `GET /api/ai/status`.
 *
 * Deliberately two booleans — no model name, no key metadata, no reason. Any
 * signed-in user may read it, which is what makes "hide the scan button when
 * the feature is unavailable" implementable for a Viewer who cannot see system
 * settings at all.
 */
export interface AiStatus {
  enabled: boolean;
  features: {
    cardExtract: boolean;
  };
}

/**
 * Error codes returned by the AI endpoints, mirroring `AI_ERROR_CODES` in
 * `apps/api/src/ai/ai.constants.ts`.
 *
 * KNOWN ISSUE #35: the API's global `HttpExceptionFilter` unconditionally
 * overwrites `code` with a status-derived value, so none of these actually
 * reach the browser today — a 429 arrives as `TOO_MANY_REQUESTS` whether it was
 * a burst limit or the daily quota. Client code therefore branches on `code`
 * first and falls back to `status`, and starts distinguishing the two the
 * moment #35 is fixed. See `describeCardExtractionError` in
 * `hooks/useCardImport.ts`.
 */
export const AI_ERROR_CODES = {
  NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  KEY_UNREADABLE: 'AI_KEY_UNREADABLE',
  INVALID_IMAGE: 'AI_INVALID_IMAGE',
  RATE_LIMITED: 'AI_RATE_LIMITED',
  QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  UPSTREAM_AUTH: 'AI_UPSTREAM_AUTH',
  UPSTREAM_RATE_LIMITED: 'AI_UPSTREAM_RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'AI_UPSTREAM_UNAVAILABLE',
  EXTRACTION_FAILED: 'AI_EXTRACTION_FAILED',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/**
 * Why `POST /api/system-settings/ai/verify` said no.
 *
 * These are deliberately narrower than `AI_ERROR_CODES`: the point of the
 * connection test is to tell an admin *which thing* is wrong, because the
 * remedies live in completely different places. A rejected key is fixed by
 * pasting a new credential; a model that cannot see images is fixed by typing
 * a different model name; a quota problem is fixed on the provider's billing
 * page and by touching nothing here at all.
 *
 * `network` is not a verdict on the key or the model - it means the check
 * never got far enough to have an opinion, and must never be presented as a
 * failure of the configuration.
 */
export const AI_VERIFY_FAILURE_REASONS = [
  'invalid_key',
  'model_not_found',
  'model_no_image_support',
  'model_no_structured_output',
  'quota',
  'network',
  'unknown',
] as const;

export type AiVerifyFailureReason =
  (typeof AI_VERIFY_FAILURE_REASONS)[number];

/**
 * A passing connection test.
 *
 * `imageSupport` is part of the success shape rather than a separate check
 * because card import needs both halves - a key that works against a model
 * that cannot accept an image is still a broken configuration. The API only
 * ever produces `true` here, and only off a real request that carried an
 * image.
 */
export interface AiVerifySuccess {
  ok: true;
  /**
   * Model as reported by the provider, which is often a dated snapshot id
   * rather than the alias that was configured.
   */
  model: string;
  imageSupport: true;
  durationMs: number;
  /**
   * Request parameters the API had to drop for this model to accept the call.
   * Empty for a model that took the request as sent. Worth showing: it is the
   * only signal that a setting is silently being ignored for this model.
   */
  adaptedParameters: string[];
}

export interface AiVerifyFailure {
  ok: false;
  reason: AiVerifyFailureReason;
  /**
   * Operator-facing explanation written by the API. Deliberately not the
   * upstream error body, which can reflect request content back.
   */
  message: string;
  /** The model that was tested, so the admin can see what was checked. */
  model: string;
  durationMs: number;
  adaptedParameters: string[];
}

export type AiVerifyResult = AiVerifySuccess | AiVerifyFailure;

/**
 * Fields the extraction endpoint can return, mirroring `EXTRACTED_FIELD_NAMES`
 * in the API.
 *
 * `cvv` is deliberately absent and must never be added. The model is instructed
 * never to emit it and the API never returns it, because the CVV is the value
 * that turns a photographed card number into a usable card-not-present
 * credential. The wizard collects it by hand.
 */
export const EXTRACTED_CARD_FIELD_NAMES = [
  'cardholder_name',
  'number',
  'exp_month',
  'exp_year',
  'card_network',
  'card_kind',
  'issuing_bank',
  'security_code_2',
] as const;

export type ExtractedCardFieldName = (typeof EXTRACTED_CARD_FIELD_NAMES)[number];

/** Body of `POST /api/secrets/cards/extract`: already-cropped base64 data URLs. */
export interface ExtractCardRequest {
  front: string;
  back?: string;
}

/**
 * Response of `POST /api/secrets/cards/extract`.
 *
 * Nothing here is persisted server-side — the values exist only in this
 * response until the user confirms them on the review step.
 */
export interface CardExtractionResult {
  fields: Record<ExtractedCardFieldName, string | null>;
  /** 0..1 per field; 0 whenever the field came back null. */
  confidence: Record<ExtractedCardFieldName, number>;
  warnings: string[];
  model: string;
  /** True when the call succeeded but nothing legible came back. */
  partial: boolean;
}

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

/**
 * Role of an attachment within its secret version, mirroring
 * `attachmentRoleSchema` in the API. `null` is a generic attachment, of which a
 * version may have many; a role-bearing attachment is unique per version.
 */
export type AttachmentRole = 'card_front' | 'card_back';

export interface SecretAttachment {
  id: string;
  label: string | null;
  /** `null` for generic (role-less) attachments. */
  role: AttachmentRole | null;
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

/**
 * One file supplied with a renewal, mirroring `renewAttachmentSchema` in the
 * API.
 *
 * A role-bearing entry REPLACES the same-role file on the outgoing version; a
 * role-less entry is simply added. Anything whose role is absent from the
 * request is carried forward onto the new version untouched, which is what
 * keeps the old card's photos viewable in its own version.
 */
export interface RenewSecretAttachment {
  storageObjectId: string;
  role?: AttachmentRole;
  label?: string;
}

/**
 * Body of `POST /api/secrets/:id/renew`, mirroring `renewSecretSchema`.
 *
 * `data` is a REPLACEMENT, not a patch: the API validates it against the whole
 * secret type exactly as `PUT /secrets/:id` does, so every field the renewed
 * secret should keep must be present — including the ones the user did not
 * change. Sending a partial object silently drops the omitted fields from the
 * new version.
 */
export interface RenewSecretRequest {
  data: Record<string, string>;
  attachments?: RenewSecretAttachment[];
  /**
   * Whether the values were read off a photo by the AI rather than typed.
   *
   * Recorded in the audit trail as `extractionMethod` and nothing else — it has
   * no effect on validation or on what is stored. It exists so an AI-assisted
   * renewal can be told apart from a manual one after the fact, so it must
   * report what actually happened rather than whether AI was merely available.
   */
  aiAssisted?: boolean;
}

/**
 * Response of `POST /api/secrets/:id/renew`: the secret as it now stands, at
 * its new current version. Shape-identical to `GET /api/secrets/:id`.
 */
export type RenewSecretResponse = SecretDetail;

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
