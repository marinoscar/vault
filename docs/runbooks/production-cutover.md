# Runbook: Upgrade a Live Pre-Platform Vault to the Platform (Production Cutover)

**Start here.** This is the one ordered checklist for taking a live, pre-platform Vault production deployment to current `main`. It links to the detailed runbooks for the internals ([database-baseline](database-baseline.md), [application-role](application-role.md), [ai-key-migration](ai-key-migration.md), [ai-platform-migration](ai-platform-migration.md), [settings-migration](settings-migration.md), [storage-config-migration](storage-config-migration.md), [database-restore](database-restore.md), [infra-sync](infra-sync.md)) and does not repeat them. When this guide and a detailed runbook disagree on **order**, this guide wins; on **mechanics**, the detailed runbook wins (and tell the maintainer).

Audience: the owner, alone, in a maintenance window. Rehearse first (section 5), then run section 6.

Source of truth for every command below: `apps/api/package.json` (scripts), `apps/api/scripts/*`, `infra/compose/*.compose.yml`, `infra/compose/.env.example`, the `vault deploy` engine of `@marinoscar/platform-cli` (pinned `0.1.0-next.21`; its runbook is EnterpriseAppBase `docs/runbooks/deploy-to-vps.md`) and `infra/deploy/*` (the legacy path). Anything not provable from those is marked **confirm on the rehearsal**.

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Go / no-go criteria](#2-go--no-go-criteria)
3. [Prerequisites](#3-prerequisites)
4. [Environment changes](#4-environment-changes)
5. [Rehearsal on staging](#5-rehearsal-on-staging)
6. [Production steps](#6-production-steps)
7. [Rollback](#7-rollback)
8. [After the cutover](#8-after-the-cutover)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Purpose and scope

| | |
|---|---|
| **From** | The MonoRepo-era app: installed by `infra/deploy/install-vault.sh`, updated by `update.sh`, at `/opt/infra/apps/vault/` (`.env`, `compose.yml`, `repo/`), containers `vault-api`, `vault-web`, `vault-nginx` on `127.0.0.1:8322` behind the shared `proxy-nginx`; Prisma 5; the 7 original migrations in `_prisma_migrations`; secrets encrypted under `VAULT_ENCRYPTION_KEY`; an external PostgreSQL reached as a provider admin login; object storage configured by `STORAGE_PROVIDER`/`S3_*`/`AWS_*` variables; the OpenAI key stored in `system_settings` |
| **To** | Current `main` at one pinned commit (`$RELEASE_SHA`): the `@marinoscar/platform-*` and `@marinoscar/vault-*` packages, Prisma 7, 48 migrations (40 platform, of which 0001 and 0002 are the ones already applied, plus 8 Vault domain), organizations and row-level security (RLS), an ordinary database role, runtime-configured storage and AI, the job queue, the Doctor, deployed and updated by `vault deploy` |
| **What changes in the data** | Platform migrations 0003 to 0040 plus three Vault migrations are applied (41 in all); a default organization and one membership per user are created; `contributor` and `viewer` roles move from `user_roles` to memberships; `storage_objects` and chunks get `org_id` (backfilled); `media_folder_id` moves into `media_folder_files`; `secret_attachments` gets `org_id`. Secret ciphertext is **not** touched |
| **One-way** | 0024, 0025 and the media migration are forward-only. After `prisma:migrate` the only way back is to restore the `pg_dump` from step 6.4 (section 7), which loses every write made after the dump |
| **Expected window** | **Unknown until you measure it.** Record the wall-clock time of every step on the rehearsal (table in section 5.3) and announce the window as the rehearsal total times roughly 2. The long parts are the image build and `prisma:migrate` (0025 backfills in one transaction) |

Out of scope: moving to a new server, changing the domain, turning on multi-organization mode (`TENANCY_MODE` stays `single`).

---

## 2. Go / no-go criteria

**Go** only when **all** are true. Any "no" means the window is postponed, not shortened.

- [ ] A rehearsal ran end to end on a staging server restored from a **real, recent production `pg_dump`** (not the `baseline-rehearsal.sh` fixture), at the same `$RELEASE_SHA` you will deploy.
- [ ] The rehearsal record (section 5.3 / [database-baseline §12](database-baseline.md#12-rehearsal-record)) is filled in and kept with the PR or issue.
- [ ] The baseline dry run on staging said `0 blocking, 49 declared`, and the production dry run (step 6.9) is byte-identical to it.
- [ ] `verify-vault-data.ts` on staging reported **0 decrypt failures** with a sample of at least 50 and every other check `ok`.
- [ ] Every data-move command's dry run on staging gave an outcome you understand (`would-migrate`, `nothing-to-migrate`, ...), and the apply was clean on a second dry run (idempotent).
- [ ] The smoke tests of step 6.19 passed on staging as an admin **and** a contributor.
- [ ] You have a verified production `pg_dump` taken on the day, stored off the server, and you have read section 7.
- [ ] The key material is safe: `VAULT_ENCRYPTION_KEY` is stored outside the server (password manager) and is the exact value in the live `.env`.
- [ ] The window is announced and nobody else is changing the server.

---

## 3. Prerequisites

| Need | Check |
|---|---|
| **Server access** | SSH to the VPS as the **ordinary account that owns `/opt/infra/apps/vault`** (`ls -ld /opt/infra/apps/vault`), a member of the `docker` group. **Never run `vault deploy` or `vault` with `sudo`** (it resets `HOME`; the clone, `.env` and state would end up root-owned) |
| **Database access** | The provider **administrative login** (the `POSTGRES_USER` of the old `.env`, e.g. `admin`) and its password, from a host that reaches the database. Run `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user;`: a superuser can run `transfer-ownership.sql` as is; a non-superuser managed login needs the manual path in [application-role §1](application-role.md#1-prerequisites) (**rehearse it**) |
| **Client tools on the host** | `psql`, `pg_dump`, `pg_restore`, `createdb`, all with a major version **at least the server's** (`pg_dump --version`; `psql -Atc 'show server_version'`). The API image carries `postgresql17-client` |
| **A backup location** | A directory on the host (`/backups`) **and** an off-host copy (object storage, your laptop). Space for 2 dumps. The dump holds every secret ciphertext and user row: protect it like the key |
| **The new `vault` CLI** | `curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/apps/cli/install.sh \| bash` (clones to `~/.vault-cli`, builds, links `/usr/local/bin/vault`). Needs Node.js 20 or newer and git **on the host**; the images build with Node 24 inside Docker. `vault --version` and `vault deploy --help` must work. Record the version |
| **Docker** | Engine with the **Compose v2 plugin** (`docker compose version`), free disk for a rebuild (`df -h`; the doctor requires headroom) and memory: the new stack also starts GreptimeDB and an OTel collector (`free -h`). **Confirm on the rehearsal** how much RAM the whole stack uses |
| **The release** | One commit SHA of `main` (`$RELEASE_SHA`) that CI is green on, used for rehearsal **and** production. Never "latest main" in the window |
| **DNS / TLS** | Unchanged. The domain, the A record, the certificate in `/opt/infra/proxy/letsencrypt/live/<domain>/` and `proxy-nginx` stay. `vault deploy` re-renders the vhost for the **same** `127.0.0.1:8322` upstream (step 6.21) |
| **OAuth** | The Google redirect URI `https://vault.example.test/api/auth/google/callback` is unchanged for production. For staging, register the staging URI on a **separate** OAuth client |
| **Git remote** | The repository URL and ref the old install cloned (`git -C /opt/infra/apps/vault/repo remote get-url origin`). If it is private and HTTPS, `gh` must be installed and logged in as the same account |
| **Two terminals** | One for commands, one tailing logs. Keep the shell open: its variables (section 6.1) carry the whole window |

---

## 4. Environment changes

The new env file lives at **`/opt/infra/apps/vault/repo/infra/compose/.env`** (mode `0600`). The old one is `/opt/infra/apps/vault/.env`; it is moved to `.env.legacy` in step 6.12 and kept for rollback. (`vault deploy` reads and writes the file in the checkout's compose directory; the legacy path at the deployment root is what it falls back from.)

Do **not** start from the old file's `COMPOSE_PROJECT_NAME`: the deploy never writes it and it would make the new images overwrite the old `vault-api` / `vault-web` image tags you want for rollback.

### 4.1 New or changed (you set these)

| Variable | Value | How to generate / why |
|---|---|---|
| `SECRETS_ENCRYPTION_KEY` | **new, required** | `openssl rand -base64 32` (base64 that decodes to exactly 32 bytes; the API refuses a malformed value at boot). Encrypts the object-storage secret key, the OpenAI key, SMTP and VAPID in the credential store. **Different from `VAULT_ENCRYPTION_KEY`; never reuse one for the other; never change it afterwards.** Store it in the password manager **before** the window |
| `POSTGRES_USER` | `vault_app` (was the provider admin) | The ordinary role of [application-role](application-role.md): `NOSUPERUSER NOBYPASSRLS`, owns the tables. RLS is inert for a superuser; the Doctor check `db.rls_role` fails otherwise |
| `POSTGRES_PASSWORD` | new, for `vault_app` | `openssl rand -hex 24` (hex avoids URL-encoding surprises; the API URL-encodes anyway) |
| `APP_BIND_PORT` | `8322` | The loopback port the **existing** proxy vhost forwards to. The new nginx publishes `127.0.0.1:${APP_BIND_PORT}`. Without it the default is `3535` and the proxy would 502 |
| `ALLOWED_MIME_TYPES` | empty (`ALLOWED_MIME_TYPES=`) | The old value `image/*,application/pdf,video/*` was **never enforced**. It is now (`415` for any other type). Empty keeps today's behaviour; tighten later on purpose |

### 4.2 Written by `vault deploy` (do not set)

| Variable | Notes |
|---|---|
| `DEPLOY_ROOT` | Written by `update` (`/opt/infra/apps/vault`) |
| `STACK_AGENT_TOKEN` | Generated (`openssl rand -hex 32` equivalent). The Vault overlay `app.vps.no-stack-agent.compose.yml` disables the `stack-agent` container, but compose still requires the variable |
| `GREPTIME_WRITER_PASSWORD`, `GREPTIME_READER_PASSWORD`, `GREPTIME_ADMIN_PASSWORD`, `GREPTIME_BIND_PG_PORT` and the other `GREPTIME_*` | Generated on `update` (telemetry ships with every VPS deploy; nothing is collected until an admin enables it at `/admin/settings/telemetry`). **Confirm on the rehearsal** that no `change-me-*` placeholder remains in `.env` afterwards |

### 4.3 New, optional (the template default is right; do not add them)

`TENANCY_MODE` (unset = `single`; **keep it**), `DEPLOYMENT_MODE` (`self-hosted`: in-app database backup **and restore** on), `DEPLOYMENT_NETWORK`, `EVENT_BUS_ADAPTER` (`postgres`; needs a direct or session-mode connection, not a transaction pooler), `POSTGRES_MONITOR_USER` / `POSTGRES_MONITOR_PASSWORD` (blank reuses the API login), `AUTH_PRINCIPAL_CACHE_TTL_SECONDS`, `DEVICE_TOKEN_EXPIRY_DAYS`, `DEVICE_PAT_EXPIRY_DAYS`, `CORS_ORIGIN`, `MAINTENANCE_MODE` (break-glass; prose in `.env.example`), `JOBS_*`, `NODE_*`, `DB_BACKUP_SCHEDULE_ENABLED`, `SES_REGION`. `update` leaves absent optional keys alone and says "nothing new".

### 4.4 Removed

| Variable | When to remove | Why |
|---|---|---|
| `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | After step 6.15 (storage import) | Not read any more. Storage is runtime configuration at `/admin/settings/storage`; the Doctor check `vault.storage_env` warns while they remain |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Same | Imported into the credential store (`storage` / `default`) |
| `COMPOSE_PROJECT_NAME` | When you build the new env (step 6.5) | See above |
| any OpenAI key variable | n/a | The old app never read one: its key lives in `system_settings`, moved by steps 6.13 and 6.14. If one is present, remove it |
| `UPTRACE_DSN`, `CLICKHOUSE_*` | n/a | The Uptrace stack is gone (GreptimeDB replaced it). Absent from the production template |
| `VAPID_*` | n/a | Web Push is configured at `/admin/settings/push` |

### 4.5 Unchanged and critical (copy byte for byte)

| Variable | Rule |
|---|---|
| `VAULT_ENCRYPTION_KEY` | **Byte-identical.** 64 hex characters. A different value makes every secret unreadable, permanently. Verify with `sha256sum` of the value on both files (step 6.5) |
| `JWT_SECRET`, `COOKIE_SECRET` | Keep. Changing them signs every user out |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `APP_URL`, `INITIAL_ADMIN_EMAIL` | Keep |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_SSL` | Keep (SSL stays `true` on a managed database). **They must name production.** |
| `NODE_ENV=production`, `PORT=3000`, `MAX_FILE_SIZE`, `SIGNED_URL_EXPIRY`, `STORAGE_PART_SIZE`, `CARD_IMAGE_MAX_BYTES`, `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`, `DEVICE_CODE_*`, `OTEL_ENABLED`, `LOG_LEVEL` | Keep. Leave `OTEL_ENABLED` as it was (`false`) for the cutover |

Pre-window check of the staged file against the release template (no checkout needed):

```bash
git -C $VAULT_DIR/repo fetch origin
git -C $VAULT_DIR/repo show $RELEASE_SHA:infra/compose/.env.example > /tmp/env.example.new
diff <(grep -E '^[A-Z][A-Z0-9_]*=' /tmp/env.example.new | cut -d= -f1 | sort) \
     <(grep -E '^[A-Z][A-Z0-9_]*=' $VAULT_DIR/env.next | cut -d= -f1 | sort)
```

Lines starting `<` are keys the file lacks. Expect only the `GREPTIME_*`, `STACK_AGENT_TOKEN`, `DEPLOY_ROOT`-class keys and the optional keys of 4.3. A missing **essential or secret** key (for example `SECRETS_ENCRYPTION_KEY`) would make `update` ask for it.

---

## 5. Rehearsal on staging

Run **sections 6.1 to 6.20 verbatim** on a staging server restored from the latest production backup. Every command is the same; only these inputs differ.

### 5.1 How staging differs

| Input | Staging value |
|---|---|
| Database | A **separate cluster** if possible; otherwise a separate database (`vault_staging`) on the same cluster. Restore: `createdb vault_staging && pg_restore --no-owner --no-acl --exit-on-error -d vault_staging /backups/vault-<date>.dump`. Owner after restore is the restoring login, as production is today. `POSTGRES_DB` must say `vault_staging`: **read it twice** |
| The `vault_app` role | Cluster-wide. If staging shares the production cluster, the role is shared: reuse it, do not recreate it (use `ALTER ROLE vault_app PASSWORD ...` only if you accept that production's `.env` changes with it) |
| Host and domain | A throwaway VPS, or the same VPS with `--root /opt/infra/apps/vault-staging`, `APP_BIND_PORT` set to a free port, and `--skip-proxy` on `vault deploy update`. Use `vault-staging.example.test` for `APP_URL` and the OAuth callback, registered on a separate Google OAuth client |
| `VAULT_ENCRYPTION_KEY` | The real production key (otherwise the decrypt sample proves nothing). **Treat the staging server and database as production-sensitive** and destroy them afterwards |
| Object storage | A **copy** of the bucket (`aws s3 sync` to a staging bucket) with its own key pair, never the production bucket with a write-capable key: the storage import copies the bucket into settings, and a staging scheduled backup or attachment deletion would act on production objects. If you cannot copy the bucket, use a read-only key and skip the upload/delete smoke tests, and say so in the record |
| Schedules | Turn off the Vault admin backup schedule on staging (`/admin/settings/backups`) before the first start so it does not write to the bucket |
| AI | The real OpenAI key is fine (a few calls); or skip card scan and say so |
| Legacy stack | If you also want to prove rollback, bring the old app up first against the restored copy (`docker compose -f compose.yml up -d`), then follow section 6 from step 6.1 |
| Proxy / certificate / `--skip-renewal` | Skipped or exercised against staging only. Step 6.21 (proxy) is **only proven on production**; the first production run of that step is the one real unknown. See its note |

### 5.2 Also rehearse the rollback

After the smoke tests pass, run section 7 once on staging (restore the pre-migration dump into a fresh database, point the old env at it, start the legacy stack). A rollback you never ran is a guess.

### 5.3 Rehearsal record

Copy of [database-baseline §12](database-baseline.md#12-rehearsal-record) plus this guide's fields. Fill it in per rehearsal and keep it with the PR.

| Field | Value |
|---|---|
| Date and who | |
| Source | restored production backup `<id>` |
| `$RELEASE_SHA` / `vault --version` | |
| Postgres version (server / client) | |
| B3 numbers (step 6.9) | expected `0 blocking, 49 declared` |
| Role: `vault_app` created, ownership transferred (seconds) | |
| `prisma:migrate` duration, 0025 duration | |
| Row counts before / after (users, secrets, versions, attachments, objects, media links) | |
| `verify-vault-data.ts` counts (before / after) | |
| Decrypt sample size / failures | expected 0 failures |
| Permissions per role before / after (`GET /api/auth/me`) | |
| `ai-key` / `ai-platform` / `settings` / `storage` dry-run outcomes | |
| Fresh-database `db:drift` | |
| Image build duration; `vault deploy update` duration | |
| Peak memory of the full stack | |
| Doctor result (failures / warnings) | |
| Smoke tests as admin / contributor | |
| Rollback rehearsed (restore duration) | |
| Total window time | |
| Surprises / things that differed from this guide | |

---

## 6. Production steps

Conventions: `- [ ]` is a step you tick. Run commands as the account from section 3, in one shell. **If any "Expect" differs, stop and go to section 7 or 9; do not improvise forward.**

### T-1 day

- [ ] **6.0.1 Rehearsal passed.** Section 2 is all ticked, the record is complete, `$RELEASE_SHA` is the commit you rehearsed.
- [ ] **6.0.2 Announce the downtime** (users get a `502` from the shared proxy for the whole window; the old app has no maintenance mode). State the end time with margin.
- [ ] **6.0.3 Stage the new env.** Build `/opt/infra/apps/vault/env.next` from the live `.env` and section 4 (do **not** move it into place yet), then run the key diff of section 4. Keep the generated `SECRETS_ENCRYPTION_KEY` and the `vault_app` password in the password manager.

  ```bash
  umask 077
  cp /opt/infra/apps/vault/.env /opt/infra/apps/vault/env.next
  # edit env.next: section 4.1 (add SECRETS_ENCRYPTION_KEY, set POSTGRES_USER/PASSWORD, APP_BIND_PORT=8322,
  # ALLOWED_MIME_TYPES=), delete COMPOSE_PROJECT_NAME; leave the storage variables for now
  ```

- [ ] **6.0.4 Create the role and test the login from this host** (additive; nothing is owned by it yet). Use [application-role §3](application-role.md#3-create-the-role); then:

  ```bash
  PGPASSWORD='<vault_app password>' PGSSLMODE=require psql -h db.example.test -U vault_app -d vault -Atc 'select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user'
  ```

  Expect `vault_app|f|f`. A connection error here is a `pg_hba` or SSL problem: fix it today, not in the window.
- [ ] **6.0.5 Record the "before" state** (production, read-only): per-role permissions and counts, kept with the rehearsal record.

  ```bash
  vault login --server https://vault.example.test          # as an admin
  vault api GET /api/auth/me > $BACKUP_DIR/me-admin-before.json
  # sign in as a contributor in the browser and save /api/auth/me from the Network tab as me-contributor-before.json
  ```

  Counts query (run in step 6.4 as well, saved next to the dump):

  ```sql
  SELECT 'users', count(*) FROM users UNION ALL SELECT 'secrets', count(*) FROM secrets
  UNION ALL SELECT 'secret_versions', count(*) FROM secret_versions
  UNION ALL SELECT 'attachments', count(*) FROM secret_attachments
  UNION ALL SELECT 'storage_objects', count(*) FROM storage_objects
  UNION ALL SELECT 'media_links', count(*) FROM storage_objects WHERE media_folder_id IS NOT NULL
  UNION ALL SELECT 'roles:' || r.name, count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id GROUP BY r.name;
  ```

- [ ] **6.0.6 Doctor, read-only, on production** (changes nothing): `vault deploy doctor --root /opt/infra/apps/vault --domain vault.example.test`. Expect only failures you already understand from the rehearsal (the database login is still a superuser). Fix anything else today.
- [ ] **6.0.7 Check the host:** `df -h /var/lib/docker /opt`, `free -h`, `docker compose version`, no pending `unattended-upgrades` reboot.

### The window

- [ ] **6.1 Open the window and set the shell.** Keep this shell for the whole window.

  ```bash
  export VAULT_DIR=/opt/infra/apps/vault
  export COMPOSE_DIR=$VAULT_DIR/repo/infra/compose
  export RELEASE_SHA=<the 40-character commit you rehearsed>
  export BACKUP_DIR=/backups
  export PGHOST=db.example.test PGPORT=5432 PGSSLMODE=require
  export DBNAME=vault ADMIN_USER=<the provider admin login>
  read -rs -p 'admin password: ' ADMIN_PASSWORD; echo
  dc()  { ( cd "$COMPOSE_DIR" && docker compose -f base.compose.yml -f prod.compose.yml "$@" ); }   # run in the new checkout
  api() { dc run --rm --no-deps -T api "$@"; }                                                       # one-off API container
  ```

  `api` runs the **new image** with the new `.env`; it never starts nginx or web. (If `vault deploy` settles on a compose project name other than the folder default, **confirm on the rehearsal** with `docker compose ls`; a mismatch only costs a rebuild from cache.)

- [ ] **6.2 Record how to get back, then stop the old stack.** The containers are *stopped*, not removed, so the quickest rollback is `start`.

  ```bash
  export OLD_SHA=$(git -C $VAULT_DIR/repo rev-parse HEAD); echo "OLD_SHA=$OLD_SHA"      # write it down
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E '^vault-(api|web)'  # note the image names
  docker tag vault-api:latest vault-api:pre-platform && docker tag vault-web:latest vault-web:pre-platform
  docker compose -f $VAULT_DIR/compose.yml stop
  docker ps --format '{{.Names}}' | grep -E '^vault-' || echo "legacy stack stopped"
  ss -tlnp | grep ':8322' || echo "port 8322 free"
  ```

  Expect `legacy stack stopped` and `port 8322 free`. The site now answers `502`. The window is open.

- [ ] **6.3 Check `POSTGRES_*` names production, twice.** Rehearsal mistakes happen here.

  ```bash
  grep -E '^POSTGRES_(HOST|PORT|DB|SSL|USER)=' $VAULT_DIR/.env
  echo "$PGHOST $DBNAME"
  PGPASSWORD=$ADMIN_PASSWORD psql -U $ADMIN_USER -d $DBNAME -Atc "select current_database(), inet_server_addr(), (select count(*) from users), (select count(*) from secrets)"
  ```

  Expect the production database and the production counts. Anything else: stop.

- [ ] **6.4 Take the rollback dump and verify it.** This is the only way back.

  ```bash
  export DUMP=$BACKUP_DIR/vault-$(date -u +%Y%m%dT%H%M%SZ).dump
  pg_dump --version; PGPASSWORD=$ADMIN_PASSWORD psql -U $ADMIN_USER -d $DBNAME -Atc 'show server_version'
  PGPASSWORD=$ADMIN_PASSWORD pg_dump -Fc -U $ADMIN_USER -d $DBNAME -f "$DUMP"
  ls -l "$DUMP" && sha256sum "$DUMP" | tee "$DUMP.sha256"
  pg_restore --list "$DUMP" | grep -c 'TABLE DATA'                       # a count of table-data entries, not 0
  pg_restore --list "$DUMP" | grep -E 'TABLE DATA public (secrets|secret_versions|users|storage_objects) '
  ```

  Expect a non-empty file, four `TABLE DATA` lines and `pg_dump` exiting 0. Copy `$DUMP` and its `.sha256` **off the server** now. Then run the counts query of 6.0.5 as the admin and save it as `$DUMP.counts.txt`.

- [ ] **6.5 Put the new code and the new env in place.**

  ```bash
  git -C $VAULT_DIR/repo fetch origin
  git -C $VAULT_DIR/repo checkout --detach $RELEASE_SHA
  git -C $VAULT_DIR/repo rev-parse HEAD                                   # must equal $RELEASE_SHA
  install -m 600 $VAULT_DIR/env.next $COMPOSE_DIR/.env
  # the secret-bearing key must be byte-identical:
  [ "$(grep '^VAULT_ENCRYPTION_KEY=' $VAULT_DIR/.env | sha256sum)" = "$(grep '^VAULT_ENCRYPTION_KEY=' $COMPOSE_DIR/.env | sha256sum)" ] && echo "VAULT_ENCRYPTION_KEY identical"
  grep -c '^SECRETS_ENCRYPTION_KEY=.' $COMPOSE_DIR/.env                   # 1
  docker network inspect devnet >/dev/null 2>&1 || docker network create devnet
  ```

  Expect `VAULT_ENCRYPTION_KEY identical` and `1`. (`devnet` is an external network in `base.compose.yml`; `vault deploy` also creates it if missing.)

- [ ] **6.6 Build the images** (the long step; record the time). Cached layers make `vault deploy update` rebuild fast later.

  ```bash
  time dc build api web
  ```

  Expect both images built, exit 0. Check that the image carries what the migration needs: `api sh -c 'ls prisma/platform.lock scripts/baseline-pre-migrate.mjs scripts/verify-vault-data.ts'`.

- [ ] **6.7 Transfer ownership to `vault_app`** ([application-role §4](application-role.md#4-transfer-ownership)). Needs the superuser; the API is already stopped.

  ```bash
  PGPASSWORD=$ADMIN_PASSWORD psql -v ON_ERROR_STOP=1 -v app=vault_app \
    -h $PGHOST -p $PGPORT -U $ADMIN_USER -d $DBNAME \
    -f $VAULT_DIR/repo/apps/api/scripts/transfer-ownership.sql
  ```

  Expect the last line `transfer-ownership: done; the database and every application-owned object belong to the role`. Then:

  ```bash
  PGPASSWORD=$ADMIN_PASSWORD psql -U $ADMIN_USER -d $DBNAME -Atc "select rolsuper, rolbypassrls from pg_roles where rolname='vault_app'"                           # f|f
  PGPASSWORD=$ADMIN_PASSWORD psql -U $ADMIN_USER -d $DBNAME -Atc "select count(*) from pg_tables where schemaname='public' and tableowner <> 'vault_app'"              # 0
  ```

  The `org_id IS NULL` precondition in application-role §1 applies to the *post*-baseline database; skip it here (the column does not exist yet). From this step everything runs as `vault_app` (the new `.env` already holds it).

- [ ] **6.8 Prove the migration tooling can see the database** (read-only):

  ```bash
  api npm run db:test                       # connects with POSTGRES_* from .env
  ```

  Expect a successful connection as `vault_app`.

- [ ] **6.9 Baseline dry run: the gate.** Writes nothing.

  ```bash
  api npm run db:baseline:pre-migrate | tee $BACKUP_DIR/baseline-dry-run-prod.txt
  diff $BACKUP_DIR/baseline-dry-run-prod.txt <the rehearsal's baseline-dry-run.txt> && echo IDENTICAL
  ```

  Expect, line for line the same as the rehearsal and [database-baseline §4](database-baseline.md#4-the-dry-run-and-the-declared-deviations):

  ```
  B1 map: 2 matched, 0 unmatched ...
  B2 ledger: managed by Prisma Migrate; 0 problem(s)
  B3 diff (...to platform:0002...): 0 blocking, 49 declared
  B4 raw-SQL indexes: 0 problem(s)
  B4 row-level security: 0 problem(s)
  B5 act: 0 to resolve, 0 to install only
  nothing to do: platform.lock maps every package migration and the database records them
  ```

  **Any difference** (a `BLOCKING:` line, a count other than 49, `LEDGER_FAILED_ROW`): stop, do not migrate. Nothing has changed yet, so go to section 7 "before migrate". Do **not** run `--apply` and do not declare new deviations on production. (The tool needs `CREATEDB` for its shadow database, which `vault_app` has.)

- [ ] **6.10 Migrate: the real change.** Record the duration.

  ```bash
  time api npm run prisma:migrate 2>&1 | tee $BACKUP_DIR/migrate-prod.txt
  ```

  Expect `All migrations have been successfully applied.` (41 migrations: 0003 to 0040 as `20261102120001`..`20261102120038`, plus `20261102130000_add_media_folder_files`, `20261102140000_backup_runs_job_id`, `20261103090000_attachments_composite_fk_media_rls`). **From here the only way back is the dump.** A failure part way: do not re-run blindly; read [database-baseline §9](database-baseline.md#9-a-failed-migration-row), then section 7.

- [ ] **6.11 Seed.** Upserts roles with scope, the `org_admin` grants and all permissions (`ai:use`, `ai_config:*`, `storage_config:*`, ...). Required before the data moves.

  ```bash
  api npm run prisma:seed
  ```

  Expect exit 0, no `TS2307`.

- [ ] **6.12 Retire the old env file** so the new one is the only one the deploy tooling finds, and keep the old for rollback:

  ```bash
  mv $VAULT_DIR/.env $VAULT_DIR/.env.legacy
  ls -l $VAULT_DIR/.env.legacy $COMPOSE_DIR/.env
  ```

### The one-time data moves (steps 6.13 to 6.16)

**Order and why** (derived from the runbooks and scripts, not from the order they were written):

1. **AI key first.** Moves `system_settings.ai.apiKey` (under `VAULT_ENCRYPTION_KEY`) into the credential store (under `SECRETS_ENCRYPTION_KEY`). Needs the `credentials` table (platform 0003, now migrated) and both keys.
2. **AI platform second.** It **refuses** (`PROBLEM:`) while a legacy `ai.apiKey` block remains and while AI is enabled with no deployment key stored, so it must follow step 1. It needs the seed (`ai:use` grants). It reuses the credential `('ai','openai')` the first step wrote.
3. **Settings third.** A tidy-up of `user_settings.profile` (no data dependency; runs after the AI steps because its runbook puts the AI key move first).
4. **Storage last.** Imports the `S3_*`/`AWS_*` variables into runtime settings (needs the seeded `system_settings` row and `SECRETS_ENCRYPTION_KEY`). It must run **while the variables are still in `.env`**, and the variables are removed only after it succeeds (step 6.17). The API would also import them at first boot, but doing it here lets you see the dry run and the result before the stack starts.

For each command: **dry run, read it, apply, dry run again** (must say nothing left to do). All are idempotent and print counts and names only, never a key.

- [ ] **6.13 AI key** ([ai-key-migration](ai-key-migration.md)).

  ```bash
  api npm run vault:migrate-ai-key
  ```

  Expect `outcome: would-migrate` (a key was configured) or `nothing-to-migrate` (AI never configured: skip the apply). `conflict` (exit 2) or `decrypt-legacy` (exit 1): stop, see its table. If `would-migrate`:

  ```bash
  api npm run vault:migrate-ai-key -- --apply
  api npm run vault:migrate-ai-key                    # now: outcome: nothing-to-migrate, credential ai/openai: present
  ```

- [ ] **6.14 AI platform** ([ai-platform-migration](ai-platform-migration.md)).

  ```bash
  api npm run vault:migrate-ai-platform
  ```

  Expect `outcome: would-migrate` with no `PROBLEM:` line (exit 0). Read `perUserRequestsPerDay` and the model line. If AI was never configured, expect an outcome that touches nothing: **confirm on the rehearsal** and follow what it prints. Apply with a snapshot (the rollback for the setting; the command refuses to overwrite an existing file):

  ```bash
  dc run --rm --no-deps -T -v $BACKUP_DIR:/snap api npm run vault:migrate-ai-platform -- --apply --snapshot /snap/ai-platform-legacy.json
  ```

  `run --rm` deletes the container, so the snapshot is written to the mounted host directory (**confirm on the rehearsal** that the container user can write there; if not, `chmod o+w $BACKUP_DIR` for the window). Then the dry run again (`api npm run vault:migrate-ai-platform`): `already-migrated`.

- [ ] **6.15 Settings** ([settings-migration](settings-migration.md)).

  ```bash
  api npm run vault:migrate-settings
  api npm run vault:migrate-settings -- --apply
  api npm run vault:migrate-settings                  # zero changes
  ```

  Expect counts only; a `changed meanwhile` count is impossible with the API stopped.

- [ ] **6.16 Storage config** ([storage-config-migration](storage-config-migration.md)). The legacy `S3_*`/`AWS_*` variables must still be in `$COMPOSE_DIR/.env`.

  ```bash
  api npm run vault:migrate-storage-config
  ```

  Expect `outcome: would-import` and `legacy bucket: <your bucket> (driver s3)`. `incomplete` (exit 3) means one access key is missing: configure at `/admin/settings/storage` after the deploy instead. An IAM-role deployment (no `AWS_*` keys) **cannot** use the platform driver: create an access key first ([§2](storage-config-migration.md#2-when-the-import-does-not-apply-and-the-manual-path)). Then:

  ```bash
  api npm run vault:migrate-storage-config -- --apply
  api npm run vault:migrate-storage-config            # outcome: already-configured
  ```

- [ ] **6.17 Remove the obsolete variables** from `$COMPOSE_DIR/.env` (section 4.4):

  ```bash
  sed -i -E '/^(STORAGE_PROVIDER|S3_BUCKET|S3_REGION|S3_ENDPOINT|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|COMPOSE_PROJECT_NAME)=/d' $COMPOSE_DIR/.env
  grep -E '^(STORAGE_PROVIDER|S3_|AWS_|COMPOSE_PROJECT_NAME)' $COMPOSE_DIR/.env || echo "removed"
  ```

### Checks

- [ ] **6.18 Verify the database.**

  ```bash
  api npm run db:check                      # offline: installed platform + vault migrations equal the packages
  api npm run db:check:database             # ledger rows match the files
  api npm run db:drift                      # migrations equal the composed schema; raw-SQL indexes and RLS policies
  api npm run db:baseline                   # plain (not pre-migrate): must say "nothing to do"
  ```

  Expect all four exit 0, `db:check:database` reporting **48** ledger rows (7 + 41; the runbook's older "46" is stale), `db:drift` ok (the rehearsal recorded 12 raw-SQL indexes and 12 RLS policies; compare with yours), and `nothing to do`. **After `prisma:migrate` never use `--through 2` again.**

  Then the data check. `verify-vault-data.ts` does **not** set the RLS bypass, so as `vault_app` it reads `storage_objects` as empty and reports false failures. Run it as the **bootstrap superuser** for this one command:

  ```bash
  POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
  dc run --rm --no-deps -T -e POSTGRES_USER="$ADMIN_USER" -e POSTGRES_PASSWORD api \
    npx ts-node --transpile-only --project prisma/tsconfig.json scripts/verify-vault-data.ts --sample 100 | tee $BACKUP_DIR/verify-prod.txt
  ```

  Expect every line `ok`, ending `verify-vault-data: all checks passed`, **and** `current versions decrypt: N of N sampled decrypted` (0 failures). The line `skip decryption sample` means `VAULT_ENCRYPTION_KEY` did not reach the container: stop. If your provider admin is not a superuser, RLS applies to it too and this command gives the same false failures: **confirm on the rehearsal** that it works for your login, and if not, rely on the `psql` count comparison below plus the decrypt checks of the smoke tests.

  Compare against the "before" counts of 6.4: users, secrets, versions and attachments must be equal; `storage_objects` equal; `media_links` equal (`SELECT count(*) FROM media_folder_files`); the `roles:` rows now show only `admin` (the contributors and viewers moved to memberships, by design).

### Deploy

- [ ] **6.19 Preflight the deploy** (read-only):

  ```bash
  vault deploy doctor --root $VAULT_DIR --domain vault.example.test
  ```

  Expect no required failure: `database-role-ordinary` now passes; the port 8322 is free. Fix anything required before going on. `stray-compose-stack` (recommended) may name the stopped legacy containers: expected.

- [ ] **6.20 Move the legacy vhost aside** so two vhosts for the same name do not coexist (the first one loaded wins, which would be the stale one):

  ```bash
  ls /opt/infra/proxy/nginx/conf.d/
  mv /opt/infra/proxy/nginx/conf.d/vault.conf $VAULT_DIR/vault.conf.legacy
  ```

  The running proxy keeps its loaded configuration until the next reload, so nothing changes yet. **Confirm on the rehearsal** (or, for the proxy, on production only) what `update` writes: `/opt/infra/proxy/nginx/conf.d/vault.example.test.conf`.

- [ ] **6.21 Deploy with `vault deploy update`.** The directory is a deployment (a checkout at `repo/` and an `.env` in it), so `update` **adopts** it and records state; use `update`, **not** `install`. `--force` is required because the checkout is already at the release (otherwise "up to date" and nothing starts); `--no-version-bump` stops it committing and pushing a version bump from the server; `--skip-renewal` leaves certificate renewal with the existing `renew-all-certs.sh` cron.

  ```bash
  cd $VAULT_DIR
  vault deploy update --root $VAULT_DIR --ref $RELEASE_SHA --force --no-version-bump --skip-renewal --non-interactive 2>&1 | tee $BACKUP_DIR/deploy-update-prod.txt
  ```

  It runs preflight, fetch, environment-drift (generates `GREPTIME_*` and `STACK_AGENT_TOKEN`, writes `DEPLOY_ROOT`), stack-ports, database-role, build, migrate (nothing pending), seed, restart, edge-config, health, deploy-info, publish (re-renders the vhost to `127.0.0.1:8322`, validates, reloads), verify. Expect it to finish with the health and verify steps green and exit 0. The final verify includes a harmless OAuth sign-in probe against Google; a failure there means the callback URI or client secret does not match (staging with dummy credentials can pass `--skip-oauth-check`). If it asks for a value (`--non-interactive` fails instead), you missed a key in section 4.

  **The proxy half is the only step not provable on staging** (rehearse it with `--skip-proxy` there). If `publish` fails, the old vhost is restored by the tool; the stack itself is already up on 8322. Fix the vhost (`docker exec proxy-nginx nginx -t`), or move `vault.conf.legacy` back and `docker exec proxy-nginx nginx -s reload`: the upstream is the same 8322.

  If the deploy aborts mid-way there is **no automatic rollback**. Do not re-run blindly: read the printed step, `vault deploy status --root $VAULT_DIR`, and go to section 9.

- [ ] **6.22 Status and logs.**

  ```bash
  vault deploy status --root $VAULT_DIR --domain vault.example.test
  docker ps --format '{{.Names}}\t{{.Status}}'
  ```

  Expect serving, schema current, containers for api, web, nginx, the collector and GreptimeDB healthy (the `stack-agent` is disabled by the Vault overlay). Tail the API log in the second terminal: `docker logs -f <the api container>`; there must be no `SECRETS_ENCRYPTION_KEY` or permission error.

- [ ] **6.23 (Optional) Hold non-admins out while you test.** Admins bypass the platform's maintenance window; everyone else gets a `503`. This is the platform feature the old app lacked. Open it the moment the deploy finishes:

  ```bash
  vault login --server https://vault.example.test           # as the admin
  vault api PUT /api/admin/maintenance --data '{"enabled": true, "message": "Upgrade in progress, back shortly.", "allowAdmins": true}'
  ```

  Close it in 6.25 with `{"enabled": false}`. (Do **not** set `MAINTENANCE_MODE` in `.env` for this: the deploy's health step needs `/api/health/ready` to answer `200`.) Skip this if you accept a few minutes of users hitting the new stack.

- [ ] **6.24 Doctor.** Open `https://vault.example.test/admin/settings/doctor` (or `GET /api/admin/doctor`). Expect **no failures**. Warnings must each be explained: in particular `db.rls_role` pass, `secrets.encryption-key` pass, the Vault encryption-key check pass, `vault.storage_env` pass (warns while the S3 variables remain), and a Postgres-version or event-bus note is understood. A failure you cannot explain is a no-go: section 7.

- [ ] **6.25 Smoke tests.** As the **admin** (`INITIAL_ADMIN_EMAIL`) and as a **contributor**; a viewer should be read-only.

  - [ ] Sign in with Google (no `403`). `GET /api/auth/me` lists **the same permissions each role had before** (compare with the 6.0.5 files).
  - [ ] Open an existing secret: the value decrypts (this proves `VAULT_ENCRYPTION_KEY`).
  - [ ] Create a secret, edit it (a new version appears), roll back a version.
  - [ ] View a card secret.
  - [ ] Download an **existing** attachment and an existing media file; upload a new attachment (its key is `uploads/<orgId>/...`). Storage page `/admin/settings/storage`: **Test** passes.
  - [ ] **My backups** (`/settings/backups`): run one. It is a queue job; it completes, and the archive downloads.
  - [ ] **Admin backup** (`/admin/settings/backups`): run one (job), download it.
  - [ ] Admin Users page: role chips unchanged; a role change persists.
  - [ ] Card scan, **if AI is enabled** (`GET /api/ai/config` says enabled): scan a test card as a contributor (no CVV returned); as a viewer the scan answers `403`. The admin AI page shows one `card_extract` usage row.
  - [ ] Database Backup (Console, Operations): take the first new-platform backup with *Back up now*; `pg_restore --list` of the downloaded archive is non-empty.
  - [ ] `vault login` from a laptop and `vault secrets list` work against the new API.

- [ ] **6.26 Close the window.** Close maintenance if you opened it, confirm the public URL from outside (`curl -fsS https://vault.example.test/api/health/ready`), announce completion, and fill in the record. Stop here unless a section 2 criterion failed: then section 7.

  ```bash
  vault api PUT /api/admin/maintenance --data '{"enabled": false}'
  ```

---

## 7. Rollback

**Roll back when** any step's expected output differs and you cannot explain it in minutes; `verify-vault-data.ts` shows a decrypt failure or an unresolved attachment; the Doctor has an unexplained failure; or a smoke test fails (empty lists, a secret that will not open, `403` for a contributor, an upload `500`). Decide before users write new data.

**What it costs:** the database goes back to the dump of step 6.4, so **every write after that dump is lost** (secrets, versions, new users). After the new stack served users for a while, prefer fixing forward and keep the dump only as the last resort.

### 7.1 Before `prisma:migrate` (steps 6.1 to 6.9)

Nothing in the data changed except ownership (6.7) and the role. If the admin login is a superuser, ownership is irrelevant:

```bash
[ -f $VAULT_DIR/.env.legacy ] && mv $VAULT_DIR/.env.legacy $VAULT_DIR/.env      # only if 6.12 already ran
git -C $VAULT_DIR/repo checkout --detach $OLD_SHA
docker compose -f $VAULT_DIR/compose.yml start
```

If the admin login is **not** a superuser (managed provider) and ownership was transferred, the old app cannot write: treat it as 7.2.

### 7.2 After `prisma:migrate` (steps 6.10 onward)

1. **Stop the new stack** (and stop users reaching it):

   ```bash
   docker compose ls                                                    # note the project name of the new stack
   cd $COMPOSE_DIR && docker compose -p <project> -f base.compose.yml -f prod.compose.yml -f telemetry.compose.yml -f vps.compose.yml -f vps.telemetry.compose.yml -f app.vps.no-stack-agent.compose.yml down
   ```

2. **Restore the dump** into a fresh database and swap it in ([database-restore §4](database-restore.md#4-the-manual-restore-the-guided-path-end-to-end), same pattern; the pre-platform dump has no RLS, so the RLS flags are harmless). As the admin login (the owner the old app expects):

   ```bash
   export SCRATCH=${DBNAME}_rollback_$(date -u +%Y%m%d%H%M)
   createdb -h $PGHOST -p $PGPORT -U $ADMIN_USER $SCRATCH
   PGOPTIONS='-c app.rls_bypass=on' pg_restore -h $PGHOST -p $PGPORT -U $ADMIN_USER -d $SCRATCH \
     --no-owner --no-acl --exit-on-error --enable-row-security --jobs=4 "$DUMP"
   psql -h $PGHOST -U $ADMIN_USER -d $SCRATCH -Atc "select count(*) from users"       # equals $DUMP.counts.txt
   psql -h $PGHOST -U $ADMIN_USER -d $SCRATCH -Atc "select count(*) from secrets"     # equals $DUMP.counts.txt
   # swap: terminate connections, then rename (each statement is its own call)
   psql -h $PGHOST -U $ADMIN_USER -d postgres -Atc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DBNAME' AND pid <> pg_backend_pid()"
   psql -h $PGHOST -U $ADMIN_USER -d postgres -c "ALTER DATABASE \"$DBNAME\" RENAME TO \"${DBNAME}_failed_cutover\""
   psql -h $PGHOST -U $ADMIN_USER -d postgres -c "ALTER DATABASE \"$SCRATCH\" RENAME TO \"$DBNAME\""
   ```

   `PGPASSWORD` must be exported for these (`export PGPASSWORD=$ADMIN_PASSWORD`). Keep `${DBNAME}_failed_cutover` for diagnosis; do not drop it yet.

3. **Restore the old code, env and images:**

   ```bash
   mv $COMPOSE_DIR/.env $COMPOSE_DIR/.env.failed-cutover               # keep for diagnosis; contains secrets
   mv $VAULT_DIR/.env.legacy $VAULT_DIR/.env
   git -C $VAULT_DIR/repo checkout --detach $OLD_SHA
   docker images | grep -E '^vault-(api|web)'                           # the :pre-platform tags exist
   ```

4. **Restore the old vhost** (only if 6.21 got as far as `publish`):

   ```bash
   rm -f /opt/infra/proxy/nginx/conf.d/vault.example.test.conf
   mv $VAULT_DIR/vault.conf.legacy /opt/infra/proxy/nginx/conf.d/vault.conf
   docker exec proxy-nginx nginx -t && docker exec proxy-nginx nginx -s reload
   ```

5. **Start the old stack** (its images are the ones you tagged `:pre-platform`; if `vault-api:latest` was overwritten, `docker tag vault-api:pre-platform vault-api:latest` first, or add `--build`):

   ```bash
   docker compose -f $VAULT_DIR/compose.yml up -d
   curl -fsS https://vault.example.test/api/health/live
   ```

6. **Verify:** sign in, open a secret, check the counts against `$DUMP.counts.txt`. The deploy state file `vault deploy` wrote in `$VAULT_DIR` is harmless; leave it.
7. **Tell users** what was lost, if anything. Do **not** run the legacy `update.sh` (it pulls `main`).

The cluster-level `vault_app` role stays; it owns nothing in the restored database and is harmless ([application-role §7](application-role.md#7-rollback)). The restored database is owned by the admin login again, as before. For the whole-database tooling, see also [database-baseline §10](database-baseline.md#10-rollback).

---

## 8. After the cutover

- [ ] **First 24 hours:** watch the API log (`docker logs --since 1h <api container>`), the Doctor page (`/admin/settings/doctor`) and `vault deploy status --root $VAULT_DIR` at +1 h, +4 h and next morning. Look for `permission denied`, `AI_NOT_CONFIGURED`, `AI_KEY_UNREADABLE`, `503` from storage, and failed jobs at the Jobs admin page.
- [ ] **Take the first new-platform backups** and keep them off-server: Console, Operations, **Database Backup**, *Back up now* (needs storage configured); one admin backup at `/admin/settings/backups`; each user's "My backups" are theirs.
- [ ] **Keep the rollback artifacts for 7 days:** the pre-cutover dump (`$DUMP` + `.sha256`, off-host), `.env.legacy`, the `vault-*:pre-platform` images, the `${DBNAME}_failed_cutover`-style scratch databases if any.
- [ ] **Delete the old env values** when the soak is over: `shred -u $VAULT_DIR/.env.legacy $VAULT_DIR/env.next`, remove the old AWS access key from IAM if you created a new one, and drop rehearsal databases and servers. The `S3_*`/`AWS_*` values must be gone from `.env` (done in 6.17) and from every shell history and password-manager note that is not the single source.
- [ ] **Retire the legacy deploy path:** stop using `install-vault.sh` and `update.sh`; move them aside (`mv $VAULT_DIR/update.sh $VAULT_DIR/update.sh.legacy`), then `docker compose -f $VAULT_DIR/compose.yml down` and remove the legacy `compose.yml`, `vault.conf.legacy` and the `vault-*:pre-platform` images. The deployment is `vault deploy update` from now on. The deprecated files in the repository (`infra/deploy/`, `infra/nginx/nginx.prod.conf`, `scripts/dev.ps1`) are removed by follow-up D, issue [#155](https://github.com/marinoscar/vault/issues/155), once no install uses them; the follow-up epic is [#151](https://github.com/marinoscar/vault/issues/151) (see [local-exceptions](../platform-adoption/local-exceptions.md)).
- [ ] **Know the new routine:** updates are `vault deploy update` (read `vault deploy update --help`; the seed re-runs on every update; use `--maintenance` for planned windows; pass `--no-version-bump` unless you want it to commit a version from the server). Configure alerts, email and Web Push at their Console pages, none through `.env`.
- [ ] **Record** the real window time and everything that differed from this guide in the rehearsal record, and fix this guide.

---

## 9. Troubleshooting

Full tables live in each runbook; the most likely failures here:

| Symptom | Likely cause | Fix / where |
|---|---|---|
| `DIFF_BLOCKING`, a count other than `49 declared` at 6.9 | The database is not the one Vault rehearsed | Stop. [database-baseline §4](database-baseline.md#4-the-dry-run-and-the-declared-deviations), [§11](database-baseline.md#11-troubleshooting). Never declare an unexplained statement on production |
| `RLS_OPT_IN_REQUIRED`, `POLICY_MISSING`, `RLS_NOT_ENABLED` | Used `db:baseline` (or `--through 2`) instead of `db:baseline:pre-migrate` before the migrate, or the reverse after it | Before migrate: `db:baseline:pre-migrate`. After: plain `db:baseline` |
| `LEDGER_FAILED_ROW` | A half-applied migration in `_prisma_migrations` | [database-baseline §9](database-baseline.md#9-a-failed-migration-row) |
| `permission denied for table ...`, `must be owner of ...` | Ownership not transferred, or the old admin login is still in `.env` | Re-run 6.7 with the API stopped; check `POSTGRES_USER` in `$COMPOSE_DIR/.env`. [application-role Troubleshooting](application-role.md#troubleshooting) |
| `permission denied to create database` in 6.9 | Shadow database needs `CREATEDB` | `vault_app` has it; else pass `--shadow-database-url` ([baseline §11](database-baseline.md#11-troubleshooting)) |
| `transfer-ownership.sql`: `run this as a superuser` | Managed provider login is not a superuser | Manual path, [application-role §1](application-role.md#1-prerequisites) |
| `network devnet declared as external, but could not be found` | The external network is missing | `docker network create devnet` |
| API will not boot, naming `SECRETS_ENCRYPTION_KEY` | Missing or not base64 of 32 bytes | `openssl rand -base64 32`; [ai-key-migration Troubleshooting](ai-key-migration.md#troubleshooting) |
| Every secret unreadable after the deploy | `VAULT_ENCRYPTION_KEY` differs from the old `.env` | Put the exact old value back; [database-restore §2, §5.7](database-restore.md#2-keys-the-restored-database-must-match-the-environment) |
| Data move: `conflict` / `decrypt-legacy` / `PROBLEM:` | A different credential already stored; wrong old key; step order | Stop and read that runbook's outcome table: [ai-key](ai-key-migration.md#2-dry-run), [ai-platform](ai-platform-migration.md#2-dry-run-the-default) |
| `settings-row-missing` (storage) | Seed has not run | 6.11, then repeat |
| `AI_NOT_CONFIGURED` (503) after the deploy | AI moves not applied, or the model row is disabled | 6.13 and 6.14; enable the model on the admin AI page |
| Uploads/downloads `503`, "Object storage is not configured" | Storage import not done | 6.16, or configure `/admin/settings/storage`; IAM-role setups need an access key ([storage-config-migration §2](storage-config-migration.md#2-when-the-import-does-not-apply-and-the-manual-path)) |
| Uploads `415` | `ALLOWED_MIME_TYPES` is enforced now | Set it empty (4.1) and recreate `api` |
| Uploads `413` | Proxy vhost body limit | The deploy renders it from `MAX_FILE_SIZE`; check the published vhost |
| `502` after the deploy | Proxy still points at the wrong port, or two vhosts | `APP_BIND_PORT` must be `8322`; only one `conf.d` file for the name; `docker exec proxy-nginx nginx -t` |
| `vault deploy update` says "up to date" and starts nothing | The checkout already equals the ref | Add `--force` (6.21) |
| `vault deploy update` refuses or asks for values | A required key is missing from `.env`, or `--non-interactive` with an unresolved key | Section 4 diff; `vault deploy doctor` |
| `bind-port-owner` / port 8322 in use | The legacy containers still run | 6.2 (`stop`); `ss -tlnp \| grep 8322` |
| `vault deploy` fails as another user, or clone fails | Run with `sudo`, or wrong account, or `gh` not logged in | Run as the owning account; [deploy-to-vps §1](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/runbooks/deploy-to-vps.md) |
| Doctor: `db.rls_role` fails | The API still connects as the admin login | Check `POSTGRES_USER`; recreate `api` |
| `verify-vault-data.ts` shows unresolved attachments / 0 objects | It ran as `vault_app` (RLS, no bypass) | Run it as the bootstrap superuser (6.18) |
| `ERESOLVE`, `TS2307` in the image | Image built from the wrong commit | `git -C $VAULT_DIR/repo rev-parse HEAD` equals `$RELEASE_SHA`; rebuild |

Related: [database-baseline](database-baseline.md), [application-role](application-role.md), [database-restore](database-restore.md), [infra-sync](infra-sync.md), [local-exceptions](../platform-adoption/local-exceptions.md), the legacy [DEPLOY.md](../../infra/deploy/DEPLOY.md).
