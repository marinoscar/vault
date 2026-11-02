# Local exceptions to the platform

Every place where Vault deviates from `@marinoscar/platform-*` on purpose, and the epic that removes it (or why it is permanent). Introduced by E0 ([#55](https://github.com/marinoscar/vault/issues/55), program epic [#54](https://github.com/marinoscar/vault/issues/54)). An exception without a row here is a bug.

## How to use this page

- **A shim in code** carries the comment `// PLATFORM-ADOPTION-SHIM(<epic or issue>)`. List them with `grep -rn "PLATFORM-ADOPTION-SHIM" apps/api/src apps/web/src`.
- **A deviation in the database** is an entry under `deviations` in `apps/api/prisma/platform.lock` (exists from E2).
- **The PR that removes an exception deletes its row**, together with the marker and any lock deviation or allowlist entry it names.
- A new exception adds a row in the same PR, with the epic or issue that removes it. If none exists, file one. A platform gap is a seam request on marinoscar/EnterpriseAppBase first.

## Temporary exceptions (current, pre-migration)

| Exception | Where | Why | Removed by |
|---|---|---|---|
| In-process backup runner: `@Cron(EVERY_MINUTE)`, detached `launch()`, Postgres advisory locks for the "is a run active" check and per-user serialisation | `apps/api/src/backups/backup-runner.service.ts` | Predates the queue; violates the "every long-running activity is a queue job" rule | **E5**: job types `vault.backup.run` and `vault.user_backup.run` (server-only), advisory locks replaced by queue dedup |
| Tab-based settings UI (`SystemSettingsPage`: UI Settings, Feature Flags, AI, Backups, Advanced (JSON); `UserSettingsPage`) and a flat `Sidebar` | `apps/web/src/pages/`, `components/navigation/` | Predates the registry-driven hub and shell | **E10**: `SettingsHub` cards, destinations, platform `ShellLayout` ([spec](../specs/ux-refresh.md)) |
| Uptrace as the telemetry backend (`otel.compose.yml`, `infra/otel/uptrace.yml`, `UPTRACE_DSN`) | `infra/`, `apps/api/src/instrumentation.ts` | Predates the GreptimeDB-based telemetry slice | **E9** (telemetry) with **E11** (generated infra) |
| `tools/app` generic template CLI and the `tools/vaultcli` binary name `vaultcli` | `tools/` | Predate `createCli`; `tools/app` still says EnterpriseAppBase | **E11**: one `vault` CLI on `@marinoscar/platform-cli`; domain commands as `extraCommands` |
| Hand-edited `schema.prisma`, plain Prisma migrations, API connecting with a role that is not yet proven `NOSUPERUSER NOBYPASSRLS` | `apps/api/prisma/` | Predates composed fragments and RLS | **E2** |
| AI provider key stored in `system_settings.ai` (encrypted with `VAULT_ENCRYPTION_KEY`) and generic AI config/verify code | `apps/api/src/ai/`, `settings` | Predates the credentials and AI slices | **E4** (credentials) and **E8** (AI) |
| Hand-written `infra/` (compose, nginx, `deploy/`) and `.env.example` | `infra/` | Predates `platform-infra` generation | **E11** |
| Node 20, Prisma 5, React 18, MUI 5 | package manifests | Predate the platform's required toolchain | **E1** |
| Domain code lives in `apps/api/src` and `apps/web/src`, not packages | secrets, secret-types, backups, media, card extraction | Packages-first applies once the platform slices are adopted | **E12** |

## Permanent divergences

| Divergence | Where | Why it stays |
|---|---|---|
| **`VAULT_ENCRYPTION_KEY` is an app-owned key for secret ciphertext** (AES-256-GCM via `CryptoService`), separate from the platform's `SECRETS_ENCRYPTION_KEY` that encrypts runtime-configured credentials | `apps/api/src/common/services/crypto.service.ts`; `secret_versions`, the scheduled-backup password | Live production data is encrypted under it. Changing or rotating it without a rehearsed migration makes every secret unreadable. Both keys coexist after E4; the platform never sees secret values |
| **Export endpoints return a raw streamed zip, not the `{ data }` envelope** | `POST /api/secrets/export`, `POST /api/admin/backups/export` (headers `X-Vault-Export-*`) | A browser/CLI download of an encrypted archive, audited as `secrets.export` / `backups.export`. They must bypass the host envelope and any platform response wrapper |
| **Logical secret backups are not the platform `db-backup`** | `apps/api/src/backups/` | They produce password-protected AES-256 zips of secrets (with optional versions, attachments, media), not `pg_dump` archives. E9 adds the platform `db-backup` slice alongside; both coexist, with distinct storage prefixes (`user-backups/<userId>/` for My backups) |
| **Raw-SQL partial unique index `secret_versions_current_unique`** (one current version per secret) | `20260403120000_add_secrets_and_versions` | Intentional drift; listed in the raw-SQL index list from E2 |
| **System secret types are read-only code-seeded data** | `apps/api/prisma/system-secret-types.ts` | Domain rule independent of the platform |
| **Card extraction rules**: CVV never requested, nothing persisted, daily budget from `audit_events` | `apps/api/src/ai/card-extract.*` | Domain privacy rule; stays when AI moves to `AiService.forUser` |
| **Domain permission strings** (`secrets:*`, `secret_types:*`, `media:*`; `*_any` Admin only) | `apps/api/src/common/constants/roles.constants.ts` | Registered through the app's permission manifest; names are persisted in role seeds and tokens |

## Drift allowlist

None yet. From E2, intentional drift entries (the raw-SQL index above and any `RLS_POLICIES` deviation) are recorded in `apps/api/prisma/platform.lock` and listed here.
