import type { AttachmentRole } from '@marinoscar/vault-contract/secrets';
import type {
  BackupFrequency,
  BackupRunStatus,
  BackupRunTrigger,
} from '@marinoscar/vault-contract/backups';

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
 * The `ai` namespace of `GET /api/system-settings` (E8.1, #87): the platform AI
 * slice's policy (`enabled`, `keyPolicy`, `providers`, `limits`, `defaults`, ...)
 * plus Vault's one extension, `cardExtractModel`, the model `card_extract` runs on.
 *
 * Only the two fields Vault's own UI reads are typed; the rest of the policy is
 * edited on the packaged AI page (`PUT /api/admin/ai/config`) and passed through
 * untouched. No field here can hold a provider key: keys are credentials, set and
 * cleared only through `/api/admin/ai/*`, and never returned.
 */
export interface VaultAiPolicy {
  enabled: boolean;
  cardExtractModel: string;
  [field: string]: unknown;
}

/** Bounds of `ai.cardExtractModel` (`vaultAiExtensionSchema` in the API). */
export const CARD_EXTRACT_MODEL_MAX_LENGTH = 128;

/**
 * Error codes `POST /api/secrets/cards/extract` answers with, defined once in
 * `@marinoscar/vault-contract/errors` (`AI_ERROR_CODES`). Client code branches on
 * `code` first and falls back to `status` (see `describeCardExtractionError` in
 * `hooks/useCardImport.ts`).
 *
 * `AI_NOT_CONFIGURED` (503) means AI is on but the provider, model or key is not
 * set up. AI switched OFF is a different answer: the platform kill switch
 * (`AiEnabledGuard`) refuses with `403`, top-level code `FORBIDDEN` and
 * `details.reason` {@link AI_DISABLED_REASON}.
 */
export { AI_ERROR_CODES, type AiErrorCode } from '@marinoscar/vault-contract/errors';

/** `details.reason` of the platform kill switch's `403` (AI switched off). */
export const AI_DISABLED_REASON = 'AI_DISABLED';

/**
 * Fields the extraction endpoint can return, mirroring `EXTRACTED_FIELD_NAMES`
 * in the API.
 *
 * `notes` is auxiliary text read off the card that fits no structured field —
 * support phone numbers, "Member Since", usage instructions — and seeds the
 * review form's Notes input.
 *
 * `cvv` and `security_code_2` stay in the list because the response shape keeps
 * them, but since E8.1 (#87) they are ALWAYS `null` with confidence 0: the model
 * is told not to read a security code, its schema has no field for one, and the
 * API forces both to null. The review form never seeds them; the user types them.
 */
export const EXTRACTED_CARD_FIELD_NAMES = [
  'cardholder_name',
  'number',
  'exp_month',
  'exp_year',
  'cvv',
  'card_network',
  'card_kind',
  'issuing_bank',
  'security_code_2',
  'notes',
] as const;

export type ExtractedCardFieldName = (typeof EXTRACTED_CARD_FIELD_NAMES)[number];

/**
 * Body of `POST /api/secrets/cards/extract`: FULL, uncropped photos as base64
 * data URLs (downscaled client-side only when very large — see
 * `prepareCardPhoto` in `utils/cardImage.ts`). The model locates the card in
 * each frame and reports where in {@link CardExtractionResult.crops}; the
 * client crops the stored attachment from those boxes afterwards. The full
 * photos go to the AI only — they are never uploaded to storage.
 */
export interface ExtractCardRequest {
  front: string;
  back?: string;
}

/**
 * Where the model found the card in one submitted photo.
 *
 * `x`/`y`/`width`/`height` are fractions (0-1) of the image EXACTLY as it was
 * sent — they apply to the prepared (possibly downscaled) photo, and equally
 * to the raw capture, since fractions survive uniform scaling.
 */
export interface CardCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise 90° rotations (0-3) that make the card upright. */
  quarterTurns: number;
  /** 0-1 confidence that the box tightly bounds a card. */
  confidence: number;
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
  /**
   * Card locations, one per submitted side. A side is `null` when no image
   * was sent for it or no card was visible in the frame.
   */
  crops: {
    front: CardCropBox | null;
    back: CardCropBox | null;
  };
}

