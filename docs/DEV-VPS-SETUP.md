# Dev VPS Setup — Vault

This guide covers deploying the Vault application on the shared dev VPS at `vault.dev.marin.cr`. Follow it from scratch when setting up the deployment for the first time or when re-provisioning the environment.

## Architecture

```
Internet (HTTPS:443)
    |
Host Nginx (SSL termination, *.dev.marin.cr wildcard)
    | maps vault.dev.marin.cr -> 127.0.0.1:3536
Docker Nginx (port 3536:80, path-based routing)
    |-- /api -> API container (port 3000) --> devnet --> postgres
    |-- /    -> Web container (port 5173 dev / 80 prod)
```

The host Nginx handles HTTPS and terminates SSL using the wildcard certificate for `*.dev.marin.cr`. It proxies plain HTTP to the Docker Nginx container listening on port `3536`. The Docker Nginx handles path-based routing to the API and web containers. The API container connects to PostgreSQL through the shared `devnet` Docker network.

---

## 1. Prerequisites

Before starting, confirm the following are already in place on the VPS:

- **Docker** and **Docker Compose** installed and running
- **Wildcard SSL certificate** for `*.dev.marin.cr` (managed via Let's Encrypt or equivalent)
- **Host Nginx** configured with the wildcard proxy map (see Section 3)
- **External PostgreSQL** accessible on the `devnet` Docker network
- **`devnet` Docker network** created on the host (see Section 4)
- **AWS account** with an S3 bucket for file storage
- **Google Cloud project** with an OAuth 2.0 client configured (see Section 9)

---

## 2. SSL Certificate

The wildcard certificate for `*.dev.marin.cr` is already provisioned on the VPS. It covers all subdomains including `vault.dev.marin.cr` without any per-app SSL configuration.

**Certificate paths (example — verify actual paths on the host):**

```
/etc/letsencrypt/live/dev.marin.cr/fullchain.pem
/etc/letsencrypt/live/dev.marin.cr/privkey.pem
```

**Renewal** is handled automatically by Certbot. To force a manual renewal:

```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

---

## 3. Nginx Wildcard Proxy Configuration

The host Nginx uses a `map` block to route subdomains to their respective Docker ports. The entry for Vault maps `vault.dev.marin.cr` to port `3536` on localhost.

**Relevant host Nginx configuration (excerpt):**

```nginx
map $host $backend_port {
    vault.dev.marin.cr  3536;
    # other apps...
}

server {
    listen 443 ssl;
    server_name *.dev.marin.cr;

    ssl_certificate     /etc/letsencrypt/live/dev.marin.cr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dev.marin.cr/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:$backend_port;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The Vault entry (`vault.dev.marin.cr -> 3536`) should already be present in the map block. If it is missing, add it and reload the host Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4. Docker Network Setup

The `devnet` network is a pre-existing external Docker network that connects application containers to the shared PostgreSQL instance. The `api` service in `base.compose.yml` is already configured to attach to this network.

**Verify the network exists:**

```bash
docker network inspect devnet
```

**If it does not exist, create it:**

```bash
docker network create devnet
```

**Verify the PostgreSQL container is reachable on devnet:**

```bash
docker run --rm --network devnet postgres:15-alpine \
  psql postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@<POSTGRES_HOST>:5432/postgres -c '\l'
```

Replace the placeholders with the values from your `.env` file. A list of databases confirms connectivity.

---

## 5. Setting Up the .env File

The `.env` file lives at `infra/compose/.env`. This file is never committed to git.

**Copy the template:**

```bash
cp infra/compose/.env.example infra/compose/.env
```

**Edit the file and set all required values:**

```bash
# Application
NODE_ENV=development
PORT=3000
APP_URL=https://vault.dev.marin.cr

# Database — connects through devnet to shared PostgreSQL
POSTGRES_HOST=<postgres-container-name-on-devnet>
POSTGRES_PORT=5432
POSTGRES_USER=<db-user>
POSTGRES_PASSWORD=<db-password>
POSTGRES_DB=vault
POSTGRES_SSL=false

# JWT — use a strong random value, minimum 32 characters
JWT_SECRET=<generate with: openssl rand -base64 48>
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=14

# Google OAuth
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_CALLBACK_URL=https://vault.dev.marin.cr/api/auth/google/callback

# Initial admin user — this email bypasses the allowlist on first login
INITIAL_ADMIN_EMAIL=<your-email>

# Cookie signing secret
COOKIE_SECRET=<generate with: openssl rand -base64 32>

# AWS S3 storage
S3_BUCKET=<your-s3-bucket-name>
S3_REGION=<your-aws-region>
AWS_ACCESS_KEY_ID=<your-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>

# Vault encryption key — 64 hex characters (32 bytes)
# Generate with: openssl rand -hex 32
# WARNING: If this key is lost, all encrypted secrets are permanently unrecoverable.
# Store it in a secure location (password manager, secrets vault) before deploying.
VAULT_ENCRYPTION_KEY=<64-char-hex-string>

# Observability (optional)
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_SERVICE_NAME=vault-api
LOG_LEVEL=info
```

**Generating the encryption key:**

```bash
openssl rand -hex 32
```

This produces a 64-character hexadecimal string. The API will refuse to start if `VAULT_ENCRYPTION_KEY` is not set. Back up this value immediately. There is no recovery mechanism if it is lost — all encrypted secret values stored in the database become permanently inaccessible.

---

## 6. Vite Allowed Hosts

The Vite development server is configured to accept requests from `vault.dev.marin.cr`. This is set in `apps/web/vite.config.ts`:

```ts
server: {
  allowedHosts: ['vault.dev.marin.cr'],
}
```

Without this entry, Vite rejects requests from the subdomain with a 403 response. No changes are needed — it is already configured for this deployment.

---

## 7. Docker Compose — Building and Starting

All compose commands are run from the `infra/compose` directory. The compose project name is set to `vault`, which prefixes all container names (e.g., `vault-api-1`, `vault-web-1`, `vault-nginx-1`).

**Set the project name in your shell or in the `.env` file:**

```bash
# Add to infra/compose/.env
COMPOSE_PROJECT_NAME=vault
```

Alternatively, pass it explicitly with every compose command using `-p vault`.

### Development mode (hot reload)

```bash
cd infra/compose
docker compose -p vault -f base.compose.yml -f dev.compose.yml up --build
```

Use `--build` on the first run or after any code changes to source files that are not volume-mounted (e.g., package.json, Dockerfile changes).

### Production mode

```bash
cd infra/compose
docker compose -p vault -f base.compose.yml -f prod.compose.yml up --build -d
```

The `-d` flag runs containers in the background.

### View logs

```bash
# All services
docker compose -p vault -f base.compose.yml logs -f

# API only
docker compose -p vault -f base.compose.yml logs -f api

# Web only
docker compose -p vault -f base.compose.yml logs -f web
```

### Stop services

```bash
docker compose -p vault -f base.compose.yml down
```

### Rebuild a single service after code changes

```bash
docker compose -p vault -f base.compose.yml -f dev.compose.yml up --build api
```

### Verify containers are running

```bash
docker ps --filter name=vault
```

Expected output shows three containers: `vault-api-1`, `vault-web-1`, `vault-nginx-1`.

---

## 8. Database Migrations and Seeding

Prisma migrations must be applied before the API can serve requests. The `apps/api/scripts/prisma-env.js` helper constructs `DATABASE_URL` from the individual `POSTGRES_*` environment variables and passes it to the Prisma CLI.

### Option A — Run migrations inside the running API container (preferred for dev VPS)

```bash
# Open a shell inside the running API container
docker exec -it vault-api-1 sh

# Apply all pending migrations
node scripts/prisma-env.js migrate deploy

# Run database seed (creates roles, permissions, initial admin)
node scripts/prisma-env.js db seed

# Exit the container
exit
```

### Option B — Run migrations from the host

This requires Node.js and the project dependencies installed on the host.

```bash
cd apps/api

# Ensure infra/compose/.env is readable (prisma-env.js loads it automatically)
node scripts/prisma-env.js migrate deploy
node scripts/prisma-env.js db seed
```

### How prisma-env.js works

The script reads `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_SSL` from the environment (or from `infra/compose/.env` when running outside Docker). It constructs a `postgresql://` connection URL and injects it as `DATABASE_URL` when spawning the Prisma CLI process.

This avoids hardcoding connection strings and keeps the database credentials in one place.

### After schema changes

When `apps/api/prisma/schema.prisma` is modified:

```bash
# 1. Create a new migration (development only — do not run on the VPS directly)
#    Run this locally, commit the migration file, then deploy
cd apps/api && npm run prisma:migrate:dev -- --name <migration_name>

# 2. On the VPS, pull the latest code and apply the new migration
docker exec -it vault-api-1 node scripts/prisma-env.js migrate deploy

# 3. Regenerate the Prisma client if needed (happens automatically on container build)
docker exec -it vault-api-1 node scripts/prisma-env.js generate
```

---

## 9. Google OAuth Setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and navigate to your OAuth 2.0 client.
2. Under **Authorized redirect URIs**, add:
   ```
   https://vault.dev.marin.cr/api/auth/google/callback
   ```
3. Save the client configuration.
4. Confirm the same URI is set in `infra/compose/.env`:
   ```
   GOOGLE_CALLBACK_URL=https://vault.dev.marin.cr/api/auth/google/callback
   ```

The callback URI in the `.env` file and in the Google Console must match exactly. A mismatch produces a `redirect_uri_mismatch` error from Google during the OAuth flow.

---

## 10. Quick Start Checklist

Use this checklist when deploying to the dev VPS for the first time.

- [ ] Confirm `devnet` Docker network exists: `docker network inspect devnet`
- [ ] Confirm PostgreSQL is reachable on devnet
- [ ] Confirm host Nginx has the `vault.dev.marin.cr -> 3536` map entry
- [ ] Confirm wildcard SSL certificate covers `*.dev.marin.cr`
- [ ] Copy env template: `cp infra/compose/.env.example infra/compose/.env`
- [ ] Generate `VAULT_ENCRYPTION_KEY`: `openssl rand -hex 32`
- [ ] Set `VAULT_ENCRYPTION_KEY` in `.env` and back it up to a secure location
- [ ] Generate `JWT_SECRET`: `openssl rand -base64 48`
- [ ] Generate `COOKIE_SECRET`: `openssl rand -base64 32`
- [ ] Set `POSTGRES_DB=vault` and all other `POSTGRES_*` values
- [ ] Set `APP_URL=https://vault.dev.marin.cr`
- [ ] Set `GOOGLE_CALLBACK_URL=https://vault.dev.marin.cr/api/auth/google/callback`
- [ ] Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- [ ] Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`
- [ ] Set `INITIAL_ADMIN_EMAIL`
- [ ] Set `COMPOSE_PROJECT_NAME=vault` in `.env`
- [ ] Add `https://vault.dev.marin.cr/api/auth/google/callback` to Google OAuth client
- [ ] Build and start containers: `docker compose -p vault -f base.compose.yml -f dev.compose.yml up --build -d`
- [ ] Verify containers are running: `docker ps --filter name=vault`
- [ ] Apply migrations: `docker exec -it vault-api-1 node scripts/prisma-env.js migrate deploy`
- [ ] Seed the database: `docker exec -it vault-api-1 node scripts/prisma-env.js db seed`
- [ ] Confirm API health check passes: `curl https://vault.dev.marin.cr/api/health/live`
- [ ] Open `https://vault.dev.marin.cr` in a browser and complete Google login

---

## 11. Troubleshooting

### Site not reachable (connection refused or timeout)

1. Verify the containers are running: `docker ps --filter name=vault`
2. Verify the Docker Nginx is listening on port 3536: `ss -tlnp | grep 3536`
3. Verify the host Nginx map entry for `vault.dev.marin.cr` exists and the host Nginx has been reloaded.
4. Check host Nginx error logs: `sudo tail -n 50 /var/log/nginx/error.log`

### 502 Bad Gateway

The host Nginx can reach port 3536, but the Docker Nginx cannot reach the API or web container.

1. Check if all three containers are running: `docker ps --filter name=vault`
2. Check API logs for startup errors: `docker logs vault-api-1 --tail 100`
3. Check web logs: `docker logs vault-web-1 --tail 100`
4. A common cause is the API failing to start due to a missing or invalid `VAULT_ENCRYPTION_KEY` — check the API logs for an error message about this variable.

### Vite dev server returns 403 (blocked host)

The Vite dev server rejected the request because `vault.dev.marin.cr` was not in its `allowedHosts` list. This should not occur since the config is already set, but if it does:

1. Confirm `apps/web/vite.config.ts` contains `allowedHosts: ['vault.dev.marin.cr']`.
2. Rebuild the web container: `docker compose -p vault -f base.compose.yml -f dev.compose.yml up --build web`

### API cannot reach the database

1. Confirm `devnet` exists and the API container is attached to it:
   ```bash
   docker network inspect devnet | grep vault-api
   ```
2. Confirm `POSTGRES_HOST` in `.env` matches the PostgreSQL container name on devnet.
3. Test connectivity from inside the API container:
   ```bash
   docker exec -it vault-api-1 sh
   # inside the container:
   node scripts/test-db-connection.js
   ```
4. Check that `POSTGRES_DB=vault` — the database must exist on the PostgreSQL server before migrations run.

### Migration fails

1. Confirm the target database exists. If it does not, create it:
   ```bash
   docker exec -it <postgres-container> psql -U <user> -c 'CREATE DATABASE vault;'
   ```
2. Check for conflicting migration state:
   ```bash
   docker exec -it vault-api-1 node scripts/prisma-env.js migrate status
   ```
3. If running Option B (from the host), confirm `infra/compose/.env` is present and readable — `prisma-env.js` loads it automatically in non-production mode.

### Google OAuth redirect_uri_mismatch

The `redirect_uri` sent by the app does not match any URI registered in the Google Console.

1. Confirm `GOOGLE_CALLBACK_URL` in `.env` is exactly `https://vault.dev.marin.cr/api/auth/google/callback`.
2. Confirm the same URI is listed under **Authorized redirect URIs** in the Google Cloud Console OAuth client.
3. Rebuild the API container after changing `.env` so the new value is picked up:
   ```bash
   docker compose -p vault -f base.compose.yml -f dev.compose.yml up --build api
   ```

### Encrypted secrets are not decryptable (wrong encryption key)

If the `VAULT_ENCRYPTION_KEY` is changed after secrets have been stored, all previously encrypted values become unreadable. The API will return decryption errors when reading affected secrets.

- **Do not rotate the key** unless you have a migration plan in place.
- If the key was accidentally changed, restore the original value in `.env` and restart the API container:
  ```bash
  docker compose -p vault -f base.compose.yml -f dev.compose.yml restart api
  ```
- If the original key is genuinely lost, the encrypted data is permanently unrecoverable. The database records must be deleted and re-entered.
- Always store the encryption key in a secure location (password manager, dedicated secrets vault) separate from the `.env` file.
