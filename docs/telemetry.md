# Vault telemetry

Where to look in development, and what Vault adds on top of the platform telemetry slice (`@marinoscar/platform-api/telemetry`, GreptimeDB). Design and operations of the slice itself: [runbooks/telemetry.md](runbooks/telemetry.md) and the platform spec `docs/specs/telemetry.md` in EnterpriseAppBase. Introduced by E9.2 ([#90](https://github.com/marinoscar/vault/issues/90)); it replaced Uptrace.

## The two switches

| Switch | Where | Effect |
|---|---|---|
| `OTEL_ENABLED` | environment (set by `telemetry.compose.yml`) | installs the OpenTelemetry SDK at process start |
| `telemetry.enabled` | `/admin/settings/telemetry` (system setting) | opens the export gate at runtime; closed by default |

The GreptimeDB connection is also a runtime setting (host, port, database, reader and admin passwords in the credential store). `GREPTIME_*` is only the deployment default for the first connection. `STACK_AGENT_URL`/`STACK_AGENT_TOKEN` let the page start the containers on a VPS.

## Looking at it in development

1. Start the stack with `-f telemetry.compose.yml` ([DEVELOPMENT.md](DEVELOPMENT.md#observability)).
2. Sign in as an administrator, open **Admin > Telemetry**, switch telemetry on.
3. Use the API for a minute, then open the **Dashboard** (platform groups plus `Vault activity`) or the **Explorer** (guarded SQL over `opentelemetry_traces`, `opentelemetry_logs` and the `app_*` metric tables).
4. GreptimeDB's own SQL dashboard: http://localhost:14000/dashboard.

## Vault's metrics

Declared in `apps/api/src/common/otel/vault-metrics.ts`; the table name is the metric name with dots as `_` plus `_total` (counters) or `_seconds_bucket` (histograms in seconds).

| Metric | Labels | Emitted by |
|---|---|---|
| `app.vault.secrets.created` | `type_kind` | `SecretsService.create` |
| `app.vault.secret_versions.created` | `source` (`create`, `update`, `rollback`, `renew`) | `SecretsService` |
| `app.vault.backups.runs` | `scope`, `trigger`, `outcome` | `BackupRunnerService` (every settle point, after the run row commits) |
| `app.vault.backups.duration` (s) | `scope`, `trigger`, `outcome` | `BackupRunnerService` |
| `app.vault.cards.extractions` | `outcome` | `CardExtractService.extract` (one count per request) |

The platform also emits its own `app.backup.*`, `app.jobs.*`, `app.auth.*` and `app.ai.*` metrics.

## Label rule (no PII)

Every Vault attribute is an `enum` with a closed value list; a value outside the list is exported as `other`. No label ever carries a user id, email, organization id, secret id or name, secret-type name, file name, storage key or archive name. A custom secret type is the single value `custom`. `apps/api/test/telemetry/vault-metrics-labels.spec.ts` enforces it for every `app.vault.*` metric; add a metric there when you add one.
