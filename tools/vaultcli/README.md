# Vault CLI (`vaultcli`)

A command-line tool for the **Vault** secrets management application — designed for both humans and AI agents.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   vaultcli  ──▶  Vault API  ──▶  PostgreSQL (encrypted)  │
│     │                │                                    │
│     │  PAT Bearer    │  AES-256-GCM                       │
│     │  Auth           │  at rest                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Install, Update & Uninstall

### Install (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/tools/vaultcli/install.sh | bash
```

This clones the repo to `~/.vaultcli`, installs dependencies, builds, and creates a symlink at `/usr/local/bin/vaultcli`.

### Update

```bash
vaultcli-update
# or re-run the install command
```

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/tools/vaultcli/install.sh | bash -s -- --uninstall
```

### Manual Installation (from repo)

```bash
cd tools/vaultcli
npm install
npm run build
chmod +x bin/vaultcli.js
sudo ln -sf "$(pwd)/bin/vaultcli.js" /usr/local/bin/vaultcli
```

### Version

```bash
vaultcli --version
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VAULTCLI_SERVER_URL` | Override the Vault server URL | `https://vault.marin.cr` |
| `VAULTCLI_CONFIG_DIR` | Override the config directory | `~/.config/vaultcli` |
| `VAULTCLI_INSTALL_DIR` | Override the installation directory | `~/.vaultcli` |

---

## Quick Start

```bash
# 1. Authenticate
vaultcli auth login

# 2. Browse available secret types
vaultcli types list

# 3. Create a secret
vaultcli secrets create \
  --name "AWS Production" \
  --type-id <uuid-from-types-list> \
  --data '{"access_key":"AKIAIOSFODNN7EXAMPLE","secret_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}'

# 4. List your secrets
vaultcli secrets list

# 5. Retrieve a secret by name
vaultcli secrets get "AWS Production"

# 6. View version history
vaultcli versions list "AWS Production"
```

---

## Authentication

Vault CLI uses **Personal Access Tokens (PAT)** for authentication. Tokens are long-lived and start with `pat_`.

### Creating a Token

