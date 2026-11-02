# Module classification

Baseline classification of every Vault module against EnterpriseAppBase (EAB) and its `@marinoscar/platform-*` packages. Input: the generated [drift-baseline.md](drift-baseline.md); final state in [drift-final.md](drift-final.md). Part of the platform migration program, epic [#54](https://github.com/marinoscar/vault/issues/54); written by E0 ([#55](https://github.com/marinoscar/vault/issues/55)).

| Field | Value |
|---|---|
| EAB commit | `59e377cbebb60e711fe4d7b0d818715f23af8a59` |
| Vault commit | `1b2074d` |
| Date | 2026-11-02 |

**Final state (E11.3, [#101](https://github.com/marinoscar/vault/issues/101)).** All twelve epics are merged; this page is closed out against [drift-final.md](drift-final.md) (Vault `9003110`). Every row now ends in one of: **adopted slice** (Vault code deleted, platform serves it), **moved to a `vault-*` package** (domain, E12), **host binding** (stays in `apps/`: a `forRoot` option, registration or glue), or **permanent divergence** ([local-exceptions](local-exceptions.md#permanent-divergences)). Rows that still read "E3" or "E10" as a plan are done; the summary:

| Final status | Rows |
|---|---|
| Adopted slice, Vault code deleted | API: auth, users, allowlist, pat, device-auth, health, storage, generic ai, jobs and nodes, email and notifications, db-backup. Web: identity UI, device activation, PAT UI, tab settings (now `SettingsHub`). CLI: `tools/app`, `tools/vaultcli` core. Infra: compose, nginx, otel (generated), Uptrace (deleted) |
| Moved to a `vault-*` package (E12) | `secrets`, `secret-types`, `backups`, `media`, card extraction, card-expiry reminders; their pages, hooks and brand; wire schemas and error codes (`vault-contract`); fragments and migrations (`vault-db`) |
| Host binding (stays in `apps/`) | `app.module.ts`, `main.ts`, `platform/*` bindings, `app-registrations/*`, Doctor checks and export, onboarding and user-data glue, `apps/web` shell, destinations, registries and theme, `apps/cli` `src/vault/` |
| Permanent divergence | `crypto.service.ts` (`VAULT_ENCRYPTION_KEY`), raw-zip export endpoints, logical secret backups beside `db-backup`, `secret_versions_current_unique`, system secret types, card CVV rules, domain permission strings, single-organization scope |
| Open (temporary) | Legacy `infra/deploy/`, `nginx.prod.conf`, `scripts/dev.ps1` ([follow-up D](local-exceptions.md#status-at-close-out-e113-101)); `useUserSettings` profile shim |

**Categories** (details in [README.md](README.md#categories)): **noise** (package replaces it; delete), **backport** (Vault has something the platform lacks; re-express on top of the package), **domain** (stays in `apps/` until E12, then `@marinoscar/vault-*`), **vault-divergence** (kept on purpose; see [local-exceptions.md](local-exceptions.md)).

**Reading the baseline.** Vault forked a very old EAB, so the apps-view drift is near total (api 0% identical, web 4%, prisma 6%; 246 app-only API files). The pairings below were made by reading the code, not from the percentages. Target slice names are EAB slices; epics are E0 to E12 from the [README](README.md#epic-order-program-54). Verify each row against the code when its epic starts; this is a plan, not a guarantee.

## API modules (`apps/api/src`)

| Module | Files | Category | Target slice or package | Epic | Notes and workaround |
|---|---|---|---|---|---|
| `auth` (Google OAuth, JWT, refresh, guards, strategies, `token-cleanup.task`) | 28 | noise | platform `identity` | E3 | Platform sign-in, sessions, refresh rotation. Re-bind the Google provider through `registerAuthProvider`; keep cookie and token lifetimes (15 min / 14 days) **Done in E3.2 (#77): deleted, served by `IdentityModule.forRoot` (`apps/api/src/platform/identity/`).** |
| `users` | 11 | noise | `identity` users | E3 | **Done in E3.2 (#77): deleted, served by `IdentityModule.forRoot` (`apps/api/src/platform/identity/`).** |
| `allowlist` | 8 | noise | `identity` allowlist | E3 | `INITIAL_ADMIN_EMAIL` bypass and claimed-entry rule must survive **Done in E3.2 (#77): deleted, served by `IdentityModule.forRoot` (`apps/api/src/platform/identity/`).** |
| `pat` (personal access tokens) | 8 | noise | `identity` PATs | E3 | Existing token hashes must stay valid: verify hash format in the E2/E3 rehearsal **Done in E3.2 (#77): deleted, served by `IdentityModule.forRoot` (`apps/api/src/platform/identity/`).** |
| `device-auth` (RFC 8628) | 16 | noise | `identity` device flow | E3 | `vaultcli` login depends on it; test against the new CLI in E11 **Done in E3.2 (#77): deleted, served by `IdentityModule.forRoot` (`apps/api/src/platform/identity/`).** |
| `test-auth` (`/api/auth/test/login`) | 7 | noise | app test-login binding | E3 | Mock OAuth for CI; keep or replace with the platform's test helpers **Done in E3.2 (#77): deleted, served by `IdentityModule.forRoot` (`apps/api/src/platform/identity/`).** |
| Jobs and nodes (new in E5.1, #81) | 3 | noise | platform `jobs` + `nodes` | E5 (done: E5.1) | `platform/jobs/` binds `JobsModule.forRoot` / `NodesModule.forRoot` and the host ports; `app-registrations/jobs.ts`. `IDENTITY_JOBS` is `platform/identity/identity-jobs.adapter.ts`. `ai/ai-burst-limiter.service.ts` lost its `@Interval` (lazy pruning on `consume`, E5.3 #83) |
| Email and notifications (new in E7.1, #85) | 2 | noise | platform `email` + `notifications` | E7 (done: E7.1 API; web in a follow-up) | `platform/email/` (options: Vault teal `THEME_COLOR`, logo `assets/email/logo.png`) and `platform/notifications/` (host ports, the manifest) bind `EmailModule.forRoot`, `NotificationsModule.forRoot` and `BroadcastsModule`; `notifications-registry/identity.notifications.ts` owns the three identity events; `IDENTITY_NOTIFIER` is `platform/identity/identity-notifier.adapter.ts`. Vault's own events (`notifications-registry/vault.notifications.ts`: backup result, card expiring) and templates (`email-templates/`) are E7.2 (#86); the backup notifier is `backups/backup-notifier.service.ts`, the card expiry scan `card-expiry/` |
| `health` | 5 | noise | `host` health controller | E3 | **Done in E3.1 (#76)**: deleted; `/api/health`, `/live` and `/ready` are the platform's, pinned by `test/health/health.integration.spec.ts` |
| `settings` (`system-settings`, `user-settings`) | 13 | backport | `settings` registries | E4 (done: E4.1, #79) | Vault stores an `ai` block (enabled, model, daily budget, encrypted key) in `system_settings` and UI/feature-flag JSON; are namespace registrations (`ui`, `features`, `ai`, plus `vaultCards`, `vaultBackups`; `app-registrations/settings.ts`); the platform controllers serve `/api/system-settings`, `/api/user-settings`, `/api/org-settings`. The encrypted key moved to the credentials store in E4.2 (`vault:migrate-ai-key`); the `ai` namespace IS the platform AI slice's since E8.1 (extended with `cardExtractModel`; `vault:migrate-ai-platform` rewrites the old block) |
| `common/services/crypto.service.ts` | 1 | vault-divergence | app-owned; platform `credentials` for runtime keys | E4 | **Permanent** for secret ciphertext: `VAULT_ENCRYPTION_KEY`, AES-256-GCM. See local-exceptions |
| `common` (filters, interceptors, logger, middleware, decorators, constants, schemas, types, `admin-bootstrap.service`) | 25 | noise | `host`, `core`, `otel-core` | E3 | `common/constants/card.constants.ts` and card-related pieces are domain and stay. **Done in E3.1 (#76)**: the filter, the transform and logging interceptors and the request-id middleware are deleted (the host core provides them); the two raw-zip exports use `@Res()` + `reply.send`. Still local: `logger`, `crypto.service`, `admin-bootstrap.service`, constants, `schemas`, `types` |
| `config` | 1 | noise | host/app config | E3 | Env schema re-expressed; `VAULT_ENCRYPTION_KEY` stays required |
| `prisma` (service) | 2 | noise | `platform-db` + `PrismaService` | E2 | Plus `forOrg`/`runInOrg` for RLS |
| `storage` (objects, S3 provider, processing, cleanup task) | 25 | noise | `storage` | E6 (done, E6.1 #84) | **Deleted**: the objects API, the S3 provider, the processing pipeline and the cleanup task are the platform's `StorageModule`, bound in `apps/api/src/platform/storage/` (`StorageModule.forRoot`, `StorageConfigModule`, the key-prefix manifest with Vault's `system-backups/` and `user-backups/`). The stale-upload sweep is the platform's enqueue-only cron and job and the post-upload processing its `storage.object.process` job, so both queue-rule exemptions are gone. Org-aware (RLS); existing objects are read by their stored `storage_key`. The S3 settings moved from env vars to the runtime `storage` namespace plus the encrypted `storage/default` credential, with a one-time import (`npm run vault:migrate-storage-config`, a boot-time import and a Doctor warning: [runbook](../runbooks/storage-config-migration.md)). The admin `Storage` card is the web follow-up |
| `secrets` (+ `export/`) | 26 | domain | `@marinoscar/vault-api` (E12) | **moved in E12.2 (#103)** to `packages/vault-api/src/secrets`; touched E2 (RLS/org), E5, E9 | Versions, attachments, renew, rollback, export zip, HTML/README renderers. Raw-zip export response is permanent |
| `secret-types` | 9 | domain | vault-api | **moved in E12.2 (#103)**; E12 | System types seeded read-only; definitions and schemas are `vault-contract` since E12.1 (`prisma/system-secret-types.ts` re-exports) |
| `backups` (admin + my-backups, `backup-runner.service`, retention, schedule, archive, password) | 28 | domain | vault-api; jobs `vault.backup.run`, `vault.user_backup.run` | E5; **moved in E12.2 (#103)** to `packages/vault-api/src/backups` | Backups run as the server-only queue jobs `vault.backup.run` and `vault.user_backup.run` since E5.2 (#82): an enqueue-only schedule tick, queue dedup instead of advisory locks, `BackupArchiveService` for the streaming archive build. Not the same as platform `db-backup` (pg_dump): these are logical encrypted zips of secrets. The platform `db-backup` slice (whole-database `pg_dump`, E9.1 #89) sits beside them: `platform/db-backup/`, `db_backup:*` admin-only, the `database-backups/` prefix, `DEPLOYMENT_MODE` for restore; see [SECRETS.md](../SECRETS.md#whole-database-backup-versus-encrypted-secret-backups) and the [restore runbook](../runbooks/database-restore.md). **E9.3 (#91)**: `export` of the platform is metadata only (`vault-secrets` source); a user-data deletion removes saved backups through `vault.user_data.purge`; the factory reset adds the steps `vault.backups` and `vault.secret-types` |
| Database backup and restore (new in E9.1, #89) | 2 | noise | platform `db-backup` | E9 (done: E9.1 API and web) | `platform/db-backup/db-backup.config.ts` (`DbBackupModule.forRoot`, defaults documented in its header), `db-backup-host.module.ts` (notifier, maintenance, metrics, deployment mode, the bypass client for the Doctor), `app-registrations/db-backup.ts` (NO restore carry-over, with the reasons), the `databaseBackup` namespace in `settings/registry/system-settings.manifest.ts`, `db-backup` in the permission slices, `database-backups/` in the key-prefix manifest, `notifications-registry/db-backup.notifications.ts`; the page is `pages/admin/DbBackupSettingsPage.tsx`. No migration (the platform tables were installed in E2). The API image gains `postgresql17-client` |
| `media` (folders and files) | 9 | domain | vault-api | **moved in E12.2 (#103)**; E12 | Files via the platform `storage` slice (E6.1); deletes and downloads go through the platform `ObjectsService` |
| `ai` generic (config, verify, burst limiter, OpenAI chat client/probe, `ai.controller` status) | ~12 | noise | `ai` slice (`AiModule.forRoot`) | E8 (done: E8.1, #87) | Deleted. The deployment key stays at credential `('ai','openai')`; `/api/ai/status` was a thin alias of `GET /api/ai/config` and is retired (#157); verify is the slice's `POST /api/admin/ai/...` provider test |
| `ai` card extraction (`card-extract.*`, `card-normalizer`, the prompt and model schema in `card-extraction.schema.ts`) | ~8 | domain | vault-api, calling `AiService.forUser(userId, { orgId, feature: 'card_extract' })` through the `VAULT_AI` port | E8 (done: E8.1, #87); **moved in E12.2 (#103)** to `packages/vault-api/src/ai` (the two one-off migration commands stay in `apps/api/src/ai`) | Kept. `openai-card-schema` became a Zod model schema + prompt and `openai-vision.provider` was deleted (the platform adapter replaces it). CVV never requested (the normalizer strips it), nothing persisted, the daily budget is the platform cap `ai.limits.perUser.requestsPerDay`. Feature id is `card_extract` (the platform refuses a hyphen) |
| `app.module.ts`, `main.ts`, `instrumentation.ts` | 3 | noise | `platform/` bindings, `host` | E3 | `instrumentation.ts` (OTEL to Uptrace) became `otel-core` in E9.2 (#90); telemetry store change is E9 |

## Web areas (`apps/web/src`)

| Area | Category | Target | Epic | Notes |
|---|---|---|---|---|
| `contexts/AuthContext`, `components/auth`, `LoginPage`, `AuthCallbackPage`, `ProtectedRoute`, `RequirePermission`, `hooks/usePermissions` | noise | `@marinoscar/platform-web/identity` | E3 | Brand mark goes in the `Logo` slot **Done in E3.3 (#78): deleted, replaced by `@marinoscar/platform-web/identity` (headless + ui), bound in `apps/web/src/identity/`.** |
| `components/device-activation`, `ActivateDevicePage` | noise | identity UI | E3 | **Done in E3.3 (#78): deleted, replaced by `@marinoscar/platform-web/identity` (headless + ui), bound in `apps/web/src/identity/`.** |
| `UserManagementPage`, `components/admin` (`UserList`, `AllowlistTable`, `AddEmailDialog`) | noise | identity `UsersPage` (Users + Allowlist tabs) | E3 | **Done in E3.3 (#78): deleted, replaced by `@marinoscar/platform-web/identity` (headless + ui), bound in `apps/web/src/identity/`.** |
| `SystemSettingsPage` (tabs), `UserSettingsPage`, `components/admin/{SystemSettingsEditor,UISettings,FeatureFlagsList}` | noise | registry-driven `SettingsHub` | E10 | **Done in E10.3 (#94)**: tabs gone, "Advanced (JSON)" dropped |
| `components/settings/{ProfileSettings,ThemeSettings,ImageUpload}` | host binding | platform Appearance page; `ProfileSettings` kept in `vault-web` | E4 / E10 | Open: the profile shim goes when the platform `UserProfilePage` replaces `ProfileSettings` ([local-exceptions](local-exceptions.md#status-at-close-out-e113-101)) |
| `components/settings/{PersonalAccessTokens,CreatePatDialog,PatTokenRevealDialog}` | noise | identity PAT UI | E3 / E10 | **Done in E3.3 (#78): deleted, replaced by `@marinoscar/platform-web/identity` (headless + ui), bound in `apps/web/src/identity/`.** |
| `components/settings/{AiSettings}` | noise | platform AI pages | E8 / E10 | **Done in E8.1 (#87)**: packaged AI admin pages |
| `components/settings/{DataBackup,BackupContentsGroup,BackupPasswordFields,BackupRunsTable}`, `components/admin/{ScheduledBackups,AdminBackupDownloadDialog}`, `utils/{backupContents,backupPassword,backupSchedule}` | domain | vault-web; become settings cards "My backups" and "Backups" | E10 / E12 | **Moved to `@marinoscar/vault-web` in E12.3 (#104).** |
| `components/navigation` (`Sidebar`, `AppBar`, `UserMenu`), `components/common/Layout.tsx` | vault-divergence | platform `ShellLayout` + `ShellNavigation` | E10 | **Done in E10.1/E10.2 (#115)**: flat sidebar replaced by destinations; `Layout.tsx` is a binding |
| `theme/` (`light`, `dark`, `components`) | backport | `createShellTheme` with Vault brand tokens | E10 | Tokens in [ux-refresh](../specs/ux-refresh.md#5-brand-tokens) |
| `pages/{SecretsPage,SecretDetailPage,CreateSecretPage,EditSecretPage}`, `components/secrets`, `hooks/{useSecrets,useSecretDetail}` | domain | vault-web; list on `platform-web/datatable` | E10 / E12 | **Moved to `@marinoscar/vault-web` in E12.3 (#104).** |
| `pages/{SecretTypesPage,CreateSecretTypePage,EditSecretTypePage}`, `components/secret-types`, `hooks/useSecretTypes` | domain | vault-web | E12 | Candidate settings card "Secret types" **Moved to `@marinoscar/vault-web` in E12.3 (#104).** |
| `pages/{CardsPage,ImportCardPage,RenewCardPage}`, `components/cards`, `hooks/{useCards,useCardImport,useCardRenewal,useAiStatus}`, `utils/{cardExpiry,cardFormat,cardImage}` | domain | vault-web | E8 / E10 / E12 | **Moved to `@marinoscar/vault-web` in E12.3 (#104).** |
| `pages/Media*`, `pages/{CreateFolderPage,EditFolderPage,RenameMediaFilePage}`, `components/media`, `hooks/{useMediaFiles,useMediaFolders}` | domain | vault-web | E12 | **Moved to `@marinoscar/vault-web` in E12.3 (#104).** |
| `pages/HomePage`, `components/home/*` | domain | Home dashboard on shell | E10 / E12 | **Done in E10.6 (#117)**; moved to `@marinoscar/vault-web` in E12.3 |
| `hooks/{useSystemSettings,useUserSettings,useAllowlist,useUsers,usePersonalAccessTokens}` | noise | platform hooks | E3 / E4 | Done except `useUserSettings`, kept in `vault-web` with its profile shim |
| `services/api.ts` | backport | `createPlatformApiClient` + domain endpoint functions | E3 | Raw-zip downloads use `saveBlob`; keep outside the envelope parser |
| `utils/{clipboard,saveBlob}`, `hooks/useCopyToClipboard` | domain | vault-web | stays | **Moved to `@marinoscar/vault-web` in E12.3 (#104).** |
| `__tests__/` | domain | stay; platform conformance added | E11 | Vitest already |

## CLIs (`tools/`)

| Tool | Category | Target | Epic | Notes |
|---|---|---|---|---|
| `tools/app` (`@vault/cli`, generic template CLI: allowlist, auth, config, docker, health, prisma, settings, storage, sync, test, users) | noise | `@marinoscar/platform-cli` `createCli` commands | E11 | Deleted in E11.1 (#99) |
| `tools/vaultcli` core (`auth`, `config`, `health`, TUI plumbing) | noise | platform-cli `login`, `config`, `api` | E11 | Done in E11.1 (#99): `vault login`/`config`/`auth`; `~/.config/vaultcli` files are still read, [migration table](../../apps/cli/README.md#migrating-from-vaultcli) |
| `tools/vaultcli` domain (`secrets`, `versions`, `backup`, `admin-backups`, `sync`, `types`, interactive menus) | domain | `extraCommands` of the `vault` CLI | E11 | Done in E11.1 (#99): `apps/cli/src/vault/` |
| `tools/vaultcli/install.sh` (now `apps/cli/install.sh`), `infra/deploy/*` | open (legacy) | `vault deploy` pipeline | E11 | `vault deploy` replaces `infra/deploy/install-vault.sh`, `update.sh`, `vault.conf`, `DEPLOY.md`; the files are still shipped and deprecated (follow-up D) |

## Prisma models (composed from `@marinoscar/platform-db` plus `apps/api/prisma/fragments/`)

| Model(s) | Category | Target | Epic | Notes |
|---|---|---|---|---|
| `User`, `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole` | noise (with divergence) | identity fragment | E2 / E3 | Vault roles `admin`, `contributor`, `viewer` and permission strings map onto system role + org roles; Vault's domain permissions (`secrets:*`, `secret_types:*`, `media:*`, `storage:*`) are registered by the app. `*_any` permissions stay Admin only |
| `RefreshToken`, `PersonalAccessToken`, `AllowedEmail`, `DeviceCode` | noise | identity fragment | E2 / E3 | |
| `SystemSettings`, `UserSettings` | noise | settings fragment | E2 / E4 | JSONB shapes reconciled; `ai` block migrates |
| `AuditEvent` | noise (verify) | platform audit/host model | E3 | Also backs the AI daily budget (`ai.card.extract`) and `secrets.export`/`backups.export`; keep action names |
| `StorageObject`, `StorageObjectChunk` | noise | storage fragment (org-owned, RLS) | E2 / E6 (done) | `org_id` backfilled; served by the platform storage slice since E6.1 |
| `MediaFolder` | domain | `vault-db` fragment `vault.media.prisma` | E2 / E12.1 | |
| `SecretType`, `Secret`, `SecretVersion`, `SecretAttachment` | domain | `vault-db` fragment `vault.secrets.prisma` | E2 / E12.1 | `secret_versions_current_unique` partial index goes in the raw-SQL index list; `secret_attachments` carries `org_id` with the composite FK to `storage_objects` (E6.2) |
| `BackupSchedule`, `BackupRun` | domain | `vault-db` fragment `vault.backups.prisma` | E2 / E5 / E12.1 | Active-run uniqueness moves to the job dedup index |
| Enums `PatDurationUnit`, `DeviceCodeStatus`, `StorageObjectStatus` | noise | identity / storage fragments | E2 | |

## Migrations (`apps/api/prisma/migrations`)

| Migration | Category | Treatment |
|---|---|---|
| `20260124223146_initial` | noise (platform equivalent) | Baselined (E2.2): byte-identical to platform `0001`; mapped by hash, already in the ledger |
| `20260329151231_add_personal_access_tokens` | noise | Baselined (E2.2): byte-identical to platform `0002` |
| `20260403120000_add_secrets_and_versions` | domain | Stays as an installed app migration; its partial index is declared in the raw-SQL list |
| `20260403235813_add_media_folders` | domain | Stays |
| `20260404000000_add_secret_name_user_unique` | domain | Stays |
| `20260727120000_version_scoped_attachments` | domain | Stays |
| `20261102120000_add_backup_schedules` | domain | Stays |

Installed migrations are never edited or renamed. Since E12.1 the eight app-owned ones (everything here that is not `platform:` in `platform.lock`) are also carried byte for byte by `@marinoscar/vault-db` and proven by `prisma/vault.lock`; they stay in this folder under their original names. E2.2 added `20261102120001_add_credentials` to `20261102120038_add_alerts` (platform 0003 to 0040, byte copies) and the app migration `20261102130000_add_media_folder_files`; the differences from the platform history are the declared deviations in `platform.lock`. Procedure and rehearsal: [database-baseline](../runbooks/database-baseline.md); what the platform adds: [schema-delta](schema-delta.md).

## Infra, CI and repository files

| Path | Category | Target | Epic |
|---|---|---|---|
| `infra/compose/{base,dev,prod,test}.compose.yml`, `.env.example` | noise | generated by `platform:infra:sync`; app overlays in `app.*.compose.yml`, `app.env.example` | E11 |
| ~~`infra/compose/otel.compose.yml`, `infra/otel/uptrace.yml`~~ (deleted in E9.2, #90); `infra/otel/otel-collector-config.yaml` is generated | vault-divergence | GreptimeDB `telemetry.compose.yml` | E9 / E11 (done) |
| `infra/nginx/{nginx.conf,nginx.prod.conf}` | noise | generated; app-owned `nginx/app.d/` | E11 |
| `infra/deploy/*` | open (legacy) | `vault deploy` (E11.1) | E11; deletion pending (follow-up D) |
| `.github/workflows/{ci,deploy}.yml` | noise | platform CI shape plus conformance jobs | E11 (done: full API conformance, web conformance, OpenAPI dump and lint, image build in E11.3) |
| `.github/ISSUE_TEMPLATE/*`, `pull_request_template.md` | noise | aligned in E0 | E0 |
| `scripts/{dev,worktree}.ps1` | domain | stay | |
| `tests/e2e` (Playwright) | domain | stay; add visual/e2e plan from ux-refresh | E10 |
| `media/{app_logo.png,favicon.ico}` | domain | brand source for E10 icons | E10 |
| `docs/specs/01..24`, `System_Specification_Document.md` | domain | historical; superseded section by section | ongoing |
