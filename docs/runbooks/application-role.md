# Runbook: Move the API to the Application Database Role

**Audience:** whoever operates a Vault database.
**Applies to:** an **existing** database that the API still reaches as a superuser (`postgres` or a provider's admin login). A fresh development or test volume needs none of this: `infra/compose/postgres-init/10-application-role.sh` creates the role on the volume's first start. Issue: [#75](https://github.com/marinoscar/vault/issues/75) (E2.3, program epic [#54](https://github.com/marinoscar/vault/issues/54)).

Source of truth for every claim below:

- `apps/api/scripts/transfer-ownership.sql`: the ownership transfer, with its preconditions and its closing check.
- `infra/compose/postgres-init/10-application-role.sh`: the role attributes.
- `apps/api/src/prisma/default-org.ts` and `org-scope.ts`: how the API scopes its storage access to the default organization.
- [production-cutover.md](production-cutover.md): the end-to-end order (this runbook comes before the baseline on a first cutover).
- [database-baseline.md](database-baseline.md): the baseline (it creates the policies this role makes effective).
- `docs/platform-adoption/local-exceptions.md`: the RLS items this closes.

---

## Why this exists

Platform migration `0025_org_scoped_rls` forces row-level security on `storage_objects`, `storage_object_chunks`, `ai_runs` and `ai_usage_events`; `0026` to `0029` and `0039` do the same for the group, grant, organization-settings, credential and webhook tables. **A superuser skips every policy, `FORCE` included.** While the API connects as `postgres`, tenant isolation is inert.

Vault is single-organization until identity is adopted (E3.2), so the API reads and writes storage objects inside the **default organization's** scope (`runInDefaultOrg` / `defaultOrgClient` in `apps/api/src/prisma/default-org.ts`): `set_config('app.org_id', <default org id>, true)` as the first statement of a transaction, never a session-level `SET`. Every access to `storage_objects`, `storage_object_chunks` and every query that joins through them (secret attachments, media folders and links, exports, the backup size estimate) goes through it, so it is safe to connect as an ordinary role.

The target state:

| | |
|---|---|
| Role | `vault_app`: `LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE` |
| Owns | the database, schema `public`, and every table, sequence, type and function the migrations created |
| Does not own | the extension `uuid-ossp`; it stays with the bootstrap superuser |
| The API signs in with | `POSTGRES_USER` / `POSTGRES_PASSWORD` set to the role's login |
| Bootstrap login | `postgres` (or your provider's superuser), for administration only: this runbook, extensions, `pg_dump`/`pg_restore` by hand |

`CREATEDB` lets the real-Postgres tests and a database restore create scratch databases. `CREATEROLE` is kept for the worker-node credential broker (E5). The role never gets `SUPERUSER` or `BYPASSRLS`, not even to make a backup or a restore work: a manual `pg_dump` or `pg_restore` as the role carries **both** `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on` (the flag alone exits 0 with empty tables; the option alone is refused). As a superuser neither is needed.

---

## 1. Prerequisites

- **Order.** For the **first cutover of a pre-platform database**, do this runbook (sections 3 and 4) **before** the baseline dry run and `prisma:migrate`, so the migrations and the seed run as the application role. This is the order of [production-cutover.md](production-cutover.md) and of CI's `baseline-rehearsal` job. For a database that is already baselined and migrated but still reached as a superuser, run it any time; then the post-migration check applies: `npm run db:check:database` and `npm run db:drift` are green and `SELECT count(*) FROM storage_objects WHERE org_id IS NULL` (run **as the superuser**) is `0` (the column does not exist before the migration, so skip that query on a pre-platform database).
- **A superuser login** to the cluster. The ownership script refuses to run as anyone else, and the application role must not be used to run it.
- **A recent verified backup**, downloadable (`pg_dump` of the database, or the provider's snapshot). Ownership changes are reversible (section 7), but you want a way back that does not depend on that argument.
- **`uuid-ossp` already exists in the database** (it does on every deployment that has run the migrations):

  ```sql
  SELECT extname, extowner::regrole FROM pg_extension WHERE extname = 'uuid-ossp';
  ```

  One row, owned by the superuser. If it is missing, create it now as the superuser (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`). `uuid-ossp` is a "trusted" extension, so the ordinary role could create it itself, but then it would own it; keep it with the superuser.
- **A maintenance window.** The API must be stopped while ownership moves. Plan a few minutes: the transfer is one transaction and touches only catalog rows.
- **A password for the role**, generated and stored where you keep secrets (`openssl rand -base64 24`).
- **`psql` 14 or newer.**
- **Managed PostgreSQL (RDS, Cloud SQL, Azure Database for PostgreSQL).** `transfer-ownership.sql` refuses to run unless the session is a superuser; an administrator that is not one has to run the script's statements by hand, as a member of the application role (`ALTER ... OWNER TO` needs the executing role to be a member of the new owner, and `GRANT vault_app TO <admin>` provides that). The provider may also deny `CREATEROLE`; the role still works for the API.

Run every `psql` below from a checkout of the repository on a host that reaches the database, with `PGPASSWORD` exported for the superuser.

---

## 2. Rehearse on a restored copy

Do this once, before the production window, against a copy of production. The role is cluster-wide, so on the same cluster the rehearsal creates the real role (harmless: it owns nothing yet).

1. **Restore a recent `pg_dump` into a scratch database** (`createdb vault_role_rehearsal`, then `pg_restore --no-owner`, as the superuser).
2. **Create the role** (section 3).
3. **Transfer the scratch database** (section 4, with `--dbname=vault_role_rehearsal`).
4. **Check ownership**:

   ```sql
   SELECT tableowner, count(*) FROM pg_tables WHERE schemaname = 'public' GROUP BY 1;   -- only vault_app
   SELECT datname, datdba::regrole FROM pg_database WHERE datname = 'vault_role_rehearsal';
   ```

5. **Run the application's own migrations as the role** against the copy. It must report nothing pending and fail on no permission:

   ```bash
   cd apps/api
   POSTGRES_HOST=<db host> POSTGRES_PORT=<db port> POSTGRES_DB=vault_role_rehearsal \
   POSTGRES_USER=vault_app POSTGRES_PASSWORD=<app password> \
   npm run prisma:migrate
   npm run db:check:database && npm run db:drift
   ```

6. **Prove isolation** as the role, on the copy:

   ```sql
   -- connected as vault_app, app.org_id unset: zero rows, not an error.
   SELECT count(*) FROM storage_objects;
   ```

   A count of `0` on a database that has objects is the expected, correct answer. Inside the application the same read goes through the default organization's scope and returns the real count.
7. **Start an API container** against the copy (role login) and walk the smoke test of section 6.
8. **Drop the scratch database**, and write down how long step 3 took.

If anything in 3 to 6 fails, stop and read the error: the script's closing check names every object it could not hand over.

---

## 3. Create the role

As the superuser, connected to the application database:

```bash
psql -v ON_ERROR_STOP=1 \
  -v app_user=vault_app -v app_password='<the password>' \
  --host=<db host> --port=<db port> --username=postgres --dbname=<POSTGRES_DB> <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE;
-- PostgreSQL 16: makes every role this one creates inherit-and-set for it.
ALTER ROLE :"app_user" SET createrole_self_grant = 'inherit, set';
SQL
```

These are the attributes `10-application-role.sh` gives the role on a fresh volume (the script also moves the database and schema ownership; for an existing database the next section does that, and covers every table). On PostgreSQL older than 16 omit the `ALTER ROLE ... SET` line.

If the role already exists, check it instead of creating it:

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'vault_app';
-- want: f, f, t, t
```

The role needs `CONNECT` on the database (granted to `PUBLIC` by default) and no other grant: it will own everything it uses.

---

## 4. Transfer ownership

In the window, with the API **stopped** (`docker compose ... stop api`, every replica, and anything else that reads the database):

```bash
psql -v ON_ERROR_STOP=1 -v app=vault_app \
  --host=<db host> --port=<db port> --username=postgres --dbname=<POSTGRES_DB> \
  -f apps/api/scripts/transfer-ownership.sql
```

What it does, in one transaction:

- refuses to run unless you are a superuser, the role exists, and the role is **not** a superuser or `BYPASSRLS`;
- moves the database, schema `public`, and every table (including `_prisma_migrations`), partitioned table, view, sequence, function and type in `public` to the role;
- **skips** the extensions and every object they own;
- ends with a check that fails, and so rolls everything back, if anything the application should own is still owned by someone else.

It is idempotent: a re-run, or a run on a database that already belongs to the role, changes nothing. Output ends with `transfer-ownership: done; the database and every application-owned object belong to the role`. Verify afterwards:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'vault_app';                       -- f | f
SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'vault_app';     -- 0
```

---

## 5. Switch the API login and restart

Set the API's login to the role. In `infra/compose/.env` (a deployment's own `.env` file):

```bash
POSTGRES_USER=vault_app
POSTGRES_PASSWORD=<the role's password>
```

`infra/compose/.env.example` carries `POSTGRES_USER=vault_app`. `APP_DB_USER` / `APP_DB_PASSWORD` are read only by `infra/compose/test.compose.yml` and by `10-application-role.sh` when it initialises a new volume; an existing deployment does not need them.

Restart the API so it reconnects as the role:

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml up -d --force-recreate api
```

Run migrations as the role to confirm it owns what it needs (`docker compose run --rm api npm run prisma:migrate` should report nothing pending) and watch the API log for a clean start.

A manual `pg_dump` as `vault_app` needs the bypass pair (section "Why this exists"); the same dump as the superuser needs neither.

---

## 6. Verify

```sql
SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- connected as vault_app, want: vault_app | f | f
```

(The platform Doctor check `db.rls_role` reports the same once the Doctor slice lands in E3.1; until then `apps/api/test/prisma/role-attributes.db.spec.ts` is the executable form, run by CI against `vault_app`.)

Then a short smoke test as a real user: sign in, open a secret that has an attachment and download it, upload a card image and attach it, open the media library and one folder with files, run a "My backups" export and a system backup with attachments and media. **If a list is suddenly empty, an attachment shows no file, or an upload answers 500**, a storage read or write is bypassing the default-organization scope: roll back (section 7) and report it with the failing route; do not widen the role.

---

## 7. Rollback

Set `POSTGRES_USER` and `POSTGRES_PASSWORD` back to the superuser login and restart the API (section 5, reversed). **Ownership can stay as it is**: a superuser ignores ownership, so nothing needs to be transferred back and no restore is needed. Row-level security is inert again, which is the state you started from.

To remove the role entirely afterwards (optional, API stopped and already switched back):

```sql
REASSIGN OWNED BY vault_app TO postgres;
DROP OWNED BY vault_app;
DROP ROLE vault_app;
```

---

## Fresh volumes, tests and CI

- `infra/compose/postgres-init/10-application-role.sh` runs only on an **empty** data volume (the image's `/docker-entrypoint-initdb.d` contract). `infra/compose/test.compose.yml` mounts it with `APP_DB_USER=vault_app`; the image's bootstrap login stays `postgres`. An existing test volume keeps its old state: `docker compose -f test.compose.yml down -v`.
- Vault has no development database service in compose (dev uses an external Postgres on `devnet`). Run the script by hand against it once, as the superuser: `PGHOST=<host> PGPASSWORD=<superuser password> APP_DB_USER=vault_app APP_DB_PASSWORD=<pw> POSTGRES_DB=<db> sh infra/compose/postgres-init/10-application-role.sh`. It fails if the role already exists; use sections 3 and 4 for a database with data.
- CI (`.github/workflows/ci.yml`): the **DB Check** and **Baseline rehearsal** jobs start Postgres with `postgres` as the bootstrap superuser, run that script to create `vault_app`, and connect the migrations, the seed, the drift checks and `npm run test:db` as `vault_app`. The RLS specs (`apps/api/test/rls/`) additionally build their own throwaway role and database through `apps/api/test/helpers/app-role-database.helper.ts`, which needs a superuser to bootstrap (`POSTGRES_USER` if it is one, otherwise `postgres` with the same `POSTGRES_PASSWORD`) and skips when none is reachable.
- `npm run test:db` locally: with `.env.test` naming `vault_app` on the test compose database (port 5433) it exercises the ordinary role end to end. Against a database whose login is a superuser, `role-attributes.db.spec.ts` skips with a warning.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Script: `run this as a superuser` | You connected as the application role or another ordinary role. Use the bootstrap login. |
| Script: `refusing a role that is SUPERUSER or BYPASSRLS` | The role was created too privileged. `ALTER ROLE vault_app NOSUPERUSER NOBYPASSRLS;` as a superuser, then re-run. Never leave it privileged to "make something work". |
| Script: `the role does not exist` | Section 3 first. |
| Script: `objects still not owned by the application role` | The transaction rolled back; the message lists the objects. Fix their owner by hand and re-run. |
| `10-application-role.sh`: `role "vault_app" already exists` | The script is for a new cluster or volume. Sections 3 to 4 handle an existing role and database. |
| API: `permission denied for table ...` / `must be owner of ...` after the switch | Ownership was not transferred (or a migration ran as the superuser since). Re-run section 4 with the API stopped. |
| API: `permission denied to create extension` | `uuid-ossp` is missing from the database. Create it as the superuser (section 1). |
| An attachment or media file comes back with no object, lists are empty, an upload answers 500 | A storage read or write outside the default-organization scope. Roll back (section 7) and report it. |
| `new row violates row-level security policy for table "storage_objects"` | An insert outside the scope, or naming an `org_id` other than the scoped organization. Same fix. |
| A restore as the superuser leaves the API unable to write | `--no-owner` made the superuser the owner. Run section 4 against the restored database. |

## Related

- [database-baseline.md](database-baseline.md): the baseline tooling, which runs as a superuser.
- `docs/SECURITY-ARCHITECTURE.md`: the security design.
- `docs/platform-adoption/local-exceptions.md`: the temporary shims this relies on (default-organization scope, local `runInOrg`).
