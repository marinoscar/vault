# Runbook: Generated infrastructure (`infra/`) and the sync

`infra/` is rendered from `@marinoscar/platform-infra` (pinned in the root `package.json`) with the app identity in `packages/shared/identity.json`. Nothing in `infra/` is edited by hand. This runbook covers the sync, what is generated and what is app-owned, how an app change is made, and what to do when the check fails. The package's own reference: `node_modules/@marinoscar/platform-infra/README.md` (installed with the root dependencies).

## 1. Commands

```bash
npm run platform:infra:sync              # render infra/ and write infra/platform-infra.lock.json
npm run platform:infra:sync -- --check   # write nothing; exit 1 on drift (CI job "Infra Check")
```

The script runs `platform-infra sync` from `node_modules/.bin`, so `npm ci` (or `npm install`) must have run first. Commit the regenerated files together with any version bump of `@marinoscar/platform-infra`.

## 2. Generated or app-owned

| Generated (header `GENERATED from @marinoscar/platform-infra`; never edit) | App-owned (created once from an example, then yours) |
|---|---|
| `infra/compose/{base,dev,devdb,prod,vps,worker,worker.build,test}.compose.yml`, `telemetry.compose.yml`, `vps.telemetry.compose.yml`, `postgres-init/10-application-role.sh` | `infra/compose/app.*.compose.yml` overlays (applied after every platform file, sorted by name) |
| `infra/compose/.env.example`, `.env.worker.example` | `infra/compose/app.env.example` (appended to `.env.example`) |
| `infra/nginx/{nginx.conf,csp.conf,csp.dev.conf}`, `infra/nginx/platform/*` | `infra/nginx/app.d/` (`locations/`, `server/`, `http/`, `csp/`, `permissions-policy.conf`) |
| `infra/otel/otel-collector-config.yaml` | `infra/otel/app-collector.yaml` |
| `infra/platform-infra.lock.json` | `infra/compose/app.example.compose.yml` (inert example) |

Sync never overwrites an app-owned file. `infra/compose/postgres-init/20-*.sh` is also app-owned if added.

## 3. Vault's overlays

The platform's `base.compose.yml` builds `api` and `web` from the repository root (`context: ../..`, `dockerfile: apps/<name>/Dockerfile`), and so does Vault: its Dockerfiles install from the root lockfile and copy every `packages/*` workspace, so no build or source-mount overlay is needed. CI builds both production images (`docker-build` job). The legacy `infra/deploy` compose uses the same root context; `update.sh` migrates an older install's `compose.yml` in place.

| File | Applies to | What it does |
|---|---|---|
| `app.vps.no-stack-agent.compose.yml` | vps | Puts `stack-agent` in the `disabled` profile: Vault has no `apps/stack-agent`. |
| `app.env.example` | `.env.example` | Vault's own variables: `VAULT_ENCRYPTION_KEY`, `CARD_IMAGE_MAX_BYTES` (and `OTEL_DEBUG`). The object-store variables are gone since E6.1: storage is runtime configuration ([storage-config-migration](storage-config-migration.md)). |
| `infra/nginx/app.d/server/body-size.conf` | nginx, server level | `client_max_body_size 10g`. Without it nginx's 1 MiB default refuses uploads. |
| `infra/nginx/app.d/locations/app-long-requests.conf` | nginx | Exact-match locations for `POST /api/secrets/cards/extract`, `POST /api/secrets/export` and `POST /api/admin/backups/export` with 600 s read timeouts (the generic `/api` location keeps 60 s). |

Everything else (the API and web services, Postgres, the telemetry and worker stacks, the CSP, security headers, `/api/notifications/stream`) is the platform's. Vault reads the platform's variables from `.env` through `env_file`, so a variable added to `.env` reaches the API without an overlay.

## 4. Making a change

- **A platform change** (a new compose key every app needs, a new CSP default): a new `@marinoscar/platform-infra` release, then `npm install`, then `npm run platform:infra:sync`. Never edit the generated file.
- **A Vault change**: edit the app-owned file (overlay, `app.env.example`, `app.d/`), then run the sync so the lock and `.env.example` follow. An overlay that does not merge fails the next `docker compose config`.
- **A variable**: a platform variable belongs to the platform. An app variable is `KEY=value` in `app.env.example` with its explanation on the lines above, and never a commented `# KEY=value` line (the deploy wizard reads it as a declared variable).

## 5. Validating

```bash
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml config
docker compose -f base.compose.yml -f prod.compose.yml config
docker compose -f base.compose.yml -f prod.compose.yml -f telemetry.compose.yml -f vps.compose.yml -f vps.telemetry.compose.yml -f app.vps.no-stack-agent.compose.yml config
```

`vps` needs `DEPLOY_ROOT`, `STACK_AGENT_TOKEN` and the GreptimeDB passwords in the environment (`vault deploy` writes them). The CI job `infra-check` renders every mode with placeholders. nginx is not checked in CI: `nginx -t` needs the upstream hosts, which the platform's conformance suite (`runInfraConformance`) provides when it is wired in.

## 6. Troubleshooting

- **`--check` says a generated file differs** from the package: someone edited it. Run `npm run platform:infra:sync` and move the change into the overlay the message names.
- **`records a different checksum`**: the lock was not rewritten after a change. Run the sync.
- **`is not executable`** on `postgres-init/10-application-role.sh`: a mode bit was lost. Run the sync and commit the mode.
- **nginx: `open() "/etc/nginx/app.d/permissions-policy.conf" failed`**: the app-owned file is missing; the sync recreates it.
- **A changed `app.d/` file is not served**: nginx reads its configuration at start. Recreate nginx: `docker compose ... up -d --force-recreate nginx`.
- **Postgres role**: the platform's `10-application-role.sh` creates the role named by `APP_DB_USER` on the first start of an empty volume. The template's `POSTGRES_USER` is `app`; Vault's documentation and CI use `vault_app`. Set `POSTGRES_USER=vault_app` in `.env` to keep it (see [application-role runbook](application-role.md)).

## 7. Deployment

The VPS deployment is `vault deploy` from the platform CLI. The scripts in `infra/deploy/` are the pre-platform deploy and are deprecated; they are kept until `vault deploy` replaces them ([local-exceptions](../platform-adoption/local-exceptions.md)).
