#!/usr/bin/env bash
# Builds the PRE-baseline Vault database in an empty database: only the seven
# migrations Vault had before adopting the platform history, recorded in
# _prisma_migrations exactly as `prisma migrate deploy` records them, plus the
# invented rows of test/prisma/fixtures/pre-baseline-data.sql.
#
# It is the CI "baseline rehearsal" (see .github/workflows/ci.yml) and the
# local way to rehearse docs/runbooks/database-baseline.md without a backup:
#
#   createdb vault_rehearsal
#   POSTGRES_DB=vault_rehearsal bash scripts/baseline-rehearsal.sh
#   POSTGRES_DB=vault_rehearsal npm run db:baseline -- --through 2 --allow-rls
#
# Reads POSTGRES_HOST / PORT / USER / PASSWORD / DB (the same variables the
# app uses). Refuses a database that already has tables.
set -euo pipefail

cd "$(dirname "$0")/.."

export PGHOST="${POSTGRES_HOST:-localhost}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGUSER="${POSTGRES_USER:-postgres}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
export PGDATABASE="${POSTGRES_DB:?POSTGRES_DB must name an EMPTY database}"

# The migrations production had applied before E2. Never edit this list: these
# directories are installed history.
ORIGINAL_MIGRATIONS=(
  20260124223146_initial
  20260329151231_add_personal_access_tokens
  20260403120000_add_secrets_and_versions
  20260403235813_add_media_folders
  20260404000000_add_secret_name_user_unique
  20260727120000_version_scoped_attachments
  20261102120000_add_backup_schedules
)

existing=$(psql -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$existing" != "0" ]; then
  echo "baseline-rehearsal: database $PGDATABASE is not empty ($existing tables); refusing." >&2
  exit 1
fi

psql -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
SQL

for dir in "${ORIGINAL_MIGRATIONS[@]}"; do
  file="prisma/migrations/$dir/migration.sql"
  [ -f "$file" ] || { echo "baseline-rehearsal: missing $file" >&2; exit 1; }
  psql -q -v ON_ERROR_STOP=1 -1 -f "$file" >/dev/null
  checksum=$(sha256sum "$file" | cut -d' ' -f1)
  psql -q -v ON_ERROR_STOP=1 -c "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (gen_random_uuid()::text, '$checksum', now(), '$dir', 1)"
  echo "applied $dir"
done

psql -q -v ON_ERROR_STOP=1 -f test/prisma/fixtures/pre-baseline-data.sql
echo "baseline-rehearsal: pre-baseline database ready in $PGDATABASE"
