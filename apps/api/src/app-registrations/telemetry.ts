// =============================================================================
// Vault's telemetry registrations (issue #90, E9.2, epic #54)
// =============================================================================
//
//   VAULT_METRIC_GROUPS  the `vault` Telemetry Dashboard group, passed to
//                        `TelemetryModule.forRoot({ metricGroups })`
//                        (`platform/telemetry/telemetry.config.ts`). A family is
//                        skipped, never an error, while its table does not exist
//                        (a fresh stack shows "no data yet").
//   VAULT_APP_METRICS    the `app.vault.*` instruments (`common/otel/vault-metrics.ts`).
//
// Table names follow docs/specs/telemetry.md section 11.13 of EnterpriseAppBase: dots
// become `_`, a counter gains `_total`, a histogram in seconds gains `_seconds_bucket`.
// Pure data: no Nest, no service import.
// =============================================================================

import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry';

export { VAULT_APP_METRICS } from '../common/otel/vault-metrics';

declare module '@marinoscar/platform-api/telemetry' {
  interface MetricGroupIds {
    /** Vault's secrets, backups and card-scan counters. */
    vault: true;
  }
}

const FILTERS = ['service', 'instance'] as const;

export const VAULT_METRIC_GROUP: MetricGroupDef = {
  id: 'vault',
  label: 'Vault',
  title: 'Vault activity',
  // The platform's six groups use 10 to 60.
  order: 70,
  description: 'secrets and versions created, backup runs and duration, card-photo extractions by outcome',
  families: [
    {
      key: 'vaultSecretsCreated',
      group: 'vault',
      label: 'Secrets created',
      table: 'app_vault_secrets_created_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'type_kind',
      requiredColumns: ['type_kind'],
      filters: FILTERS,
    },
    {
      key: 'vaultSecretVersionsCreated',
      group: 'vault',
      label: 'Secret versions',
      table: 'app_vault_secret_versions_created_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'source',
      requiredColumns: ['source'],
      filters: FILTERS,
    },
    {
      key: 'vaultBackupRuns',
      group: 'vault',
      label: 'Backup runs',
      table: 'app_vault_backups_runs_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'outcome',
      requiredColumns: ['outcome'],
      filters: FILTERS,
    },
    {
      key: 'vaultBackupDurationP95',
      group: 'vault',
      label: 'Backup duration p95',
      table: 'app_vault_backups_duration_seconds_bucket',
      kind: 'histogram',
      unit: 'seconds',
      quantile: 0.95,
      requiredColumns: ['le'],
      filters: FILTERS,
      series: false,
    },
    {
      key: 'vaultCardExtractions',
      group: 'vault',
      label: 'Card extractions',
      table: 'app_vault_cards_extractions_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'outcome',
      requiredColumns: ['outcome'],
      filters: FILTERS,
    },
  ],
};

/** Vault's own Telemetry Dashboard groups. */
export const VAULT_METRIC_GROUPS: readonly MetricGroupDef[] = [VAULT_METRIC_GROUP];
