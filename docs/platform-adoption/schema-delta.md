# Schema delta: what the platform adds to the Vault database

Result of E2.1/E2.2 ([#73](https://github.com/marinoscar/vault/issues/73), [#74](https://github.com/marinoscar/vault/issues/74)). Platform migrations 0003 to 0040 (`@marinoscar/platform-db` 0.1.0-next.21) applied to a database that was at 0002. The composed schema describes the database **after** 0040, so the E2.1 build only runs against a migrated database (deploy E2.1 and E2.2 together).

## New tables

| Slice | Migration | Tables |
|---|---|---|
| credentials | 0003, 0018, 0029 (RLS) | `credentials`, `user_credentials`, `org_credentials` |
| notifications | 0004, 0006, 0007, 0011 | `notification_deliveries`, `notifications`, `push_subscriptions`, `notification_broadcasts` |
| jobs and nodes | 0008, 0009, 0013, 0038 | `jobs`, `job_stats_rollup`, `worker_nodes`, `node_credentials`, `job_node_secrets`, `worker_node_events` (raw-SQL indexes `jobs_active_dedup_uniq_idx`, `jobs_attempts_gt1_idx`, `jobs_succeeded_duration_idx`) |
| db-backup | 0010 | `database_backup_runs` |
| ai | 0016 | `ai_models`, `user_ai_keys`, `ai_runs`, `ai_usage_events` |
| identity (organizations) | 0023 | `organizations`, `memberships`, `org_invites` (inserts the default organization, slug `default`, and one membership per user) |
| sharing (RLS) | 0026, 0027 | `groups`, `group_members`, `group_invites`, `grants` |
| settings (RLS) | 0028 | `org_settings` |
| android-app | 0033 | `android_app_releases` |
| webhooks (RLS) | 0039 | `webhook_endpoints`, `webhook_deliveries` |
| alerts | 0040 | `alert_rules`, `alert_incidents` |

## Changes to tables Vault already had

| Table | Change | Migration |
|---|---|---|
| `users` | `metadata JSONB NOT NULL DEFAULT '{}'` plus a size CHECK | 0036 |
| `roles`, `permissions` | `scope` (`system` / `org`) | 0024 |
| `user_roles` | **rows for org roles deleted** (carried by `memberships.role_id`) | 0024 |
| `role_permissions` | admin's org-scoped grants moved to `org_admin` | 0024 |
| `audit_events` | `org_id` (SetNull) plus index `(org_id, created_at)`, backfilled | 0025 |
| `refresh_tokens` | `device_code_id`, `org_id` | 0019, 0023 |
| `personal_access_tokens` | `org_id` | 0023 |
| `device_codes` | `pat_id`, `collected_at`, `credential_expires_at`, `revoked_at`, `org_id` | 0019, 0023 |
| `storage_objects` | `org_id NOT NULL` (FK Restrict), `UNIQUE (id, org_id)`, two indexes, ENABLE + FORCE RLS, policy `storage_objects_org_isolation` | 0025 |
| `storage_object_chunks` | `org_id NOT NULL`, composite FK `(object_id, org_id)`, FORCE RLS | 0025 |
| several platform tables | `id` default dropped | 0005 (a no-op: Vault did it in `add_media_folders`) |

## Vault's own changes (E2.2)

| Change | Where |
|---|---|
| `storage_objects.media_folder_id` becomes `media_folder_files(object_id, org_id, media_folder_id)`; the column, its index and its foreign key are dropped | `20261102130000_add_media_folder_files` |
| Models `MediaFolder`, `SecretType`, `Secret`, `SecretVersion`, `SecretAttachment`, `BackupSchedule`, `BackupRun` and the back-relations on `User` / `StorageObject` move to app fragments with unchanged relation names | `apps/api/prisma/fragments/vault.prisma`, `media-folder-files.prisma` |
| Roles `org_admin` (scope `org`) and the `scope` of `contributor`, `viewer`, `admin` and of the org permissions in the seed | `apps/api/prisma/seed.ts` |

## Code that changed because of it

`objects.service.ts` (writes `orgId`), `media.service.ts`, `backup-runner.service.ts`, `secrets-export.service.ts` (media link), `membership-role-shim.ts` and its call sites (0024). See [local-exceptions](local-exceptions.md).
