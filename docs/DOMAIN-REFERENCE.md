# Domain quick reference

> **Audience:** developers and AI assistants · **Rules:** [AGENTS.md](../AGENTS.md)

A compact map of the endpoint groups, RBAC, tables, allowlist and environment variables as of the pre-migration state (Vault `1b2074d`, 2026-11-02). It was moved here from the former `CLAUDE.md` so the assistant rule files stay small. It is a quick reference, not the contract: the full endpoint reference is [API.md](API.md), the secrets feature is [SECRETS.md](SECRETS.md), the design is [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md). Where the platform migration (epic #54, [platform-adoption](platform-adoption/README.md)) changes a fact here, the epic's PR updates this page.

## API Endpoints (MVP)

### Authentication
- `GET /api/auth/providers` - List enabled OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate session
- `POST /api/auth/logout-all` - Logout from all devices
- `GET /api/auth/me` - Get current user

### Device Authorization (RFC 8628)
- `POST /api/auth/device/code` - Generate device code (Public)
- `POST /api/auth/device/token` - Poll for authorization (Public)
- `GET /api/auth/device/activate` - Get activation info
- `POST /api/auth/device/authorize` - Approve/deny device
- `GET /api/auth/device/sessions` - List device sessions
- `DELETE /api/auth/device/sessions/{id}` - Revoke device session

### Users (Admin-only)
- `GET /api/users` - List users (paginated)
- `GET /api/users/{id}` - Get user by ID
- `PATCH /api/users/{id}` - Update user (roles, activation)
- `PUT /api/users/{id}/roles` - Update user roles

### Settings
The platform settings slice serves these (E4.1); Vault's namespaces are `ui`, `features`, `ai`, `vaultCards`, `vaultBackups` (system) and the platform's `dataTables`, `navigation` (user). `/api/org-settings` (`org_settings:read|write`) is mounted and unused in single-organization mode.
- `GET /api/user-settings` - Get current user's settings
- `PUT /api/user-settings` - Replace user settings
- `PATCH /api/user-settings` - Partial update user settings
- `GET /api/system-settings` - Get system settings
- `PUT /api/system-settings` - Replace system settings (Admin)
- `PATCH /api/system-settings` - Partial update system settings (Admin); `ai.apiKey` is write-only (credential store)
- `GET /api/org-settings`, `PATCH /api/org-settings` - Organization overrides (`org_settings:*`; only namespaces with an org layer, none today)

### Allowlist (Admin-only)
- `GET /api/allowlist` - List allowlisted emails (paginated, filterable)
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/{id}` - Remove email from allowlist

### Storage Objects
- `POST /api/storage/objects/upload/init` - Initialize resumable upload
- `GET /api/storage/objects/:id/upload/status` - Get upload progress
- `POST /api/storage/objects/:id/upload/complete` - Complete multipart upload
- `DELETE /api/storage/objects/:id/upload/abort` - Abort upload
- `POST /api/storage/objects` - Simple file upload
- `GET /api/storage/objects` - List objects (paginated)
- `GET /api/storage/objects/:id` - Get object metadata
- `GET /api/storage/objects/:id/download` - Get signed download URL
- `DELETE /api/storage/objects/:id` - Delete object
- `PATCH /api/storage/objects/:id/metadata` - Update metadata

### Personal Access Tokens
- `POST /api/pat` - Create a new personal access token
- `GET /api/pat` - List current user's tokens
- `DELETE /api/pat/{id}` - Revoke a token

### Secrets
- `POST /api/secrets` - Create a secret with its initial version
- `GET /api/secrets` - List secrets (paginated, own secrets unless `secrets:read_any`)
- `GET /api/secrets/by-name/{name}` - Get a secret by name (decrypted current version)
- `GET /api/secrets/{id}` - Get a secret with decrypted current version data
- `PUT /api/secrets/{id}` - Update a secret; creates a new version if data changed
- `DELETE /api/secrets/{id}` - Delete a secret and all its versions
- `GET /api/secrets/{id}/versions` - List version history (metadata only)
- `GET /api/secrets/{id}/versions/{versionId}` - Get a specific version, decrypted, with that version's attachments
- `POST /api/secrets/{id}/versions/{versionId}/rollback` - Rollback to a version (restores its attachment set)
- `POST /api/secrets/export` - Download a password-protected (AES-256 zip) backup of the caller's own secrets (`secrets:read`); body `{ password (6-256 chars), includeSecrets? (default true), includeAttachments? (true), includeVersions? (false), includeMedia? (false) }`; `includeSystem` is a 400; response is the raw zip (not wrapped in `{data}`; headers `X-Vault-Export-Secrets`, `-Attachments`, `-Media-Files`), audited as `secrets.export`. 400 messages for the content rules are in `docs/API.md` (Backup content validation). See `docs/SECRETS.md`
- `POST /api/secrets/{id}/renew` - Renew with new field values, swapping only the attachment roles supplied (e.g. reissued card front/back)
- `POST /api/secrets/{id}/attachments` - Link a storage object to the secret's current version
- `GET /api/secrets/{id}/attachments` - List attachments (`versionId`, `role` query filters)
- `DELETE /api/secrets/{id}/attachments/{attachmentId}` - Unlink; underlying storage object is refcount-deleted, not always deleted

### My Backups (saved user backups)
- `GET /api/backups/me/config` - `{ storageConfigured, keepCount: 10 }` (`secrets:read`)
- `POST /api/backups/me` - Save a backup to storage; body as `POST /api/secrets/export`; 202 run; 400 if storage is not configured, 409 if one is already running. Password used in memory only, never stored. Stored as `user-backups/<userId>/vault-backup-<UTC datetime>.zip`, newest 10 kept (`secrets:read`)
- `GET /api/backups/me` - List own saved backups, newest first, paginated (`secrets:read`)
- `GET /api/backups/me/{id}/download` - Signed URL (300 s) `{url, expiresAt, fileName}`; 404 if not own (`secrets:read`)
- `DELETE /api/backups/me/{id}` - Delete own saved backup, 204 (404 if not own, 409 while running) (`secrets:read`). Admins do not see these in the admin list

### Secret Types
- `POST /api/secret-types` - Create a custom secret type
- `GET /api/secret-types` - List secret types (system + own/all custom)
- `GET /api/secret-types/{id}` - Get a secret type by ID
- `PUT /api/secret-types/{id}` - Update a custom secret type
- `DELETE /api/secret-types/{id}` - Delete a custom secret type (409 if secrets reference it)

### AI (Card Scanning)
- `GET /api/ai/status` - Whether AI-backed features are available to the current user (no permission required); a compatibility alias of the platform's `GET /api/ai/config`, kept until E11
- `POST /api/secrets/cards/extract` - Extract candidate card fields from card photos through the platform AI slice (`secrets:write` + `ai:use`, behind the platform kill switch). Persists nothing; the CVV is never requested or returned. Disabled by default - see `docs/SECRETS.md` and `docs/API.md`.
- `GET /api/ai/config`, `/api/ai/*`, `/api/admin/ai/*` (`ai_config:*`, `org_ai_config:*`) - the platform AI slice: policy, deployment key, model catalogue, usage. See `docs/API.md` (AI card extraction).

### Admin Backups
- `GET /api/admin/backups/schedule` - Get the backup schedule (`system_settings:read`); never returns the password (`passwordConfigured`, `passwordUpdatedAt` only)
- `PUT /api/admin/backups/schedule` - Replace the schedule; optional write-only `password` (`system_settings:write`)
- `POST /api/admin/backups/run` - Start a backup now (saved to storage), 202 (`system_settings:write`)
- `POST /api/admin/backups/export` - Download a backup now: raw streamed zip (not `{data}`), nothing stored, no run row; body `{ password? | useScheduledPassword?: true (exactly one), includeSecrets?, includeAttachments?, includeVersions?, includeMedia?, includeSystem? }`; headers `X-Vault-Export-Users`, `-Secrets`, `-Attachments`, `-Media-Files`; audited as `backups.export` (`system_settings:write`)
- `GET /api/admin/backups` - List runs (system scope only), newest first, paginated; each run has `scope`, `mediaFileCount`, `contents` (`system_settings:read`)
- `GET /api/admin/backups/{id}/download` - Signed URL (300 s) `{url, expiresAt, fileName}` (`system_settings:write`)
- `DELETE /api/admin/backups/{id}` - Delete the backup object, 204 (409 while running, 502 if storage refuses) (`system_settings:write`). See `docs/SECRETS.md`

### Health
- `GET /api/health/live` - Liveness check
- `GET /api/health/ready` - Readiness check (includes DB)

## RBAC Model

### Roles
- **Admin**: Full access, manage users and system settings
- **Contributor**: Standard capabilities, manage own settings
- **Viewer**: Least privilege (default), manage own settings

### Key Permissions
- `system_settings:read/write` - System settings access
- `user_settings:read/write` - User settings access
- `users:read/write` - User management
- `rbac:manage` - Role assignment
- `allowlist:read/write` - Allowlist management (Admin only)
- `storage:read/write/delete` - Storage object access (own objects)
- `storage:read_any/write_any/delete_any` - Storage object access (all objects, Admin only)
- `secrets:read/write/delete` - Secret access (own secrets)
- `secrets:read_any/write_any/delete_any` - Secret access (all secrets, Admin only)
- `secret_types:read/write/delete` - Secret type management (system types are always read-only regardless of permission)

## Database Tables

- `users` - User accounts with profile info
- `user_identities` - OAuth provider identities (provider + subject)
- `roles` / `permissions` / `role_permissions` - RBAC
- `user_roles` - User-to-role assignments
- `system_settings` - Global app settings (JSONB); as of the card epic, includes an `ai` block that, since E8.1, is the platform AI policy (enabled, key policy, providers, caps) plus Vault's `cardExtractModel`. The OpenAI API key is NOT in it: it is the platform's write-only deployment key (`credentials` table, purpose `ai`, name `openai`, `SECRETS_ENCRYPTION_KEY`); the old `{ enabled, provider, model, maxCallsPerUserPerDay }` block is rewritten by `npm run vault:migrate-ai-platform`, a legacy `ai.apiKey` block by `npm run vault:migrate-ai-key`. The platform AI tables (`ai_models`, `ai_usage_events`, `ai_runs`, `user_ai_keys`) hold the catalogue, usage and runs
- `user_settings` - Per-user settings (JSONB)
- `audit_events` - Action audit log; also backs the AI card-extraction daily budget (counts `ai.card.extract` rows in the trailing 24h); also records `secrets.export` (backup downloads) — see `docs/SECRETS.md`
- `refresh_tokens` - JWT refresh tokens (hashed)
- `allowed_emails` - Allowlist for access control
- `device_codes` - Device authorization codes (RFC 8628)
- `storage_objects` - File metadata, status, storage references
- `storage_object_chunks` - Multipart upload chunk tracking
- `personal_access_tokens` - User-created long-lived API tokens (hashed)
- `secret_types` - Secret type schemas (system + custom); `fields` is a JSONB array of field definitions (`string` \| `number` \| `date` \| `select`, the last requiring `options`)
- `secrets` - Secret metadata (name, description, type, owner); values live only in `secret_versions`
- `secret_versions` - One immutable, AES-256-GCM-encrypted row per version of a secret's field data; exactly one `isCurrent = true` per secret
- `backup_schedules` - Singleton row (`default`): admin backup schedule, keep count, content flags (`include_secrets`, `include_attachments`, `include_versions`, `include_media`, `include_system`), encrypted password, `next_run_at` / `last_run_at`
- `backup_runs` - History of scheduled, manual and user-saved backups (`scope` `system` | `user`, `owner_id` set for `user` runs and FK to `users` with cascade, status, trigger, `storage_key`, size, counts incl. `media_file_count`, `contents` text[] filled in when the run ends, error, `job_id` FK to `jobs` (set null), `heartbeat_at` (no longer written), `deleted_at`); the object is removed by retention or delete, the row stays. Admin routes see `scope = system` only; user routes `scope = user AND owner_id = me`
- `secret_attachments` - Files linked to a secret. **As of migration `20260727120000_version_scoped_attachments`, scoped to a `secret_version_id` (not just `secret_id`), and carries an optional `role` (`card_front` \| `card_back`).** Carries `org_id` (E6.2); its foreign key to `storage_objects` is the composite `(storage_object_id, org_id)`, so an attachment cannot point at another organization's object. Unique on `[secret_version_id, storage_object_id]` and `[secret_version_id, role]`; deleting the last reference to a `storage_objects` row deletes it, but a referenced object is never deleted out from under another version or secret still pointing at it

## Access Control: Email Allowlist

The application uses an **email allowlist** to restrict access to pre-authorized users only.

### How It Works
1. Admins add email addresses to the allowlist before users can login
2. During OAuth login, the user's email is checked against the allowlist
3. If the email is not in the allowlist, login is denied with a clear error message
4. Exception: `INITIAL_ADMIN_EMAIL` always bypasses the allowlist check

### Configuration
- `INITIAL_ADMIN_EMAIL` environment variable grants initial admin access
- This email is automatically added to the allowlist during database seeding

### Admin Management
- Access allowlist management at `/admin/settings/users` (Allowlist tab)
- Two tabs available:
  - **Users**: Manage existing registered users
  - **Allowlist**: Pre-authorize email addresses for future logins

### Status Tracking
- **Pending**: Email added to allowlist but user hasn't logged in yet
- **Claimed**: User has successfully logged in and created an account
- Claimed entries cannot be removed (prevents accidentally removing existing user access)


## Environment Variables

Key variables (see `infra/compose/.env.example` for full list):

**Application:**
- `NODE_ENV` - Environment (development/production)
- `PORT` - API port (default: 3000)
- `APP_URL` - Base URL (default: http://localhost:3535)

**Database (individual connection parameters):**
- `POSTGRES_HOST` - Database hostname (default: localhost)
- `POSTGRES_PORT` - Database port (default: 5432)
- `POSTGRES_USER` - Database user (default: postgres)
- `POSTGRES_PASSWORD` - Database password (default: postgres)
- `POSTGRES_DB` - Database name (default: appdb)
- `POSTGRES_SSL` - Enable SSL connection (default: false)

Note: `DATABASE_URL` is constructed automatically from these variables at runtime.

**Authentication:**
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `JWT_ACCESS_TTL_MINUTES` - Access token TTL (default: 15)
- `JWT_REFRESH_TTL_DAYS` - Refresh token TTL (default: 14)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth credentials
- `INITIAL_ADMIN_EMAIL` - First user with this email becomes Admin
- `DEVICE_CODE_EXPIRY_MINUTES` - Device code lifetime (default: 15)
- `DEVICE_CODE_POLL_INTERVAL` - Device polling interval in seconds (default: 5)

**Encryption (two different keys, never interchangeable):**
- `VAULT_ENCRYPTION_KEY` - 64 hex chars (`openssl rand -hex 32`); encrypts secret values (`secret_versions`), backup passwords and the scheduled-backup password via `CryptoService`. See [SECRETS.md](SECRETS.md)
- `SECRETS_ENCRYPTION_KEY` - base64, 32 bytes (`openssl rand -base64 32`); the platform credential store's key (`credentials` table, today only the OpenAI API key at purpose `ai`, name `openai`). Checked at startup (`verifyEncryptionKeyAtStartup`) and by the Doctor check `secrets.encryption-key`. Moving a pre-E4.2 key: [runbooks/ai-key-migration.md](runbooks/ai-key-migration.md)

**Observability:**
- `OTEL_ENABLED` - Enable OpenTelemetry (default: true)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTEL Collector endpoint
- `OTEL_SERVICE_NAME` - service name (default `vault-api`)
- `GREPTIME_*`, `STACK_AGENT_URL`, `STACK_AGENT_TOKEN` - deployment defaults for the telemetry store connection and the VPS stack agent; the connection saved at `/admin/settings/telemetry` overrides `GREPTIME_*`. Whether anything is exported is a runtime setting (`telemetry.enabled`), not a variable. See [runbooks/telemetry.md](runbooks/telemetry.md)

