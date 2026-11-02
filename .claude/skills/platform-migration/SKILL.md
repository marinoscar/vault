---
name: platform-migration
description: Change the Vault database schema. The schema is composed from @marinoscar/platform-db fragments plus the app fragments in apps/api/prisma/fragments (E2.1) and the database is baselined onto the platform history proven by platform.lock (E2.2). Covers editing a fragment, composing, creating the migration, keeping lock and drift checks green, and the live-data baseline rehearsal. Use when adding or changing a table, column or index, or bumping @marinoscar/platform-db.
---

# Schema and platform migrations

Schema work goes to the `database-dev` agent; the main agent does the git steps. Use `npm run prisma:*` from `apps/api`, never bare `npx prisma`.

## Where we are (E2.1 + E2.2 landed)

The schema is composed and the database is baselined onto the platform history. Procedure for the one-time baseline of a database that has not taken it yet: [docs/runbooks/database-baseline.md](../../../docs/runbooks/database-baseline.md) (rehearse on a restored backup first; `apps/api/scripts/baseline-rehearsal.sh` builds a pre-baseline database from the seven original migrations when no backup is at hand).

Hard rules that stay:

1. Never edit or rename an installed migration (Vault's seven, the 38 installed platform copies); comments inside `migration.sql` count, and `npm run db:check` proves it. Partial/expression indexes are hand-written SQL in the migration, never `@@unique`.
2. Never write SQL that decrypts, re-encrypts or rotates `secret_versions` ciphertext, the AI key or the backup password; `VAULT_ENCRYPTION_KEY` stays.
3. A migration that touches an org table (`storage_objects`, `storage_object_chunks`, ...) runs as `BEGIN; SELECT set_config('app.rls_bypass','on',true); ...; COMMIT;`.
4. An app migration that depends on an installed platform migration must sort AFTER it (`media_folder_files` needs 0025's `org_id`): name it with a timestamp later than the newest installed directory. `db:check` reports `APP_MIGRATION_OUT_OF_ORDER`.
5. Add tests; commit fragment, generated schema, migration and (when relevant) `platform.lock` together.

## Day to day

- Edit the owning fragment, run `npm run db:compose`, then `prisma:generate`; CI's `db:compose:check` fails on a stale generated file.
- A table that is neither platform nor domain: `npm run prisma:migrate:dev -- --name <name>`; a back-relation on a platform model is an `extend model` block, never an edit to a platform file.
- A change to a **domain** table (secrets, media, backups) is a fragment edit in `packages/vault-db/schema/vault.<slice>.prisma` and a `vault-db promote`, not a `prisma migrate dev` in the app: follow [docs/runbooks/vault-domain-migration.md](../../../docs/runbooks/vault-domain-migration.md). `npm run db:check` also proves `prisma/vault.lock`.
- A change to a **platform** table is a seam request on marinoscar/EnterpriseAppBase (`seam_request.yml`), not a local edit; a stop-gap is a side table or a declared deviation.
- Installed platform migrations are byte copies proven by `prisma/platform.lock`; `npm run db:check` fails on any byte change. New raw-SQL index: also add `{ name, definition }` (exactly `pg_indexes.indexdef`) to `rawSqlIndexes` in `prisma/platform.lock`; the lock's `deviations` are tied to the baseline and never grow afterwards.
- Every dump and restore keeps `--enable-row-security` **and** `PGOPTIONS=-c app.rls_bypass=on`.

Check commands (after E2): `cd apps/api && npm run db:compose && npm run db:check && npm run db:drift`.
