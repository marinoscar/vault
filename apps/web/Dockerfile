# =============================================================================
# Web Dockerfile - Multi-stage build
# =============================================================================
# IMPORTANT: the build context is the REPOSITORY ROOT, not apps/web.
#
# apps/web is an npm workspace member (it depends on `@app/shared` and, later,
# on the other packages under packages/) and has no lockfile of its own; the
# only package-lock.json lives at the repo root. Building from the root makes
# the workspace packages and that lockfile visible, so every stage installs
# with `npm ci` (issue #144).
#
#   docker build -f apps/web/Dockerfile --target production .
#
# Adding a workspace package under packages/ needs NO change here.
# =============================================================================

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app

# -----------------------------------------------------------------------------
# Dependencies stage
# -----------------------------------------------------------------------------
FROM base AS deps
# Every workspace manifest is required: `npm ci` validates the whole workspace
# set against the lockfile, even when installing a single workspace.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# Every workspace package under packages/, whole: the workspace symlinks in
# node_modules point into packages/, and the build and development stages
# inherit them through `COPY --from=deps /app ./`. Vite inlines what it
# imports, so nginx's production stage needs nothing further.
COPY packages ./packages/
# Install this app plus EVERY packages/* workspace (their devDependencies are
# needed by the builds below), from the root lockfile. The list is derived.
RUN set -e; \
    ws=""; \
    for d in packages/*/; do ws="$ws --workspace=${d%/}"; done; \
    npm ci --workspace=web $ws --include-workspace-root
# Compile the workspace packages that have a `build` script (see the API
# Dockerfile for the ordering note).
RUN set -e; \
    for d in packages/*/; do \
      npm run build --if-present --workspace="${d%/}"; \
    done

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
# Brings node_modules and the built packages, plus the manifests
COPY --from=deps /app ./
COPY apps/web ./apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app ./
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage (nginx to serve static files)
# -----------------------------------------------------------------------------
FROM nginx:alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# 5173 is the port the platform-generated nginx upstream (`web:5173`) uses and the
# development stage exposes; 80 stays for the legacy infra/deploy path.
EXPOSE 80 5173
CMD ["nginx", "-g", "daemon off;"]
