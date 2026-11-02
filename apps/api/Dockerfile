# =============================================================================
# API Dockerfile - Multi-stage build
# =============================================================================
# IMPORTANT: the build context is the REPOSITORY ROOT, not apps/api.
#
# apps/api is an npm workspace member (it depends on `@app/shared` and, later,
# on the other packages under packages/) and has no lockfile of its own; the
# only package-lock.json lives at the repo root. Building from the root makes
# the workspace packages and that lockfile visible, so every stage installs
# with `npm ci` and the workspace links resolve. With the app directory as the
# context there is no workspace in the image and npm looks for `@app/shared`
# on the public registry (issue #144).
#
#   docker build -f apps/api/Dockerfile --target production .
#
# Adding a workspace package under packages/ needs NO change here: the install
# layer selects every packages/* directory and the build step compiles each one
# that has a `build` script. See .dockerignore for what the context excludes.
# =============================================================================

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
# Install OpenSSL for Prisma compatibility.
#
# `postgresql17-client` is pg_dump, pg_restore and psql, for the platform db-backup slice
# (whole-database backup and restore, E9.1). It is in the BASE stage so development and
# production both have it. THE MAJOR IS PINNED EXPLICITLY, never the floating
# `postgresql-client` meta-package: pg_dump REFUSES a server newer than itself, and a
# base-image refresh must not move the client silently. A newer client dumping an older
# server is supported. The pin is asserted against the platform's floor
# (`MIN_PG_CLIENT_MAJOR`) by test/pg-client-version.spec.ts.
RUN apk add --no-cache openssl openssl-dev postgresql17-client
RUN corepack enable

# -----------------------------------------------------------------------------
# Dependencies stage
# -----------------------------------------------------------------------------
FROM base AS deps
# Every workspace manifest is required: `npm ci` validates the whole workspace
# set against the lockfile, even when installing a single workspace.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# Every workspace package under packages/ (`@app/shared` today, the vault-*
# packages later): whole directories, not just manifests. The workspace
# symlinks in node_modules point into packages/, and every later stage inherits
# them through `COPY --from=deps /app ./`, production included. A symlink to an
# empty directory builds clean and dies at boot with ERR_MODULE_NOT_FOUND.
COPY packages ./packages/
# Root build helpers the package build scripts call (scripts/vault-packages/*.mjs).
COPY scripts ./scripts/
# Prisma schema and config are needed by `prisma generate` below. prisma.config.ts
# requires scripts/prisma-env.js (it derives DATABASE_URL from POSTGRES_*), so
# that one file travels with it; the rest of the scripts reach production later.
COPY apps/api/prisma ./apps/api/prisma/
COPY apps/api/prisma.config.ts ./apps/api/
COPY apps/api/scripts/prisma-env.js ./apps/api/scripts/
# Install this app plus EVERY packages/* workspace (their devDependencies are
# needed by the builds below), from the root lockfile. The list is derived, not
# written out, so a new package needs no edit here.
RUN set -e; \
    ws=""; \
    for d in packages/*/; do ws="$ws --workspace=${d%/}"; done; \
    npm ci --workspace=api $ws --include-workspace-root --ignore-scripts
# --ignore-scripts skips Prisma's postinstall, so generate the client
# explicitly. DATABASE_URL is a build-time placeholder; `generate` reads the
# schema only and never opens a connection.
RUN cd apps/api && \
    DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate
# Compile the workspace packages (those with a `build` script) into their
# dist/, which their `exports` maps point at. vault-contract and vault-db build
# first because the others depend on them (vault-api also types against the
# Prisma client generated above); the rest follow alphabetically, each once.
RUN set -e; built=""; \
    for d in packages/vault-contract/ packages/vault-db/ packages/*/; do \
      case " $built " in *" $d "*) continue ;; esac; built="$built $d"; \
      [ -d "$d" ] || continue; \
      npm run build --if-present --workspace="${d%/}"; \
    done

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
# Brings node_modules and the built packages, plus the manifests
COPY --from=deps /app ./
COPY scripts ./scripts
COPY apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app ./
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage
# -----------------------------------------------------------------------------
FROM base AS production
COPY --from=deps /app ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma/
COPY apps/api/prisma.config.ts ./apps/api/
# The email brand mark (assets/email/logo.png) is read at runtime from beside dist/.
COPY apps/api/assets ./apps/api/assets/
# The migration entry points are npm scripts that shell into this directory:
# `prisma:migrate` is `node scripts/prisma-env.js migrate deploy`, resolved
# from the WORKDIR below. Without it the image starts perfectly and then cannot
# migrate, which is only discovered by whatever tries to deploy it.
COPY apps/api/scripts ./apps/api/scripts/
COPY scripts ./scripts
# The seed runs through ts-node against prisma/seed.ts, which imports shared
# constants from src/ (so the seeded options and settings cannot drift apart).
# ts-node resolves that import at runtime, so src must exist in this stage --
# dist/ is compiled JS and does not satisfy a TypeScript import path. Without
# this, `npm run prisma:seed` fails in production with TS2307.
COPY apps/api/src ./apps/api/src/
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
