# Runbook: Reset user data and factory reset

**Audience:** an administrator of a Vault deployment, and anyone supporting a user who asks to delete their data.
**Applies to:** the platform `user-data` slice mounted in E9.3 ([#91](https://github.com/marinoscar/vault/issues/91), program epic [#54](https://github.com/marinoscar/vault/issues/54), epic [#64](https://github.com/marinoscar/vault/issues/64)). Design and the permission matrix: [SECRETS.md, Deleting your data](../SECRETS.md#deleting-your-data), [API.md](../API.md#exports-user-data-and-onboarding). Registrations: `apps/api/src/platform/user-data/`.

Source of truth for every claim below:

- `apps/api/src/platform/user-data/user-data.manifest.ts`: categories, the `backups` scope, one decision per owner model.
- `apps/api/src/platform/user-data/factory-reset.steps.ts`: what the reset does that the platform cannot.
- `apps/api/test/user-data/user-data-purge.db.spec.ts`: the real-Postgres proof (every row and every object).

---

## 1. A user deletes their own data (Settings > Delete my data)

No operator action is needed. The page shows live counts per category; each destructive action needs the acknowledgement box and the exact phrase (`DELETE MY BACKUPS`, `DELETE MY CONTENT`, `DELETE MY DATA`). It runs as the server-only job `user.data.purge` and, for backups and unused custom types, the delegate `vault.user_data.purge`.

- **Irreversible.** Vault cannot recover a deleted secret. The only copy that survives is a password-protected backup the user already holds ([SECRETS.md](../SECRETS.md#backup-and-export)); `everything` and `content` also delete the user's saved backups.
- **The account stays**: user row, roles, membership and the browser session. `everything` also revokes the user's access tokens: a CLI using a `pat_` token gets `401` afterwards.
- **If the page reports files kept** (`storageObjectsFailed` above zero): the provider refused to delete them. Their rows are kept; fix the provider (`/admin/settings/storage`, Doctor) and run the deletion again.
- **A saved backup that will not delete** keeps its row; the delegate job fails and the queue retries it (three attempts). Check `/admin/settings/jobs` for `vault.user_data.purge`.

## 2. Factory reset (Console > Danger Zone > Factory reset)

Needs `system:factory_reset` (Admin only); disabled when `DEPLOYMENT_MODE=saas`. It deletes, in this order: pending jobs, **every user's data, the actor's included**, every logical backup archive and its record (user and scheduled), other users, every custom secret type, every stored file, every organization but the default one.

It keeps: the actor, roles and permissions, system settings, runtime credentials (storage, AI key, SMTP, VAPID), the system secret types, **the backup schedule and its encrypted password**, the audit log and the platform `db-backup` archives and their jobs once that slice is mounted.

### Before

1. **Download any archive you want to keep** from Console > Backups. The reset deletes every logical backup, the scheduled ones included, because an archive is secret data in a zip. A database backup (the platform `db-backup` slice) is what survives a reset.
2. Take a database backup if the slice is mounted, and confirm the object store is reachable (Doctor).
3. Tell the users: every secret is deleted, with no recovery after the job runs.

### Run and verify

1. Type `FACTORY RESET` on the page. The job `admin.factory_reset` runs up to 30 minutes and is idempotent: a failed attempt retries and deletes what is left.
2. Verify: Home shows no secrets; `GET /api/admin/factory-reset/summary` shows zero users but you and zero categories with rows; the object store has no `uploads/`, `system-backups/` or `user-backups/` keys.
3. Sign-in still works for the actor; everyone else must be added to the allowlist again (the allowlist is cleared but for the actor's own entry).

### Recover

There is no recover: restore a database backup taken before ([database-restore](../specs/database-restore.md) once that slice is mounted) and the matching object store snapshot, then re-run the migrations and `npm run prisma:seed`.

## 3. Known limits

- The factory reset summary needs the Vault shim `required-field-filters.ts` (`PLATFORM-ADOPTION-SHIM(E9.3)`, listed in [local-exceptions](../platform-adoption/local-exceptions.md)) until the platform stops filtering required columns with `not: null`.
- The page links to `/admin/settings/db-backup` for "back up first"; that page exists once the db-backup slice is mounted. Until then use Console > Backups for the logical archives.