export interface SystemSettings {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: Record<string, boolean>;
  /** The platform AI policy plus `cardExtractModel`; `null` only before the first read. */
  ai: VaultAiPolicy | null;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

// Identity wire types (auth providers, allowlist, users, device flow, personal
// access tokens) are the platform's: `@marinoscar/platform-web/identity/headless` (E3.3).

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
export type { AttachmentRole } from '@marinoscar/vault-contract/secrets';

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

/**
 * One card from `GET /api/secrets/cards/summary` (#118): decrypted server-side
 * down to the last four digits and the expiry. Never the CVV or the full
 * number. A malformed card comes back with null fields.
 */
export interface CardSummaryItem {
  id: string;
  name: string;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  /** Issuing network, e.g. 'Visa'; null when not stored. */
  network: string | null;
  /** 'Credit' / 'Debit'; null when not stored. */
  kind: string | null;
  issuingBank: string | null;
  cardholderName: string | null;
  /** True when the current version has card photos attached. */
  hasPhotos: boolean;
  updatedAt: string;
}

/** A page of card summaries, soonest expiry first, unknown expiry last. */
export interface CardSummaryResponse {
  items: CardSummaryItem[];
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

// =============================================================================
// Scheduled Backups (admin)
// =============================================================================

export type {
  BackupFrequency,
  BackupRunStatus,
  BackupRunTrigger,
} from '@marinoscar/vault-contract/backups';

/** Editable fields of the backup schedule (PUT /admin/backups/schedule). */
export interface BackupScheduleFields {
  enabled: boolean;
  frequency: BackupFrequency;
  /** Hourly only: 1, 2, 3, 4, 6, 8 or 12. */
  intervalHours: number | null;
  /** 'HH:mm' wall-clock time in `timezone` (daily, weekly, monthly). */
  timeOfDay: string;
  /** Weekly only: 0-6, 0 = Sunday. */
  dayOfWeek: number | null;
  /** Monthly only: 1-28. */
  dayOfMonth: number | null;
  /** IANA time zone. */
  timezone: string;
  /** How many successful backups to keep (1-365). */
  keepCount: number;
  /** Back up every user's current secret values. */
  includeSecrets: boolean;
  /** Requires includeSecrets. */
  includeAttachments: boolean;
  /** Requires includeSecrets. */
  includeVersions: boolean;
  /** Every user's media library (folders and files). */
  includeMedia: boolean;
  /** Users and roles, allowlist, custom secret types, redacted system settings. */
  includeSystem: boolean;
}

/** GET/PUT /admin/backups/schedule response. Never carries the password. */
export interface BackupSchedule extends BackupScheduleFields {
  passwordConfigured: boolean;
  passwordUpdatedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  storageConfigured: boolean;
  /** Null when no schedule has been saved yet (server defaults). */
  updatedAt: string | null;
}

/**
 * PUT body. `password` is write-only: omit it to keep the stored password,
 * send a 6-256 character string to replace it.
 */
export interface UpdateBackupScheduleRequest extends BackupScheduleFields {
  password?: string;
}

export interface BackupRun {
  id: string;
  status: BackupRunStatus;
  trigger: BackupRunTrigger;
  triggeredBy: { id: string; email: string; displayName: string | null } | null;
  sizeBytes: number | null;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount: number;
  /**
   * Content keys selected for this run: 'secrets', 'attachments',
   * 'versions', 'media', 'system'. Empty for runs from before the choice existed.
   */
  contents: string[];
  warningCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  deletedAt: string | null;
  /** succeeded && !deletedAt */
  downloadable: boolean;
}

export interface BackupRunsResponse {
  items: BackupRun[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BackupDownloadLink {
  url: string;
  expiresAt: string;
  fileName: string;
}

// =============================================================================
// Saved backups (per user) and the admin download
// =============================================================================

/** GET /backups/me/config: whether "Save to the storage account" can be offered. */
export interface MyBackupsConfig {
  storageConfigured: boolean;
  /** How many saved backups are kept per user (newest first). */
  keepCount: number;
}

/**
 * POST /admin/backups/export body. Exactly one of `password` (6-256
 * characters) or `useScheduledPassword: true` is sent.
 */
export interface AdminBackupExportRequest {
  password?: string;
  useScheduledPassword?: boolean;
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
  includeSystem: boolean;
}
