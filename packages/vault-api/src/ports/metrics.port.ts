import type { BackupOutcome, BackupScope, BackupTrigger, SecretTypeKind, SecretVersionSource } from '../core/metric-labels';

/**
 * VAULT_METRICS: Vault's `app.vault.*` instruments. Optional: a slice emits through `?.` so a host
 * without telemetry binds nothing. Labels are low-cardinality enums only (never an id, a name, a key).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_METRICS = Symbol.for('@marinoscar/vault/VAULT_METRICS');

/**
 * The metrics port.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface VaultMetricsPort {
  /** A secret was created, by type kind. */
  secretCreated(typeKind: SecretTypeKind): void;
  /** A secret version was minted, by source. */
  secretVersionCreated(source: SecretVersionSource): void;
  /** A backup run settled. */
  backupFinished(run: { scope: BackupScope; trigger: BackupTrigger; outcome: BackupOutcome; durationMs: number }): void;
  /** A card scan ended, by outcome. */
  cardExtracted(outcome: string): void;
}
