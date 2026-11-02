---
name: platform-migration
description: Change the Vault database schema. Today the schema is a hand-edited schema.prisma with plain Prisma migrations; from E2 it is composed from platform-db fragments plus app fragments and baselined onto platform.lock. Covers editing a fragment, composing, creating the migration, keeping lock and drift checks green, and the live-data baseline rehearsal. Use when adding or changing a table, column or index, or bumping @marinoscar/platform-db.
---

# Schema and platform migrations

Schema work goes to the `database-dev` agent; the main agent does the git steps. Use `npm run prisma:*` from `apps/api`, never bare `npx prisma`.

## Before E2 (today)

1. Edit `apps/api/prisma/schema.prisma`.
2. `cd apps/api && npm run prisma:migrate:dev -- --name <snake_case_name>`, then `npm run prisma:generate`.
3. Never edit or rename an installed migration (the seven in `apps/api/prisma/migrations/`); comments inside `migration.sql` count. Partial/expression indexes are hand-written SQL in the migration, never `@@unique`.
4. Never write SQL that decrypts, re-encrypts or rotates `secret_versions` ciphertext, the AI key or the backup password; `VAULT_ENCRYPTION_KEY` stays.
5. Add tests; commit schema and migration together.

## E2: the baseline (one-time, live data)

Vault's production database already holds data, so the platform history is **baselined in place**, never re-run. Follow EAB `docs/runbooks/database-baseline.md` and Vault's own runbook that E2 adds. In order:

1. Restore the latest backup to a scratch database; rehearse everything there first.
2. Compose the schema: platform fragments from `@marinoscar/platform-db` plus `apps/api/prisma/fragments/*.prisma` (domain: secrets, secret types, versions, attachments, media folders, backup schedules/runs) with `npm run db:compose`; `apps/api/prisma/schema/` is **generated, never hand-edited**.
3. `platform db baseline` records the platform migrations as applied; declare any difference as a `deviations` entry in `platform.lock` and list it in `docs/platform-adoption/local-exceptions.md`.
4. Create the application database role `NOSUPERUSER NOBYPASSRLS` owning the tables; org tables force RLS on `org_id` (a migration touching them runs `BEGIN; SELECT set_config('app.rls_bypass','on',true); ...; COMMIT;`). Doctor check `db.rls_role` proves it.
5. Verify `db:check`, `db:drift`, row counts, and decrypt a sample secret with `VAULT_ENCRYPTION_KEY` on the rehearsal copy before touching production. Write the rollback plan (restore point) into the PR.

## After E2

- Edit the owning fragment, run `npm run db:compose`, then `prisma:generate`; CI's `db:compose:check` fails on a stale generated file.
- App-owned table: `npm run prisma:migrate:dev -- --name <name>`; a back-relation on a platform model is an `extend model` block, never an edit to a platform file.
- A change to a **platform** table is a seam request on marinoscar/EnterpriseAppBase (`seam_request.yml`), not a local edit; a stop-gap is a side table or a declared deviation.
- Installed platform migrations are byte copies proven by `prisma/platform.lock`; `npm run db:check` fails on any byte change. New raw-SQL index: also add it to the raw-SQL index list the lock tracks.
- Every dump and restore keeps `--enable-row-security` **and** `PGOPTIONS=-c app.rls_bypass=on`.

Check commands (after E2): `cd apps/api && npm run db:compose && npm run db:check && npm run db:drift`.
