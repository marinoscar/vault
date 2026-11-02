# Runbook: Back Up and Restore the Whole Database

Issue [#89](https://github.com/marinoscar/vault/issues/89) (E9.1, epic #64). **Read this assuming the application is down.** That is when it is read, so nothing below requires the admin UI or a browser session; every step has a shell form with `psql` and the PostgreSQL client tools.

> **This is whole-database disaster recovery.** It is the platform's `db-backup` slice (`@marinoscar/platform-api/db-backup`): a `pg_dump` of the entire database, restored as a whole, by an administrator. It is **not** Vault's encrypted secret backup (password-protected zips, selective, per user or per admin schedule: [SECRETS.md](../SECRETS.md#whole-database-backup-versus-encrypted-secret-backups)). Use this runbook for a lost or corrupted database, a bad migration or a move to a new server. To recover one user's secrets, use their zip.

Source of truth for every claim below:

- `@marinoscar/platform-api/db-backup` (package README: the options, the permissions, the restore carry-over, the troubleshooting table) and the platform specs it implements, `docs/specs/database-backup.md` and `docs/specs/database-restore.md` in the EnterpriseAppBase repository.
- `apps/api/src/platform/db-backup/db-backup.config.ts` (the options Vault passes and why), `apps/api/src/app-registrations/db-backup.ts` (the restore carry-over decision) and `apps/api/Dockerfile` (the pinned `postgresql17-client`).
- `docs/runbooks/application-role.md` (the ordinary database role the API connects as).

**Which procedure you want.**

- **The API is serving.** The application restores itself and can roll back: **section 7**. Prefer it. It verifies the archive, replays into a scratch database while the API stays up, and swaps in seconds.
- **The API is not serving, or the pre-flight came back `guided`.** **Section 4** is the same sequence by hand.

Sections 1 to 3 apply to both, as does the **keys section (2)**: get it wrong and a *successful* restore leaves every secret unreadable.

---

## 1. Before you start

- **Know which archive you want.** Every backup is a `database_backup_runs` row with a `migration_name` (the schema it contains). Restoring an archive from a different migration than the running code expects is a decision (section 6).
- **Deployment mode.** `DEPLOYMENT_MODE=self-hosted` (the default) enables in-app restore. `DEPLOYMENT_MODE=saas` turns restore and rollback off (`403 deployment_mode_saas`; a queued restore job is refused): use the provider's point-in-time recovery. Backups keep working in both. Vault passes no `restoreEnabled` override, so the variable is the single switch, read at startup.
- **Know the two prerequisites in section 6.** A restart policy and a single API replica.
- **Have a way back.** Until the swap is done and verified, the way back is the displaced database. After it is dropped, it is the `pre_restore` archive: hours, not seconds.
- **Do not delete anything until you have verified the restore.** Not the scratch database, the displaced one or the archive.
- **Take a fresh backup first** if the database is still readable: Console -> Operations -> **Database Backup** -> *Back up now*, or `POST /api/admin/db-backup/runs`.

## 2. Keys: the restored database must match the environment

The archive holds **ciphertext**. The keys are environment variables, not rows, and **a restore never carries them**:

| Variable | Encrypts | If it differs from the dumped database |
|---|---|---|
| `VAULT_ENCRYPTION_KEY` | Every secret version (`secret_versions`), the scheduled secret-backup password | **Every secret is unreadable**, permanently, until the matching key is back. The card-expiry scan fails loudly ("a rotated key must fail loudly"). |
| `SECRETS_ENCRYPTION_KEY` | Runtime-configured credentials in `credentials`: the object-storage secret access key, AI keys, SMTP/SES, VAPID | Storage, AI, email and Web Push stop working; each is re-entered in the admin UI. Secrets themselves are fine. |

Before pressing restore, and on **any new server**:

1. Take the two keys from the environment of the deployment that **wrote the backup** (the password manager or secrets store you keep `.env` in; the archive does not contain them and neither do the encrypted zips).
2. Put the **same values** in `infra/compose/.env` of the target before the API starts against the restored database.
3. After the restore, open one secret and one card, and *Test connection* on `/admin/settings/storage`.

Never rotate either key as part of a restore. The one-key-per-database rule is also why you must not restore an archive taken before a (rehearsed) key migration without the old key.

**Check without the UI** (a sample of current versions proves the key): `cd apps/api && POSTGRES_DB=<live> VAULT_ENCRYPTION_KEY=<64 hex> npx ts-node --transpile-only --project prisma/tsconfig.json scripts/verify-vault-data.ts --sample 25` prints counts only and decrypts a sample (read-only, `docs/runbooks/database-baseline.md` section 8); the Vault encryption-key Doctor check (Console -> Doctor) is the in-app form.

## 3. What the pre-flight tells you

The pre-flight is side-effect free: it creates, drops, alters and renames nothing, and the cluster admin connection is a short-lived `pg.Client` on the `postgres` maintenance database, outside the Prisma pool. It reports eight gates, each with a verdict and, when there is something to do, an action:

| Gate | Unhappy means |
| --- | --- |
| PostgreSQL client version | `pg_restore` in the API image is older than the server. Nothing can restore until the image is rebuilt (`apps/api/Dockerfile` pins `postgresql17-client`; pg_dump refuses a server newer than itself). |
| Cluster admin connection | The API cannot open a session on the `postgres` database. It cannot automate a restore; you still can. |
| `CREATE DATABASE` privilege | The application role lacks `CREATEDB`. Normal on managed PostgreSQL (the compose role has it). You can still restore with a superuser. |
| Row-level security bypass (`rls_bypass`) | The restore session cannot lift RLS: the role is neither superuser nor `BYPASSRLS` and the startup option did not reach the server (a transaction-mode pooler drops it). A restore would write the org tables **without their rows**. Connect directly to PostgreSQL. |
| Required extensions | The server lacks an extension the database uses (Vault: `uuid-ossp`). |
| Free disk space | Not room for a full copy (twice, if the displaced database is kept). Never a refusal: it downgrades the rollback mode (section 8). |
| Connected clients | More than one client address is attached. A hint, not a verdict. |
| Schema compatibility | The archive's migration and the live one differ, either direction. Blocks until you accept it (section 6). |

Outcomes: **`ok`** go ahead; **`guided`** the application cannot do it, so it hands you a paste-ready command block (normal, not an error); **`blocked`** something would break (only the schema gate has an override). Vault registers no gate of its own (no extension beyond `uuid-ossp`, no pgvector).

Run it from the Database Backup page's restore dialog, or `POST /api/admin/db-backup/runs/<run id>/restore` (the same call the dialog makes; it answers the verdict before anything starts).

If the API is not serving you cannot run it, and do not need to: section 4 shows what the gates would say as you go. Two facts worth checking by hand first:

```bash
# Can this role create a database?
psql --host=<db host> --port=<db port> --username=<db user> --dbname=postgres \
  -c "SELECT rolsuper OR rolcreatedb AS can_create FROM pg_roles WHERE rolname = current_user;"
# Is the client new enough for the server? (client major must be >= server major)
pg_restore --version
psql --host=<db host> --port=<db port> --username=<db user> --dbname=postgres -c 'SHOW server_version_num;'
```

## 4. The manual restore (the `guided` path, end to end)

Run it **as a role that may create databases**: a superuser or any role with `CREATEDB`. Throughout: `<live>` is `POSTGRES_DB`, `<scratch>` is `<live>_restore_<UTC timestamp>`, `<old>` is `<live>_old_<UTC timestamp>`.

### 4.0 Credentials

```bash
export PGPASSWORD='<the POSTGRES_PASSWORD of the admin role>'
```

### 4.1 Get the archive

With the API serving, the page's *Download* action returns a signed URL valid **five minutes**; treat it as a credential (it is a complete copy of the database: every secret ciphertext, every user). `GET /api/admin/db-backup/runs/<run id>/download` returns the same.

With the API down, fetch it from the bucket (the run row records `bucket` and `storage_key`). Keys are laid out as `database-backups/<app slug>/<YYYY>/<MM>/<app slug>-<UTC timestamp>-<run id>.dump` and list in time order:

```bash
aws s3 ls "s3://<bucket>/database-backups/" --recursive | tail -20
aws s3 cp "s3://<bucket>/<storage key>" /tmp/<archive>.dump
```

(The `system-backups/` and `user-backups/` prefixes are the *other* feature's zips; do not restore those with `pg_restore`.)

### 4.2 Sanity-check the archive

```bash
pg_restore --list /tmp/<archive>.dump | head -20
```

An archive whose table of contents is empty restores an empty database. The engine verifies this at upload time; a file that travelled through a laptop is worth re-checking.

### 4.3 Create the scratch database and replay into it

Nothing here touches the live database.

```bash
createdb --host=<db host> --port=<db port> --username=<admin role> <scratch>

PGOPTIONS='-c app.rls_bypass=on' \
pg_restore --host=<db host> --port=<db port> --username=<admin role> \
  --dbname=<scratch> \
  --no-owner --no-acl --exit-on-error --enable-row-security --jobs=4 \
  /tmp/<archive>.dump
```

**`--enable-row-security` and `PGOPTIONS='-c app.rls_bypass=on'` go together.** The org tables (`storage_objects`, `storage_object_chunks`, `ai_runs`, `ai_usage_events`, the group, grant and org-settings tables) force row-level security. With only the flag, `pg_restore` exits 0 and the tables come back empty; with only the option, it refuses the table. A superuser or `BYPASSRLS` role ignores the policies, so the pair is harmless there and required for any other role. The option goes in the **environment**, never argv. Connect to PostgreSQL directly, not through a pooler.

**`--exit-on-error` is load-bearing.** Without it `pg_restore` logs each failure, carries on and exits 0.

`--no-owner --no-acl` mirror how the archive was dumped (no ownership baked in).

Look at what you have before committing:

```bash
psql --host=<db host> --username=<admin role> --dbname=<scratch> \
  -c "SELECT count(*) FROM users;" -c "SELECT count(*) FROM secrets;" \
  -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;"
```

### 4.4 Stop the application

Everything below renames databases out from under connected processes. Stop **every** API instance (section 6).

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml stop api
```

### 4.5 Swap

From the **maintenance** database (`postgres`):

```bash
psql --host=<db host> --port=<db port> --username=<admin role> --dbname=postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '<live>' AND pid <> pg_backend_pid();" \
  -c 'ALTER DATABASE "<live>" RENAME TO "<old>";' \
  -c 'ALTER DATABASE "<scratch>" RENAME TO "<live>";'
```

The `pg_terminate_backend` is not optional. Each rename is a catalog update: it happens or it does not. If the second fails, see 5.2.

### 4.5.1 Hand the restored database to the application role

`--no-owner` makes the connecting role the owner of everything it restored. Restored as `postgres`, the tables belong to `postgres`, and the API (ordinary role, `vault_app`, `NOSUPERUSER NOBYPASSRLS`) cannot migrate or write them:

```bash
psql -v ON_ERROR_STOP=1 -v app=vault_app \
  --host=<db host> --port=<db port> --username=<admin role> --dbname=<live> \
  -f apps/api/scripts/transfer-ownership.sql
```

Idempotent, one transaction, refuses a superuser or `BYPASSRLS` role, leaves the extensions with the bootstrap superuser. Details: `docs/runbooks/application-role.md` section 4. Skip it if the deployment still connects as `postgres`.

### 4.6 Migrate, if the schemas differed

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml run --rm api npm run prisma:migrate
```

`npm run db:check:database` (in `apps/api`) then proves the database equals `platform.lock`.

### 4.7 Start, verify keys, verify data

Check section 2 **before** starting if the environment changed. Then:

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml start api
curl -fsS http://localhost:3535/api/health/ready
```

Log in; open a secret and a card (proves `VAULT_ENCRYPTION_KEY`); open an attachment (proves the storage configuration and bucket); open Console -> Doctor and clear every red item. Do **not** delete the displaced database until you have.

### 4.8 Clean up, later

```sql
DROP DATABASE "<old>";  -- only after you are satisfied; this is the fast way back until it is gone
```

## 5. When it goes wrong

### 5.1 `pg_restore` failed part way

The live database is untouched (the scratch is a separate database). `DROP DATABASE IF EXISTS "<scratch>";` and start again. Likely causes: an extension the server lacks, a client older than the server, a truncated download (4.2 catches it).

### 5.2 The swap half-completed

The live database was renamed to `<old>` and the second rename failed: there is **no database called `<live>`** and the API will not start. `\l` shows what exists. Finish (`ALTER DATABASE "<scratch>" RENAME TO "<live>";`) or undo (`ALTER DATABASE "<old>" RENAME TO "<live>";`, always safe: `<old>` is the original).

If the **automated** restore got here it already tried to undo it, and its log says which state you are in: *"The original database was renamed back into place"* (nothing is wrong; the scratch database is deliberately left, the row says `failed` with the reason), or *"CRITICAL: ... THERE IS NOW NO DATABASE NAMED `<live>`"* (nothing deleted; the process stays up in maintenance returning 503 until a database exists under the live name again; run the two statements, then restart).

### 5.3 The restore was wrong (bad archive, wrong point in time)

While `<old>` exists, seconds: `ALTER DATABASE "<live>" RENAME TO "<scratch>"; ALTER DATABASE "<old>" RENAME TO "<live>";`. Once `<old>` is dropped, the way back is the `pre_restore` archive (section 4 again, hours).

### 5.4 "database is being accessed by other users"

Re-run `pg_terminate_backend` and look for things that reconnect: a second API replica, a worker node, a pooler, a metrics exporter, an open `psql`.

### 5.5 After the restore, two catalogs are behind

The platform carries the **backup catalog** (`database_backup_runs`, its self-links, the restore's own job row and the completion audit row) across the swap, so the whole-database backup list is current. Vault registers **no** extra carry-over (`app-registrations/db-backup.ts`), so what is behind is whatever the archive predates:

- **The encrypted secret backups' catalog (`backup_runs`).** Zips taken after the archive are still in object storage (`system-backups/`, `user-backups/<userId>/`) but are no longer listed on Console -> Backups or Settings -> My backups. Nothing was lost; the zips are readable with the password and the tools in SECRETS.md. Take a new backup to re-establish a current row.
- **Files uploaded after the archive.** The `storage_objects` rows are gone with the archive; the bytes in the bucket are orphans a purge (`npm run storage:purge`, which enumerates the registered key prefixes including `database-backups/`) can reach. Attachments the restored rows point at exist unless something deleted them after the archive; a missing one shows as a failed download, not as lost metadata.
- **Look for "CRITICAL: the restore succeeded but its backup catalog could not be carried"** in the log. The restore itself is fine, but any backup taken after the archive is missing from the list; the archives are untouched in storage. The displaced database must then be dropped by hand (the retention sweep only drops databases it has a row for):

```bash
psql --host=<db host> --username=<admin role> --dbname=postgres \
  -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname LIKE '%_old_%';"
```

### 5.6 The restore finished and the application never came back

The swap ends in `process.exit(0)` on purpose (section 6.1). Nothing restarting the process is the missing restart policy, not a failed restore: the database under `<live>` is the restored one. Start the service, fix the policy before restoring again.

### 5.7 Every secret says it cannot be decrypted

Section 2: `VAULT_ENCRYPTION_KEY` differs from the one the dumped database was written under. Restore the right key into `.env` and restart; do not "re-encrypt".

## 6. Prerequisites for the automated restore

Both are about the deployment and turn a successful restore into an outage when untrue.

### 6.1 A restart policy

The automated swap ends in `process.exit(0)`: a process whose database was renamed holds a pool pointing at a name that no longer exists. `infra/compose/prod.compose.yml` sets `restart: unless-stopped` on the API (with a comment saying why); a deployment that composes its own services needs the equivalent (or a Kubernetes Deployment, not a bare Pod). Verify:

```bash
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' <api container>   # want: unless-stopped (or always)
```

### 6.2 A single API replica

The maintenance flag is per process: the replica doing the restore puts itself in maintenance, every other replica keeps serving and has its connections terminated by the swap. Scale to one first (`docker compose ... up -d --scale api=1`). The `Connected clients` gate only hints; you are the check.

### 6.3 Schema boundary

The pre-flight blocks when the archive's migration and the live one differ, in either direction. **Archive older than live:** run the migrations after the swap (4.6). **Archive newer than live:** more dangerous (the running code has never seen that schema and the migration runner considers it up to date): deploy the matching application version first. The override clears that gate only.

## 7. The automated restore

What the application does when the pre-flight came back `ok`. The application serves normally through steps 1 to 5; only the swap (seconds) is unavailable.

| # | Phase | `restore_status` | Roughly |
| --- | --- | --- | --- |
| 1 | Download the archive; re-verify checksum and table of contents | `restoring` | minutes |
| 2 | `pre_restore` safety backup (`drop_database` mode only) | `restoring` | as long as a backup |
| 3 | `CREATE DATABASE <live>_restore_<ts>` | `restoring` | instant |
| 4 | `pg_restore -j 4` into it (both RLS halves) | `restoring` | hours: every index is rebuilt |
| 5 | Verify tables and a migration ledger | `verifying` | seconds |
| 6 | Maintenance window, two renames, carry-over, `exit(0)` | `swapping` | seconds |

It is `db.restore.run`, a server-only job (never offered to a worker node). Anything up to and including `verifying` is harmless if it fails (the live database is untouched, the scratch is dropped, the row says `failed`). There is deliberately no cancel for a restore: the only window worth interrupting is the swap. Poll `GET /api/admin/db-backup/runs/<run id>` or the row:

```bash
psql --host=<db host> --username=<db user> --dbname=<live> -c \
  "SELECT restore_status, restore_error, restore_scratch_db, restore_old_db, swapped_at FROM database_backup_runs WHERE id = '<run id>';"
```

After it finishes the supervisor restarts the process. Then: `curl -fsS http://localhost:3535/api/health/ready`; section 4.7's verification (keys, a secret, an attachment, Doctor); run the migrations if the pre-flight reported a schema mismatch (the application does not, deliberately). The audit trail is split across two databases: `db_restore:start` and `db_restore:swap` are in `<live>_old_<ts>`, `db_restore:complete` (with the timeline in `meta`) is in the database you now run on. Every user who holds `db_backup:read` gets the mandatory `db_backup.restore_completed` notification.

## 8. Disk space and rolling back

`databaseBackup.restoreRollbackMode` (`retain_database` or `drop_database`) is a system setting on the page. `retain_database` keeps the displaced database as `<live>_old_<ts>` until `oldDatabaseRetentionHours` (rollback is one rename: seconds); `drop_database` takes a full `pre_restore` safety dump instead (rollback is a full restore: hours). When disk is short the pre-flight downgrades `retain_database` and says so rather than refusing. Free space "could not be checked" is expected when the database host is not visible from the API container: `df -h "$(psql --username=<db user> --dbname=postgres -tAc 'SHOW data_directory')"` on the database host.

- **Roll back (retain mode), by the page or by hand.** Two renames: `ALTER DATABASE "<live>" RENAME TO "<fresh name>"; ALTER DATABASE "<old>" RENAME TO "<live>";`. The process exits afterwards; the parked database is never dropped automatically.
- **`drop_database` mode.** Restore the `pre_restore` archive; the schema check is overridden for it automatically (that dump came from the schema the code ran moments before).
- **Neither exists.** Past the retention window the rollback is reported *unavailable*, not failed; restoring another archive is a new restore.

## 9. Rehearsal

Rehearse on a **throwaway** server, never the live one (issue #89 acceptance: "The restore runbook has been rehearsed"). A minimal drill:

1. Start a disposable Postgres 16 with the compose test file, bootstrap the application role (`docs/runbooks/application-role.md` "Fresh volumes"), `npm run prisma:migrate`, seed, create one secret, one card and one attachment.
2. Take a backup (Database Backup page, or `POST /api/admin/db-backup/runs`). Confirm `database-backups/...dump` in the bucket and `pg_restore --list` is non-empty.
3. Change data (delete the secret). Restore the backup with the automated path; confirm the secret is back, the attachment opens, and Doctor is green.
4. Repeat by hand through section 4 on a second scratch server, including the keys check (start with a *wrong* `VAULT_ENCRYPTION_KEY` once to see 5.7, then the right one).
5. Record the date, the Postgres major, the archive size and the elapsed time in the PR.

The dump-and-restore round trip with row-level security forced is also executable: `apps/api/test/db-backup/db-backup-rls.db.spec.ts` (`npm run test:db --workspace=api`) proves the dump carries every row of two organizations, that the flag is in argv and the option only in the environment, and that the flag alone restores to empty tables.

## 10. Related

- [SECRETS.md: whole-database backup versus encrypted secret backups](../SECRETS.md#whole-database-backup-versus-encrypted-secret-backups)
- `docs/runbooks/application-role.md`: the ordinary database role and the ownership transfer a restore as a superuser may need.
- `docs/platform-adoption/local-exceptions.md`: why Vault registers no restore carry-over.
- EnterpriseAppBase `docs/specs/database-backup.md`, `docs/specs/database-restore.md`, `docs/runbooks/postgres-client-version.md`, `docs/runbooks/maintenance-mode.md`.
