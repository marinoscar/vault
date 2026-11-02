# Runbook: Baseline the Vault Database Onto the Platform Migration History

> **WARNING: `main` is not deploy-safe between this change and E3.2.** The platform migrations change who holds `contributor` and `viewer` (0024) and make `storage_objects.org_id` NOT NULL (0025). Vault's legacy auth and storage code only keep working because of two `PLATFORM-ADOPTION-SHIM`s (`src/auth/membership-role-shim.ts`, `src/prisma/default-org.ts`). Do **not** deploy `main` from this change until the shim has been verified on a restored copy of production (section 6, "Verify"). The shim is removed in E3.2 (identity). Also: the PR that ships E2.1 and E2.2 **must be deployed as one**; the composed schema describes the database after platform 0040 and fails at runtime ("column does not exist") against a database that has not run `prisma:migrate`.

Use this **once per database**, when Vault first adopts `@marinoscar/platform-db` (E2.1 [#73](https://github.com/marinoscar/vault/issues/73) and E2.2 [#74](https://github.com/marinoscar/vault/issues/74), program epic [#54](https://github.com/marinoscar/vault/issues/54)). It proves the live schema equals the platform schema at version 0002, lets Prisma record nothing new for the two migrations Vault already ran, and then lets `prisma migrate deploy` apply platform 0003 to 0040 and Vault's `media_folder_files` migration for real.

It is a deliberate operator action. Never run it from `vault deploy update` or any automatic deploy step.

This is Vault's version of the EnterpriseAppBase procedure (`docs/runbooks/database-baseline.md` there) as adapted by kvox. Source of truth for the mechanics: `node_modules/@marinoscar/platform-db/README.md` ("Upgrade notes", steps B1 to B6, "Troubleshooting"), `apps/api/prisma/platform.lock`, and [local-exceptions](../platform-adoption/local-exceptions.md).

## 1. What is different about Vault

| Fact | Consequence |
|---|---|
| Vault's `20260124223146_initial` and `20260329151231_add_personal_access_tokens` are byte-identical to platform `0001_initial` and `0002_add_personal_access_tokens` (sha256 `755688a7...`, `696a7bc4...`). | B1 maps them by hash. **No `--map` file.** Both are already in the production ledger, so the baseline resolves **nothing**. |
| The other five Vault migrations are app-only. `20260403235813_add_media_folders` already dropped the `id` default on twelve platform tables (what platform 0005 does later) and added `storage_objects.media_folder_id`. | Platform 0005 cannot be mapped to it. It is installed and re-runs as a no-op. The differences are **declared deviations** (section 4). |
| `--through 2`. | Platform 0003 to 0040 (38 migrations) are installed as byte copies **after** `20261102120000_add_backup_schedules` (`20261102120001_...` to `20261102120038_...`) and applied by `prisma migrate deploy`. Nothing is skipped. |
| 0025 to 0029 and 0039 enable row-level security (RLS). | The dry run needs `--allow-rls`, which asserts an application role that is `NOSUPERUSER NOBYPASSRLS`. **Vault's API does not have that role yet (E2.3).** Passing the flag is a known, deliberate deviation: state it in the PR. |
| `storage_objects.media_folder_id` cannot exist in the composed schema (a fragment cannot add a column to a platform model). | App migration `20261102130000_add_media_folder_files` moves the link into `media_folder_files(object_id, org_id, media_folder_id)`, backfills it, then drops the column. It sorts after the installed 0025 on purpose. |

`platform db baseline` writes nothing on a dry run. `--apply` installs missing directories, resolves ledger rows, and writes `platform.lock`; **for Vault those files are already committed**, so production needs only the dry run (section 7).

## 2. Before you start

- **Know what `prisma:migrate` will do to production data** (the real change, step 6 of section 6):
  - 0023 creates the default organization (slug `default`) and one membership per user.
  - **0024 deletes the `user_roles` rows for `contributor` and `viewer`** and moves them onto `memberships.role_id`; admin's org grants (`storage:*`, `user_settings:*`) move to the new `org_admin` role, which every admin's membership gets.
  - 0025 adds `storage_objects.org_id` / `storage_object_chunks.org_id` NOT NULL (backfilled to the default org in one transaction), plus RLS policies.
  - The `media_folder_files` migration moves `media_folder_id`.
- **Check `_prisma_migrations` for a failed row first** (section 9). `LEDGER_FAILED_ROW` stops everything.
- **Have a way back**: a fresh backup and section 10. 0024 and 0025 are forward-only.
- The role running the tooling needs `CREATEDB` (the B3 shadow database), or pass `--shadow-database-url`.
- **Check `POSTGRES_HOST` and `POSTGRES_DB` twice** before anything that writes. `scripts/platform-env.js` builds `DATABASE_URL` from them.
- No secrets belong in the lock or in a report. The report prints SQL only.

## 3. Rehearse on a restored copy first

Production is touched only after the whole procedure ran clean on a copy.

1. Take a fresh production database dump: `pg_dump -Fc -h <prod-host> -U <user> -d <db> -f vault-<date>.dump`. (Vault's admin "backups" are logical, password-protected secret archives, not database dumps; keep one as well, but it cannot be restored with `pg_restore`.)
2. Restore it into a scratch database on a non-production cluster:

   ```bash
   createdb -h <scratch-host> -U postgres vault_rehearsal
   pg_restore -h <scratch-host> -U postgres -d vault_rehearsal --no-owner --no-acl <backup>.dump
   ```

3. Point a shell at the copy and **echo it**:

   ```bash
   export POSTGRES_HOST=<scratch-host> POSTGRES_PORT=5432 POSTGRES_USER=postgres POSTGRES_PASSWORD=... POSTGRES_DB=vault_rehearsal
   export VAULT_ENCRYPTION_KEY=<the production key, only to decrypt a sample>
   echo "$POSTGRES_HOST $POSTGRES_DB"
   ```

4. Run sections 5 to 8 against it. Save every report (`tee`).

**No backup at hand?** `apps/api/scripts/baseline-rehearsal.sh` builds a database in the shape production has today (only the seven original migrations, ledger rows included) and loads invented rows (`apps/api/test/prisma/fixtures/pre-baseline-data.sql`): `createdb vault_rehearsal && POSTGRES_DB=vault_rehearsal bash scripts/baseline-rehearsal.sh`. CI runs exactly this (`baseline-rehearsal` job). It proves the tooling and the numbers; it proves nothing about production data. **A rehearsal on a real production backup is required before the production window**, and its reports must equal production's (section 7).

## 4. The dry run and the declared deviations

From `apps/api`:

```bash
npm run db:baseline -- --through 2 --allow-rls | tee baseline-dry-run.txt
```

The committed `platform.lock` already declares everything below, so the expected result is:

```
B1 map: 2 matched, 0 unmatched ... (platform:0001 and 0002 map by [sha256]; 0003-0040 are the installed copies)
B2 ledger: managed by Prisma Migrate; 0 problem(s)
B3 diff (...to platform:0002...): 0 blocking, 49 declared
B4 raw-SQL indexes: 0 problem(s)
B4 row-level security: 0 problem(s)
B5 act: 0 to resolve, 0 to install only
nothing to do: platform.lock maps every package migration and the database records them
```

The 49 declared statements are Vault's `deviations` in `platform.lock`; each is explained in [local-exceptions](../platform-adoption/local-exceptions.md#drift-allowlist-and-lock-deviations):

| Deviation id | Statements | What |
|---|---|---|
| `vault:pre-0005-uuid-defaults` | 11 | `ALTER COLUMN "id" DROP DEFAULT` on platform tables, done early by `add_media_folders`. Platform 0005 re-runs them as no-ops |
| `vault:storage-media-folder-id` | 3 | `storage_objects.media_folder_id` (the column, printed with the twelfth early `DROP DEFAULT`, its index and its foreign key). Removed by `add_media_folder_files` |
| `vault:domain-schema` | 35 | every table, index and foreign key of the seven Vault tables (`secret_types`, `secrets`, `secret_versions`, `secret_attachments`, `media_folders`, `backup_schedules`, `backup_runs`) |
| `vault:media-folder-files` | 5 | the `media_folder_files` table, appearing in a diff only **after** that migration ran |

**If the dry run reports a difference the lock does not declare** (a different count, a `BLOCKING:` line), production is not the database Vault rehearsed: stop. Regenerate the declarations from the report with the proving script, **read what it refuses**, and never declare an unexplained statement:

```bash
node scripts/baseline-deviations.mjs baseline-dry-run.txt              # prove, print entries as JSON
node scripts/baseline-deviations.mjs baseline-dry-run.txt --lock prisma/platform.lock --write
```

`baseline-deviations.mjs` accepts on a platform table only (a) an `id` `DROP DEFAULT` that an app-only migration also contains and (b) the three `storage_objects.media_folder_id` statements; everything else must target a table created by an app-only migration, otherwise it exits 1 (`test/prisma/baseline-deviations.spec.ts`). To generate the lock from scratch (a new fork of this history): create a minimal lock `{"lockVersion":1,"platformVersion":"1.0.0","migrations":[]}`, run the script with `--write`, add the raw-SQL index below, then `--apply`.

**Raw-SQL index.** `rawSqlIndexes` in `platform.lock` lists `secret_versions_current_unique` with the exact `pg_indexes.indexdef` (`CREATE UNIQUE INDEX secret_versions_current_unique ON public.secret_versions USING btree (secret_id) WHERE (is_current = true)`). Confirm on the copy: `SELECT indexdef FROM pg_indexes WHERE indexname = 'secret_versions_current_unique';`. B4 fails with `INDEX_MISSING` / `INDEX_DEFINITION_DIFFERS` otherwise.

`--allow-rls` is mandatory here. Without it the run refuses with `RLS_OPT_IN_REQUIRED`, because platform 0025 to 0029 are above `--through 2`. Passing it is the known deviation of section 1.

## 5. Apply (rehearsal copy only for a first adoption)

`--apply` **writes files**. Vault's directories and lock are already committed, so on the committed tree it refuses with `LOCK_NOT_EMPTY` and there is nothing to install. It is needed only to regenerate the installed directories from scratch (a fresh adoption, after `git rm` of them). When you do run it, run it on the rehearsal copy with `POSTGRES_DB` set to the copy:

```bash
npm run db:baseline -- --through 2 --allow-rls --apply     # installs 38 dirs, resolves nothing, writes platform.lock, B6 verify
```

Expected: `B5 act: 0 to resolve, 38 to install only`, `B6 verify: ok`, `baseline applied and verified`. The installed names are `20261102120001_add_credentials` to `20261102120038_add_alerts` (the tool uses `max(now, newest + 1s)`, and Vault's newest app migration is `20261102120000`). **Commit the directories and the lock together; never edit or rename them** (the lock hashes the raw bytes, comments included). The `media_folder_files` migration must be created **after** the install, with a timestamp later than the last installed directory (`20261102130000_...`); installing after it would sort the platform copies behind it and break the `org_id` dependency (`APP_MIGRATION_OUT_OF_ORDER`).

## 6. Migrate, seed, verify (rehearsal copy)

```bash
cd apps/api
npm run prisma:migrate             # applies 0003-0040 (38) + 20261102130000_add_media_folder_files: THE real change
npm run prisma:seed                # roles with scope, org_admin grants, permissions, system secret types
npm run db:check                   # offline: 40 installed platform migrations equal the package
npm run db:check:database          # ledger rows match the files (46 on a copy of today's production)
npm run db:drift                   # migrations equal the composed schema; 12 raw-SQL indexes, 12 RLS policies
npm run db:baseline                # "nothing to do"
npx ts-node --transpile-only --project prisma/tsconfig.json scripts/verify-vault-data.ts
```

`prisma:migrate` ends with `All migrations have been successfully applied.` Record how long 0025 took (it backfills `storage_objects`, chunks and `audit_events` in one transaction; fine at Vault's size).

**After `prisma:migrate`, a `--through 2` run is no longer meaningful.** It prints the new tables and RLS policies as blocking differences. Use the plain `npm run db:baseline` (it defaults to the newest migration), which must say `nothing to do`.

**Verify (this is what "the shim is verified" means):**

1. `verify-vault-data.ts` prints only counts and exits 0: one default org; every storage object and chunk in it; every user has an org membership; `user_roles` holds only `admin`; every secret has exactly one current version; a **sample of current versions decrypts** with `VAULT_ENCRYPTION_KEY`; every attachment resolves to a ready object; every media link survived and the old column is gone. Compare the counts with the same query run on the copy *before* `prisma:migrate`.
2. Start the API against the copy and log in as an admin, a contributor and a viewer (`/api/auth/test/login` in test mode, or real OAuth against the copy). `GET /api/auth/me` must list the **same permissions each role had before**; open a secret, a media folder, an attachment download, a system backup export and a "My backups" export. These are the paths 0024 would have emptied without the shim.
3. In the admin Users page the role chips are unchanged (admins show `admin`; contributors `contributor`; viewers `viewer`), a role change persists, and a new user created by sign-in has a membership of the default organization.
4. **Fresh-database proof.** Empty database, then `prisma:migrate`, `prisma:seed`, `db:drift`: the 46 directories apply in order from nothing. CI does this on every PR (`db-check`).

## 7. Production

Only when the rehearsal on a **real backup** matched section 4 and section 6.

1. Open a maintenance window: Vault has no maintenance mode yet, so stop the API container (`docker compose stop api`) and announce downtime. Keep it open until step 9. Start only the migration commands (`docker compose run --rm api ...`) while it is stopped.
2. **Take a fresh `pg_dump -Fc`** and note where it is. It is the rollback.
3. **Check `POSTGRES_*`.** They must name production. Read them twice.
4. Dry run on production and compare line by line with the rehearsal's report:

   ```bash
   docker compose run --rm api npm run db:baseline -- --through 2 --allow-rls | tee baseline-dry-run-prod.txt
   ```

   Expected: identical to section 4 (`0 blocking, 49 declared`, ..., `nothing to do`). Any difference: stop; do not migrate.
5. **Migrate.** `docker compose run --rm api npm run prisma:migrate` (38 platform migrations + `media_folder_files`).
6. **Seed.** `docker compose run --rm api npm run prisma:seed`.
7. **Check.** `npm run db:check:database`, `npm run db:drift`, plain `npm run db:baseline` (`nothing to do`), `verify-vault-data.ts` (with `VAULT_ENCRYPTION_KEY` in the environment so the decrypt sample runs).
8. Deploy the application version with the shims (it is the one in the same image: the composed schema needs the migrated database). Smoke test with an admin and a contributor.
9. Close the window.

`--apply` is **not** run on production: the directories and the lock ship in the image, 0001 and 0002 are already recorded in the ledger, and a second apply would refuse (`LOCK_NOT_EMPTY`) and has nothing to resolve.

The image must contain `@marinoscar/platform-db` (its `platform` bin), `scripts/platform-env.js`, `prisma/` (including `schema/`, `fragments/`, `platform.lock`) and `prisma.config.ts`. Confirm on the rehearsal with the **built image**, not for the first time in the window.

## 8. After production

- API still connects as a superuser, so RLS is inert. Plan **E2.3** (application role `vault_app`, `NOSUPERUSER NOBYPASSRLS`, ownership transfer) for right after the window. Paths that need `forOrg` / `runInOrg` the moment RLS bites are listed in [local-exceptions](../platform-adoption/local-exceptions.md#rls-readiness-paths-that-need-an-org-scope-in-e23).
- Record the rehearsal (section 11).

## 9. A failed migration row

`LEDGER_FAILED_ROW`: `_prisma_migrations` has a row that never finished or was rolled back with no later success. Check first:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
```

Look at what the migration did and left behind, then `npm run prisma -- migrate resolve --rolled-back <dir>` (if you undid it by hand) or `--applied <dir>` (if its effect is fully in the database). Re-run the dry run.

## 10. Rollback

The baseline writes only ledger rows (none for Vault). The migration step is what changes data, and 0024, 0025 and `add_media_folder_files` are **forward-only**.

- **Before `prisma:migrate`**: nothing to undo.
- **After `prisma:migrate`**: restore the backup from step 2 of section 7 (`createdb` a new database, `pg_restore --no-owner --no-acl` into it and switch `POSTGRES_DB`; Vault has no in-app database restore yet) **and** redeploy the previous application version. The previous version does not work against the migrated database (0024, 0025), and the new version does not work against the old one.
- Drop rehearsal databases when done.

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DIFF_BLOCKING` | A statement no deviation declares | Section 4. Never declare without `baseline-deviations.mjs` proving it |
| `RLS_OPT_IN_REQUIRED` | Forgot `--allow-rls` | Add it, as section 1 explains |
| `LOCK_NOT_EMPTY` on `--apply` | The lock is committed | Expected on production; see section 7 |
| `APP_MIGRATION_OUT_OF_ORDER` / `org_id` does not exist | An app migration sorts before the installed 0025 | Rename it (only while no database has applied it) to a timestamp after `20261102120038` |
| `LEDGER_CHECKSUM_MISMATCH` | A migration file was edited after it was applied | Restore it from Git |
| `permission denied to create database` | No `CREATEDB` for the shadow database | Create an empty database and pass `--shadow-database-url` |
| After migrate, every non-admin user gets 403 | The auth shim is missing from the running build | Deploy the build that contains `membership-role-shim.ts` |
| `Default organization not found` at runtime | `prisma:migrate` has not run (0023 creates the org) | Migrate; the composed schema needs the migrated database |
| `P3005` | The database was never managed by Prisma Migrate | Not the case for Vault production; see the platform-db README |
| `ERESOLVE` on `npm install` | `@marinoscar/platform-db` needs `zod ^4.4.3` (E1 zod bump) | Land the zod 4 change first |

## 12. Rehearsal record

Fill in per rehearsal and keep it with the PR.

| Field | Value |
|---|---|
| Date and who | |
| Source | restored production backup `<id>` / `baseline-rehearsal.sh` fixture |
| Postgres version | |
| B3 numbers | `0 blocking, 49 declared` |
| `prisma:migrate` duration, 0025 duration | |
| `verify-vault-data.ts` counts (before / after) | |
| Decrypt sample size / failures | |
| Permissions per role before / after | |
| Fresh-database `db:drift` | |

Recorded so far: the fixture rehearsal (`baseline-rehearsal.sh`, PostgreSQL 16, this change's author, local): dry run `0 blocking, 49 declared`, `prisma:migrate` applied 39 migrations, `db:check:database` ok (46 ledger rows), `db:drift` ok (12 raw-SQL indexes, 12 RLS policies), `verify-vault-data.ts` all checks passed (decrypt sample skipped: the fixture ciphertext is not real). **No real-backup rehearsal has been done.**
