# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Scheduled admin backups**: administrators can schedule automatic backups of every user's secrets into the configured object storage (**Admin Settings > Backups**). Each run writes one AES-256 (WinZip AE-2) zip to `system-backups/vault-backup-YYYY-MM-DD_HHmmss.zip` holding `README.txt`, `index.json` (formatVersion 1, kind `system-backup`) and, per user, `users/NNNN/secrets.html`, `secrets.json` and `attachments/` under opaque folder names. Frequencies: every 1, 2, 3, 4, 6, 8 or 12 hours, daily, weekly or monthly (day 1 to 28) in an IANA time zone, DST-aware, one catch-up run after downtime. After a successful run only the newest `keepCount` (1 to 365, default 7) backups are kept. The password is write-only, stored encrypted and never returned, logged or audited; one password protects every user's data and cannot be recovered. Endpoints under `/api/admin/backups` (`schedule` GET/PUT, `run`, list, `:id/download`, `:id` DELETE) use `system_settings:read` / `system_settings:write`; new tables `backup_schedules` and `backup_runs`. Several API instances are safe: a due slot is claimed atomically, one run at a time, and a run whose heartbeat is older than 3 minutes is marked failed. Audit events `backups.schedule.update`, `backups.run`, `backups.download`, `backups.delete`, `backups.run.completed`. See [docs/SECRETS.md](docs/SECRETS.md#scheduled-backups-admin) and [docs/API.md](docs/API.md#backups-admin).
- **Password-protected data backup**: `POST /api/secrets/export` streams an AES-256 (WinZip AE-2) encrypted zip of the caller's own secrets (`secrets:read`; owner-only even with `secrets:read_any`). The archive holds `README.txt`, a script-free readable `secrets.html`, a machine-readable `secrets.json` (formatVersion 1) and attachments under opaque names (`attachments/0001-01.jpg`) so the unencrypted zip listing reveals nothing. Any password of 6 to 256 characters is accepted; it is never stored or logged and cannot be recovered. Options: `includeAttachments` (default true) and `includeVersions` (default false). Unreadable attachments are skipped with a warning inside the archive. Each export writes a `secrets.export` audit event. See [docs/SECRETS.md](docs/SECRETS.md#backup-and-export) and [docs/API.md](docs/API.md#post-secretsexport).
- **Back up my data** card on `/settings`: password and confirmation, a "Suggest one for me" passphrase button, a soft warning for short or single-word passwords, and a "What to back up" checklist.
- **Choose what to back up** (user export, saved user backups and the admin schedule): secrets (default on), attachments (default on, needs secrets), old versions (default off, needs secrets), media library (default off) and, for the admin backup only, system configuration (default off). New request fields `includeSecrets`, `includeMedia` (and `includeSystem` for the admin routes); `includeAttachments` and `includeVersions` keep working. Media is added as `media/media.json` plus opaque `media/NNNN/NNNN.<ext>` files, per user under `users/NNNN/media/` in the admin backup; not-ready media files are skipped and files missing from storage are skipped with a warning. System configuration adds `system/users.json`, `allowlist.json`, `secret-types.json` (custom types) and `settings.json` (AI block reduced to `apiKeyConfigured`); refresh tokens, PATs, device codes, sessions, encrypted credentials, the backup password and the audit log are never included. `README.txt` now lists what each archive holds. Fixed 400 messages: "Choose at least one thing to back up", "Attachments can only be backed up together with secrets", "Old versions can only be backed up together with secrets", "System configuration can only be included in a scheduled system backup" (`includeSystem` on a user route). New response header `X-Vault-Export-Media-Files`; backup runs report `mediaFileCount` and `contents`, filled in when the run ends. New `backup_schedules` content columns and `backup_runs.media_file_count` / `contents`. See [docs/SECRETS.md](docs/SECRETS.md#what-each-option-includes).
- **Download or save to storage**: the Back up my data card asks "Where should the backup go?" (download to this device, or save to the storage account). Saved user backups are built in the background, stored under `user-backups/<userId>/`, listed under **My saved backups** with signed download and delete, and the newest 10 per user are kept. The password is never stored, one backup can run per user, and only the owner can see or manage them (administrators cannot). Endpoints `GET /api/backups/me/config`, `POST`/`GET /api/backups/me`, `GET /api/backups/me/:id/download`, `DELETE /api/backups/me/:id` (`secrets:read`); `backup_runs` gains `scope` (`system` | `user`) and `owner_id`; audit events `backups.user.run`, `backups.user.run.completed`, `backups.user.download`, `backups.user.delete`. Admins get **Download a backup now** (`POST /api/admin/backups/export`, `system_settings:write`): a streamed zip with a typed password or the scheduled one, nothing stored, new `X-Vault-Export-Users` header, audited as `backups.export`. See [docs/SECRETS.md](docs/SECRETS.md#saved-user-backups) and [docs/API.md](docs/API.md#my-backups).
- **`vaultcli backup` contents** (vaultcli 1.2.0, unreleased): `--contents secrets,attachments,versions,media`, `--no-secrets` and `--media`/`--no-media`; saved settings gain `includeSecrets` and `includeMedia`; the setup wizard asks "What do you want to back up?"; output reports the media file count.
- **`vaultcli admin backups`** (vaultcli 1.2.0, unreleased): `schedule show|set`, `run [--wait]`, `list`, `download <id>` and `delete <id>` for the server's backups (`system_settings:read` / `system_settings:write`). `--wait` polls the list because there is no single-run endpoint; `--at` with an hourly schedule is refused. The terminal menu gains **Admin backups**, shown only to users with `system_settings:read`. See the [vaultcli README](tools/vaultcli/README.md#admin-backups--server-backups).
- **`vaultcli backup`** (vaultcli 1.2.0): downloads the backup zip with templated output paths (`{date}`, `{datetime}`, `{host}`, `{user}`, ...), password from `--password`, `--password-file`, an environment variable or a hidden prompt, collision-safe file names (`-1`, `-2` ... unless `--overwrite`), `.partial` writes with `0600` permissions, and non-zero exit codes for scheduled jobs. Also in 1.2.0: **retention** (`--keep-days`, `--keep-last`, `--no-prune`, `--prune-dry-run` and `vaultcli backup prune`; off until configured, deletes only files matching the output template, always keeps the newest and just-written backup, and a cleanup failure warns without failing the backup), **saved settings** in `<config dir>/backup.json` (`vaultcli backup config show|set|unset|reset`; precedence flag > saved > default; the password is never saved, only its source) so a schedule can be just `vaultcli backup --json`, and an **interactive terminal UI** (`vaultcli` with no arguments in a terminal, or `vaultcli -i`) with a Backups menu (run now, set up wizard, view settings, list backups, clean up, schedule instructions) and a Sign in / status screen. With `--json`, `vaultcli backup` now reports `{ backup, prune }`. See the [vaultcli README](tools/vaultcli/README.md#backup--password-protected-backup).
- **vaultcli .env Sync** (vaultcli 1.1.0): new `vaultcli sync` command group to back up local `.env` files (or any UTF-8 text file) into Vault as versioned Document secrets, with directory auto-discovery, client-side SHA-256 change detection, and cron support. This is distinct from the existing `app` CLI's bidirectional folder sync. See [docs/ENV-SYNC.md](docs/ENV-SYNC.md).
- **Card Import via AI Photo Scan**: an admin-configurable, opt-in feature (disabled by default) to populate a Card secret's fields from photos of the physical card. `POST /api/secrets/cards/extract` sends a cropped front/back image to an OpenAI vision model, returns candidate field values with per-field confidence for user review, and persists nothing about the card itself — only a minimal audit row. The CVV is never requested or returned. Bounded by a per-user burst limiter and a durable daily budget. See [docs/SECRETS.md](docs/SECRETS.md) and [docs/SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md) §8.
- **Card Renewal**: `POST /api/secrets/:id/renew` mints a new version of a secret from a replacement set of field values while selectively swapping only the attachment roles supplied (e.g. the front/back images of a reissued card), carrying every other attachment forward. The superseded version keeps its own values and its own images.
- **Version-Scoped Attachments**: secret attachments are now scoped to a specific `SecretVersion` rather than just the secret, so each version (including historical ones reachable via rollback) shows its own attachment set. Attachments carry forward automatically onto every new version (edit, rollback, or renewal). Deleting an attachment now refcounts the underlying storage object instead of always deleting it, since the same object may be referenced by more than one version.
- **Card attachment roles** (`card_front`, `card_back`): a card-face attachment is constrained to accepted image MIME types (JPEG/PNG/WebP/HEIC/HEIF) and a configurable size cap (`CARD_IMAGE_MAX_BYTES`, default 5 MB).
- **Expanded Card secret type fields**: `card_network` and `card_kind` (`select` fields with a fixed option list), and `security_code_2` / `issuing_bank` (optional).
- **`select` field type** for secret type field definitions, with a required, non-empty `options` list.
- **System settings `ai` block**: admin-only, write-only OpenAI API key (AES-256-GCM encrypted, masked in every read response), plus `enabled`, `model`, and `maxCallsPerUserPerDay`.
- **`GET /api/ai/status`**: lets any authenticated user check whether AI-backed features are currently available, without exposing system settings.

### Known Issues

- **#34**: 75 pre-existing test failures on this branch, unrelated to the card feature work.
- **#35**: the global `HttpExceptionFilter` discards any custom `code` an exception's response body carries and substitutes one derived purely from HTTP status. This affects every `AI_*` error code from the card-extraction endpoint (and any other endpoint that relies on a custom `code`) — clients currently see status-derived codes (e.g. `TOO_MANY_REQUESTS` for both a burst-limit and a quota rejection) instead of the specific code. See [docs/API.md](docs/API.md#error-codes).
- The `20260727120000_version_scoped_attachments` migration has not yet been run against a live database as part of this work.
- The OpenAI vision provider is exercised only by mocked unit tests; no real call to the OpenAI API has been made.

## [1.0.1] - 2026-01-24

### Added

- **CLI Storage Commands**: New storage commands for interacting with the storage API
  - File upload support with `storage upload` command
  - Interactive storage menu for browsing and managing files
- **CLI Sync Feature**: Full folder synchronization functionality
  - Sync database layer with better-sqlite3 for local state tracking
  - Sync engine for bidirectional folder synchronization
  - Sync commands (`sync push`, `sync pull`, `sync status`)
  - Interactive sync menu for easy sync management
- **API Improvements**: DatabaseSeedException for better seed-related error handling

### Fixed

- **Authentication**: Enhanced OAuth callback error logging for easier debugging
- **Authentication**: Improved error handling for missing database seeds
- **API**: Fixed metadata casting to `Prisma.InputJsonValue` in processing service
- **API**: Fixed metadata casting to `Prisma.InputJsonValue` in objects service
- **API**: Handle unknown error types in S3 storage provider
- **CLI**: Use ESM import for `existsSync` in sync-database module
- **Tests**: Convert ISO strings to timestamps for date comparison

### Changed

- **Database**: Squashed migrations into single initial migration
- **Infrastructure**: Added AWS environment variables to compose file

### Dependencies

- Added AWS SDK dependencies for S3 storage provider
- Added better-sqlite3 and related dependencies for CLI sync feature

### Documentation

- Added storage and folder sync documentation to CLI README

## [1.0.0] - 2026-01-24

### Initial Release

Vault - A production-grade full-stack application for secure secrets management built with React, NestJS, and PostgreSQL.

### Features

#### Authentication
- Google OAuth 2.0 with JWT access tokens and refresh token rotation
- Short-lived access tokens (15 min default) with secure refresh rotation
- HttpOnly cookie storage for refresh tokens

#### Device Authorization (RFC 8628)
- Device Authorization Flow for CLI tools, mobile apps, and IoT devices
- Secure device code generation and polling
- Device session management and revocation

#### Authorization
- Role-Based Access Control (RBAC) with three roles:
  - **Admin**: Full access, manage users and system settings
  - **Contributor**: Standard capabilities, manage own settings
  - **Viewer**: Least privilege (default), manage own settings
- Flexible permission system for feature expansion

#### Access Control
- Email allowlist restricts application access to pre-authorized users
- Pending/Claimed status tracking for allowlist entries
- Initial admin bootstrap via `INITIAL_ADMIN_EMAIL` environment variable

#### User Management
- Admin interface for managing users and role assignments
- User activation/deactivation controls
- Allowlist management UI at `/admin/users`

#### Settings Framework
- System-wide settings with type-safe Zod schemas
- Per-user settings with validation
- JSONB storage in PostgreSQL

#### API
- RESTful API built with NestJS and Fastify (2-3x better performance than Express)
- Swagger/OpenAPI documentation at `/api/docs`
- Health check endpoints (liveness and readiness probes)
- Input validation on all endpoints

#### Frontend
- React 18 with TypeScript
- Material-UI (MUI) component library
- Theme support with responsive design
- Protected routes with role-based access
- Vite build tool with hot module replacement

#### CLI Tool
- Cross-platform CLI (`app`) for development and API management
- Device authorization flow for secure CLI authentication
- Interactive menu-driven mode and command-line interface
- Support for multiple server environments (local, staging, production)

#### Infrastructure
- Docker Compose configurations:
  - `base.compose.yml`: Core services (api, web, db, nginx)
  - `dev.compose.yml`: Development overrides with hot reload
  - `prod.compose.yml`: Production overrides with resource limits
  - `otel.compose.yml`: Observability stack
- Nginx reverse proxy for same-origin architecture
- PostgreSQL 16 with Prisma ORM
- Automated database migrations and seeding

#### Observability
- OpenTelemetry instrumentation for traces and metrics
- Uptrace integration for visualization (UI at localhost:14318)
- Pino structured logging
- OTEL Collector configuration included

#### Testing
- Backend: Jest + Supertest for unit and integration tests
- Frontend: Vitest + React Testing Library
- CI pipeline with GitHub Actions

### API Endpoints

#### Authentication
- `GET /api/auth/providers` - List enabled OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate session
- `GET /api/auth/me` - Get current user

#### Device Authorization
- `POST /api/auth/device/code` - Generate device code
- `POST /api/auth/device/token` - Poll for authorization
- `GET /api/auth/device/sessions` - List device sessions
- `DELETE /api/auth/device/sessions/:id` - Revoke device session

#### Users (Admin only)
- `GET /api/users` - List users (paginated)
- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user

#### Allowlist (Admin only)
- `GET /api/allowlist` - List allowlisted emails
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/:id` - Remove from allowlist

#### Settings
- `GET /api/user-settings` - Get user settings
- `PUT /api/user-settings` - Update user settings
- `GET /api/system-settings` - Get system settings
- `PUT /api/system-settings` - Update system settings (Admin)

#### Health
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

### Technical Stack
- **Backend**: Node.js + TypeScript, NestJS with Fastify adapter
- **Frontend**: React + TypeScript, Material-UI (MUI)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Passport strategies (Google OAuth)
- **Testing**: Jest, Supertest, Vitest, React Testing Library
- **Observability**: OpenTelemetry, Uptrace, Pino
- **Infrastructure**: Docker, Docker Compose, Nginx