1. Open your Vault web app at `https://vault.marin.cr/settings`
2. Navigate to **Personal Access Tokens**
3. Click **Create Token**
4. Copy the generated token (it's only shown once!)

### Login

```bash
vaultcli auth login
# Prompts for your PAT and validates it against the server
```

The token is stored at `~/.config/vaultcli/auth.json` with `0600` permissions (owner-only read/write).

### Check Status

```bash
vaultcli auth status
```

### Logout

```bash
vaultcli auth logout
```

---

## Output Modes

Every command supports three output modes:

| Mode | Flag | Use Case | Output |
|------|------|----------|--------|
| **Human** | *(default)* | Interactive terminal use | Rich formatted tables, colors, headers |
| **JSON** | `--json` | AI agents, scripts | `{"success": true, "data": ...}` on stdout |
| **Quiet** | `-q` / `--quiet` | Shell piping | Bare values (IDs, names) one per line |

### JSON Envelope

**Success** (stdout):
```json
{"success": true, "data": {"id": "...", "name": "...", ...}}
```

**Error** (stderr):
```json
{"success": false, "error": "Secret not found", "code": "NOT_FOUND"}
```

### Examples Across Modes

```bash
# Human (default) — rich table
vaultcli secrets list

# JSON — machine-readable
vaultcli secrets list --json

# Quiet — one ID per line
vaultcli secrets list -q
```

---

## Command Reference

### Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `-q, --quiet` | Minimal output (IDs only) |
| `--server <url>` | Override server URL for this invocation |
| `--no-color` | Disable ANSI color codes |
| `-v, --verbose` | Show HTTP request details |
| `-V, --version` | Display version |
| `-h, --help` | Display help |

---

### `auth` — Authentication

```bash
vaultcli auth login              # Authenticate with a PAT
vaultcli auth status             # Show current auth state
vaultcli auth logout             # Clear stored token
```

---

### `secrets` — Secret Management

Secrets can be referenced by **UUID** or by **name** (unique per user). The CLI auto-detects UUID format.

#### `secrets list`

```bash
vaultcli secrets list
vaultcli secrets list --search "aws"
vaultcli secrets list --type-id <uuid> --sort name --order asc
vaultcli secrets list --page 2 --page-size 10
```

| Option | Description | Default |
|--------|-------------|---------|
| `--type-id <uuid>` | Filter by secret type | - |
| `--search <term>` | Search by name | - |
| `--page <n>` | Page number | `1` |
| `--page-size <n>` | Items per page | `20` |
| `--sort <field>` | `createdAt`, `name`, `updatedAt` | `updatedAt` |
| `--order <dir>` | `asc`, `desc` | `desc` |

#### `secrets get <id-or-name>`

```bash
vaultcli secrets get "AWS Production"       # By name
vaultcli secrets get abc12345-...           # By UUID
vaultcli secrets get "AWS Production" --json | jq '.data.values.secret_key'
```

Returns full secret detail with **decrypted data**, version info, and attachments.

#### `secrets create`

```bash
vaultcli secrets create \
  --name "Database Prod" \
  --type-id <uuid> \
  --data '{"host":"db.example.com","port":"5432","username":"admin","password":"s3cret"}' \
  --description "Production database credentials"
```

| Option | Required | Description |
|--------|----------|-------------|
| `--name <name>` | Yes | Secret name (unique per user) |
| `--type-id <uuid>` | Yes | Secret type ID |
| `--data <json>` | Yes | JSON object matching type field definitions |
| `--description <text>` | No | Description |

#### `secrets update <id-or-name>`

```bash
# Update metadata only
vaultcli secrets update "Database Prod" --description "Updated description"

# Update data (creates a new version)
vaultcli secrets update "Database Prod" --data '{"host":"db.example.com","port":"5432","username":"admin","password":"n3w_p@ss"}'

# Rename
vaultcli secrets update "Database Prod" --name "DB Production"
```

| Option | Description |
|--------|-------------|
| `--name <name>` | New name |
| `--description <text>` | New description (use `""` to clear) |
| `--data <json>` | New data (creates a new version) |

#### `secrets delete <id-or-name>`

```bash
vaultcli secrets delete "Database Prod"
vaultcli secrets delete abc12345-...
```

---

### `versions` — Version History

Every data change creates an immutable version. You can inspect any version and rollback.

#### `versions list <secret-id-or-name>`

```bash
vaultcli versions list "AWS Production"
```

Shows all versions with version number, current marker, creator, and timestamp.

#### `versions get <secret-id-or-name> <version-id>`

```bash
vaultcli versions get "AWS Production" <version-uuid>
```

Returns the version with **decrypted data** so you can compare with the current version.

#### `versions rollback <secret-id-or-name> <version-id>`

```bash
vaultcli versions rollback "AWS Production" <version-uuid>
```

Creates a **new version** with the data from the specified old version. The old version is preserved.

---

### `types` — Secret Types

Secret types define the field schema for secrets (field names, types, required, sensitive flags).

#### `types list`

```bash
vaultcli types list
vaultcli types list --search "login"
```

#### `types get <id>`

```bash
vaultcli types get <uuid>
```

Shows the full field definitions table: field name, label, type, required, sensitive.

---

### `health` — Server Health

No authentication required.

```bash
vaultcli health live          # Is the process running?
vaultcli health ready         # Is the server ready (DB connected)?
```

---

### `config` — Configuration

```bash
vaultcli config show                              # Display all config with sources
vaultcli config set-url https://my-vault.com      # Persist server URL
vaultcli config reset                             # Reset to defaults
```

**URL priority:** `--server` flag > `VAULTCLI_SERVER_URL` env > config file > `https://vault.marin.cr`

---

### `sync` — Local File Sync

Keep local `.env` files (or any UTF-8 text files) backed up in Vault as **Document-type secrets**, with full version history. Designed to run unattended from cron. Change detection is client-side via SHA-256 — unchanged files are skipped and no new version is created.

The local registry is persisted at `~/.config/vaultcli/sync.json` (mode `0600`; honors `VAULTCLI_CONFIG_DIR`). Registration is local-only; the Vault secret is created lazily on the first `sync run`. Removing an entry only unregisters it locally — it does **not** delete the Vault secret.

#### `sync add`

Register a single file.

```bash
vaultcli sync add --name "app/env-prod" --path /home/user/myapp/.env.production
vaultcli sync add --name "app/env-prod" --path /home/user/myapp/.env.production \
  --description "Production environment variables"
```

| Option | Required | Description |
|--------|----------|-------------|
| `--name <secretName>` | Yes | Secret name (unique per user) |
| `--path <absolutePath>` | Yes | Absolute path to the file |
| `--description <text>` | No | Description stored on the Vault secret |

Fails (exit 1) on a duplicate name or a relative path. Warns if the file does not exist yet but still registers the entry.

#### `sync add-dir`

Register a directory. Matching files are discovered at run time, not at registration.

```bash
vaultcli sync add-dir --path /home/user/myapp
vaultcli sync add-dir --path /home/user/myapp --pattern "*.env" --recursive
vaultcli sync add-dir --path /home/user/myapp --name-prefix "myapp"
```

| Option | Description | Default |
|--------|-------------|---------|
| `--path <absoluteDir>` | Absolute path to the directory | — (required) |
| `--pattern <glob>` | Glob pattern to match files | `.env*` |
| `--recursive` | Descend into subdirectories | `false` |
| `--name-prefix <prefix>` | Prefix for derived secret names | directory basename |
| `--description <text>` | Description for discovered secrets | — |

Derived secret name is `<name-prefix>/<relative path>` — deterministic across runs. `.git` and `node_modules` are always skipped. Explicit per-file entries (added via `sync add`) take precedence over directory-discovered duplicates.

#### `sync remove <name-or-path>`

Unregister a file by name or path, or a directory by path. Exits 1 if nothing matched. Does **not** delete the Vault secret.

```bash
vaultcli sync remove "app/env-prod"
vaultcli sync remove /home/user/myapp/.env.production
vaultcli sync remove /home/user/myapp          # removes the directory entry
```

#### `sync list`

Offline listing of all registered files and watched directories. Shows cached status and last-synced date without contacting the server.

```bash
vaultcli sync list
vaultcli sync list --json
```

Status values: `not-yet-created`, `synced (vN)`.

#### `sync status`

Dry run — compares each file against Vault and reports what would happen, without writing anything. Exits non-zero if any entry errored.

```bash
vaultcli sync status
vaultcli sync status --name "app/env-prod"
```

Report values: `would-create`, `would-update`, `unchanged`, `error`.

#### `sync run`

The primary command and cron entry point. Pushes only changed files, continues past per-file errors, and prints a summary line.

```bash
vaultcli sync run
vaultcli sync run --name "app/env-prod"    # one entry only
vaultcli sync run --dry-run               # preview without writing
vaultcli sync run --json                  # machine-readable output
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Limit run to a single registered entry |
| `--dry-run` | Preview changes without writing to Vault |

Summary output (human mode):

```
3 created, 1 updated, 5 unchanged, 0 errors
```

JSON envelope:

```json
{
  "success": true,
  "data": {
    "dryRun": false,
    "summary": { "created": 3, "updated": 1, "unchanged": 5, "errors": 0 },
    "results": [...]
  }
}
```

Exit code: **0** when there are no errors, **1** when one or more entries errored.

Quiet mode prints one line per changed or errored entry:

```
created app/env-prod
updated app/env-staging
```

#### `sync where`

Print the path to the local sync registry file.

```bash
vaultcli sync where
# → /home/user/.config/vaultcli/sync.json
```

---

### Running `sync` from Cron

`sync run` is designed to be called unattended. Authenticate once interactively (`vaultcli auth login`), then add a crontab entry. Because cron runs with a minimal environment, set `HOME`, `VAULTCLI_CONFIG_DIR`, and `PATH` explicitly and use absolute paths.

```cron
*/15 * * * * HOME=/home/USER VAULTCLI_CONFIG_DIR=/home/USER/.config/vaultcli PATH=/usr/local/bin:/usr/bin:/bin vaultcli sync run --json >> /home/USER/.local/state/vaultcli-sync.log 2>&1
```

The non-zero exit on errors makes the job alertable via standard cron mail or external monitoring.

**Prerequisites:**
- The CLI must already be authenticated. Run `vaultcli auth login` once; the PAT is stored at `~/.config/vaultcli/auth.json`.
- If using a local build instead of the installed symlink, use absolute paths to `node` and `bin/vaultcli.js`.

#### Sync Caveats

- The encrypted `notes` field on the Vault secret is the authoritative versioned copy. A storage attachment is also kept as a best-effort downloadable mirror — a failed or blocked upload logs a warning and does **not** fail the entry or change the exit code.
- Only UTF-8 text files are supported. A trailing-newline change counts as a real change.
- `sync run` operates on the authenticated user's own secrets.

---

## AI Agent Integration

The CLI is designed for seamless AI agent integration with `--json` and `-q` modes.

### Capture IDs for Chaining

```bash
# Create and capture the ID
SECRET_ID=$(vaultcli secrets create \
  --name "API Key" \
  --type-id <uuid> \
  --data '{"key":"sk-abc123"}' -q)

# Use the ID in subsequent commands
vaultcli secrets get "$SECRET_ID" --json
```

### Extract Fields from JSON

```bash
# Get a specific field value
vaultcli secrets get "AWS Prod" --json | jq -r '.data.values.secret_key'

# List all secret names
vaultcli secrets list --json | jq -r '.data.items[].name'

# Get type IDs and names
vaultcli types list --json | jq '.data.items[] | {id, name}'
```

### Secret Lifecycle Automation

```bash
# Create → Update → Check versions → Rollback
vaultcli secrets create --name "Config" --type-id $TYPE_ID --data '{"v":"1"}' -q
vaultcli secrets update "Config" --data '{"v":"2"}'
vaultcli versions list "Config" --json | jq '.data'
VERSION_ID=$(vaultcli versions list "Config" --json | jq -r '.data[1].id')
vaultcli versions rollback "Config" "$VERSION_ID"
```

### Error Handling in Scripts

```bash
if result=$(vaultcli secrets get "missing" --json 2>&1); then
  echo "Found: $(echo "$result" | jq -r '.data.name')"
else
  echo "Error: $(echo "$result" | jq -r '.error')"
fi
```

---

## Configuration

### Files

| File | Purpose | Permissions |
|------|---------|-------------|
| `~/.config/vaultcli/auth.json` | PAT token storage | `0600` |
| `~/.config/vaultcli/config.json` | Server URL override | `0600` |
| `~/.config/vaultcli/sync.json` | Sync registry (files and directories) | `0600` |

### Server URL Priority

1. `--server <url>` flag (highest)
2. `VAULTCLI_SERVER_URL` environment variable
3. Config file (`~/.config/vaultcli/config.json`)
4. Default: `https://vault.marin.cr`

---

## Security

- Tokens are stored with `0600` permissions (owner-only read/write)
- All communication uses HTTPS
- Secrets are encrypted at rest with AES-256-GCM on the server
- PAT tokens are hashed (SHA256) before storage on the server — raw tokens are never stored
- The CLI never caches or logs decrypted secret data

---

## Development

### Project Structure

```
tools/vaultcli/
├── bin/vaultcli.js          # Entry point
├── src/
│   ├── index.ts             # Commander CLI setup
│   ├── version.ts           # Version constant
│   ├── commands/            # Command implementations
│   │   ├── auth.ts          # auth login/logout/status
│   │   ├── secrets.ts       # secrets CRUD
│   │   ├── versions.ts      # version history
│   │   ├── types.ts         # secret types
│   │   ├── health.ts        # health checks
│   │   ├── config.ts        # config management
│   │   └── sync.ts          # sync add/add-dir/remove/list/status/run/where
│   ├── lib/                 # Core libraries
│   │   ├── api-client.ts    # HTTP client
│   │   ├── auth-store.ts    # Token persistence
│   │   ├── formatters.ts    # Human-readable output
│   │   └── sync-store.ts    # Sync registry persistence
│   └── utils/               # Shared utilities
│       ├── types.ts         # TypeScript interfaces
│       ├── output.ts        # OutputManager
│       └── config.ts        # Config handling
├── package.json
├── tsconfig.json
└── install.sh
```

### Dependencies

- **commander** — CLI framework
- **chalk** — Terminal colors

### Building

```bash
cd tools/vaultcli
npm run build         # Compile TypeScript
npm run dev           # Watch mode
npm run typecheck     # Type check only
```

---

## API Endpoints Used

| CLI Command | HTTP Method | API Endpoint |
|-------------|-------------|--------------|
| `auth login/status` | `GET` | `/api/auth/me` |
| `secrets list` | `GET` | `/api/secrets` |
| `secrets get (by ID)` | `GET` | `/api/secrets/:id` |
| `secrets get (by name)` | `GET` | `/api/secrets/by-name/:name` |
| `secrets create` | `POST` | `/api/secrets` |
| `secrets update` | `PUT` | `/api/secrets/:id` |
| `secrets delete` | `DELETE` | `/api/secrets/:id` |
| `versions list` | `GET` | `/api/secrets/:id/versions` |
| `versions get` | `GET` | `/api/secrets/:id/versions/:versionId` |
| `versions rollback` | `POST` | `/api/secrets/:id/versions/:versionId/rollback` |
| `types list` | `GET` | `/api/secret-types` |
| `types get` | `GET` | `/api/secret-types/:id` |
| `health live` | `GET` | `/api/health/live` |
| `health ready` | `GET` | `/api/health/ready` |
| `sync run` (create) | `POST` | `/api/secrets` |
| `sync run` (update) | `PUT` | `/api/secrets/:id` |
| `sync run` (read) | `GET` | `/api/secrets/by-name/:name` |
| `sync run` (attachment) | `POST` | `/api/storage/objects` |
