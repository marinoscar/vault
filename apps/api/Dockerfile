# =============================================================================
# API Dockerfile - Multi-stage build
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
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts ./scripts/
# Using npm install since this is a workspace package without its own lock file
# Set dummy DATABASE_URL for Prisma generate (actual connection not needed at build time)
RUN npm install --ignore-scripts && \
    DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage
# -----------------------------------------------------------------------------
FROM base AS production
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts ./scripts/
# The email brand mark (assets/email/logo.png) is read at runtime from beside dist/.
COPY assets ./assets/
# The seed runs through ts-node against prisma/seed.ts, which imports shared
# constants from src/ (so the seeded secret-type options and the AI request
# schema cannot drift apart). ts-node resolves that import at runtime, so src
# must exist in this stage -- dist/ is compiled JS and does not satisfy a
# TypeScript import path. Without this, `npm run prisma:seed` fails in
# production with TS2307 while passing everywhere else.
COPY src ./src/
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
