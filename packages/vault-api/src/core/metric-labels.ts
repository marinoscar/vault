// =============================================================================
// The label vocabulary of Vault's `app.vault.*` metrics
// =============================================================================
//
// Low-cardinality enums and nothing else: the package emits through `VaultMetricsPort`, the host
// declares the instruments (`common/otel/vault-metrics.ts`) from these lists. A value outside a
// list is exported as `other`, never as itself.
// =============================================================================

/** System secret types; every other type is `custom`. */
export const SECRET_TYPE_KINDS = ['credential', 'api_key', 'card', 'token', 'note', 'document', 'custom'] as const;
export type SecretTypeKind = (typeof SECRET_TYPE_KINDS)[number];

/** Why a secret version was minted. */
export const SECRET_VERSION_SOURCES = ['create', 'update', 'rollback', 'renew'] as const;
export type SecretVersionSource = (typeof SECRET_VERSION_SOURCES)[number];

export const BACKUP_SCOPES = ['system', 'user'] as const;
export const BACKUP_TRIGGERS = ['schedule', 'manual'] as const;
export const BACKUP_OUTCOMES = ['succeeded', 'failed'] as const;
export type BackupScope = (typeof BACKUP_SCOPES)[number];
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];
export type BackupOutcome = (typeof BACKUP_OUTCOMES)[number];

/** How a card scan ended (mirrors `AI_ERROR_CODES` of the card-extraction path). */
export const CARD_EXTRACTION_OUTCOMES = [
  'succeeded',
  'failed',
  'invalid_image',
  'not_configured',
  'rate_limited',
  'quota_exceeded',
  'upstream_error',
] as const;

/** The metric label of a secret type: the system type's kind, or `custom`. */
export function secretTypeKind(type: { isSystem: boolean; name: string } | null | undefined): SecretTypeKind {
  if (!type?.isSystem) return 'custom';
  const kind = type.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return (SECRET_TYPE_KINDS as readonly string[]).includes(kind) && kind !== 'custom' ? (kind as SecretTypeKind) : 'custom';
}
