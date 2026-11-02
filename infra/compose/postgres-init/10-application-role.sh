#!/bin/sh
# =============================================================================
# Creates the ORDINARY role the Vault API connects as (issue #75, E2.3)
# =============================================================================
#
# Row-level security is inert for a superuser or a BYPASSRLS role: every policy,
# FORCE included, is skipped. The postgres image makes POSTGRES_USER a
# superuser, so a database that runs this script keeps that bootstrap login as
# `postgres` (administration only) and the role the API runs as is created here:
#
#   NOSUPERUSER NOBYPASSRLS  so the tenant-isolation policies on storage_objects
#                            and storage_object_chunks apply to it;
#   CREATEDB                 so database restore and the real-Postgres tests can
#                            create and drop scratch databases;
#   CREATEROLE               so a later slice can mint per-job roles
#                            (createrole_self_grant makes them inherit-and-set).
#
# It owns the application database and schema public, which makes it the owner
# of every table the migrations create (FORCE ROW LEVEL SECURITY is what applies
# the policies to an owner). The `uuid-ossp` extension is "trusted", so the
# role's first `prisma migrate deploy` can create it.
#
# Runs once, on the first start of an empty data volume (the image's
# /docker-entrypoint-initdb.d contract), and can be run by hand against any
# Postgres: it connects with the standard libpq variables (PGHOST, PGPORT,
# PGPASSWORD) when they are set, and to the local socket otherwise. Set
# APP_DB_USER to "postgres" (or leave it unset) to opt out: the API then runs as
# a superuser and tenant isolation is NOT enforced. Existing databases are not
# touched: see docs/runbooks/application-role.md.
#
# Required environment: APP_DB_USER, APP_DB_PASSWORD, POSTGRES_DB.
# =============================================================================
set -eu

if [ -z "${APP_DB_USER:-}" ] || [ "${APP_DB_USER}" = "postgres" ]; then
  echo "application role: APP_DB_USER is unset or 'postgres'; the API will run as a superuser and row-level security will be inert"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username postgres --dbname "${POSTGRES_DB:?POSTGRES_DB is required}" \
  -v app_user="${APP_DB_USER}" -v app_password="${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}" -v app_db="${POSTGRES_DB}" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE;
ALTER DATABASE :"app_db" OWNER TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
-- PostgreSQL 16: a CREATEROLE role that is not a superuser is given ADMIN on a
-- role it creates, but neither INHERIT nor SET. This makes every role it
-- creates inherit-and-set for it.
ALTER ROLE :"app_user" SET createrole_self_grant = 'inherit, set';
SQL

echo "application role: created ${APP_DB_USER} (NOSUPERUSER NOBYPASSRLS), owner of ${POSTGRES_DB}"
