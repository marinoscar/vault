// =============================================================================
// Vault's application metrics (issue #90, E9.2)
// =============================================================================
//
// The `app.vault.*` instruments, declared once and registered at import time by
// `./app-metric.manifest.ts` (so a name or key clash names this file). Emitted
// through `VaultMetricsService`; charted by the `vault` dashboard group
// (`app-registrations/telemetry.ts`).
//
// LABELS ARE LOW-CARDINALITY ENUMS AND NOTHING ELSE. A metric label becomes a
// column of an exported table that anyone with `telemetry:query` can read, so:
//
//   * no user id, email, organization id, secret id, secret NAME, secret-type
//     name, file name, storage key or backup archive name, ever;
//   * every attribute is `{ kind: 'enum' }`: a value outside the list is exported
//     as `other`, never as itself, so a bug that passes an identifier cannot leak it;
//   * a custom secret type (admin-chosen name) is the single value `custom`.
//
// `test/telemetry/vault-metrics-labels.spec.ts` pins all of it.
// =============================================================================

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

/** System secret types (`prisma/system-secret-types.ts`); every other type is `custom`. */
export const SECRET_TYPE_KINDS = ['credential', 'api_key', 'card', 'token', 'note', 'document', 'custom'] as const;
export type SecretTypeKind = (typeof SECRET_TYPE_KINDS)[number];

/** Why a secret version was minted. */
export const SECRET_VERSION_SOURCES = ['create', 'update', 'rollback', 'renew'] as const;
export type SecretVersionSource = (typeof SECRET_VERSION_SOURCES)[number];

export const BACKUP_SCOPES = ['system', 'user'] as const;
export const BACKUP_TRIGGERS = ['schedule', 'manual'] as const;
export const BACKUP_OUTCOMES = ['succeeded', 'failed'] as const;

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

const oneOf = (...values: readonly string[]) => ({ kind: 'enum' as const, values });

/** Backup run duration buckets, seconds: a small vault dumps in seconds, a large one in minutes. */
export const BACKUP_DURATION_BUCKETS_S = [1, 5, 15, 30, 60, 120, 300, 600, 1800] as const;

export const VAULT_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: 'vaultSecretsCreated',
    name: 'app.vault.secrets.created',
    kind: 'counter',
    unit: '{secret}',
    description: 'Secrets created, by secret type kind (system type or custom).',
    attributes: { type_kind: oneOf(...SECRET_TYPE_KINDS) },
  },
  {
    key: 'vaultSecretVersionsCreated',
    name: 'app.vault.secret_versions.created',
    kind: 'counter',
    unit: '{version}',
    description: 'Secret versions minted, by what caused them (create, update, rollback, renew).',
    attributes: { source: oneOf(...SECRET_VERSION_SOURCES) },
  },
  {
    key: 'vaultBackupRuns',
    name: 'app.vault.backups.runs',
    kind: 'counter',
    unit: '{run}',
    description: 'Logical backup runs that finished, by scope, trigger and outcome.',
    attributes: { scope: oneOf(...BACKUP_SCOPES), trigger: oneOf(...BACKUP_TRIGGERS), outcome: oneOf(...BACKUP_OUTCOMES) },
  },
  {
    key: 'vaultBackupDuration',
    name: 'app.vault.backups.duration',
    kind: 'histogram',
    unit: 's',
    description: 'Run time of one logical backup, from start to settlement.',
    buckets: BACKUP_DURATION_BUCKETS_S,
    attributes: { scope: oneOf(...BACKUP_SCOPES), trigger: oneOf(...BACKUP_TRIGGERS), outcome: oneOf(...BACKUP_OUTCOMES) },
  },
  {
    key: 'vaultCardExtractions',
    name: 'app.vault.cards.extractions',
    kind: 'counter',
    unit: '{extraction}',
    description: 'Card-photo extractions requested, by outcome. Never records the card, its numbers or the user.',
    attributes: { outcome: oneOf(...CARD_EXTRACTION_OUTCOMES) },
  },
];

declare module '@marinoscar/platform-api/otel-core' {
  interface AppMetricKeys {
    vaultSecretsCreated: true;
    vaultSecretVersionsCreated: true;
    vaultBackupRuns: true;
    vaultBackupDuration: true;
    vaultCardExtractions: true;
  }
}

/**
 * The `type_kind` label for a secret type: a system type's well-known kind, else
 * `custom`. Takes the type row's `isSystem` and `name`; the NAME of a custom type
 * is never returned.
 */
export function secretTypeKind(type: { isSystem: boolean; name: string } | null | undefined): SecretTypeKind {
  if (!type?.isSystem) return 'custom';
  const kind = type.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return (SECRET_TYPE_KINDS as readonly string[]).includes(kind) && kind !== 'custom' ? (kind as SecretTypeKind) : 'custom';
}
