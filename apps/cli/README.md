# Vault CLI (`vault`)

The command-line client for **Vault**: signs in with a device flow, manages secrets, versions, backups and `.env` sync, and (for operators) deploys and runs worker nodes. Built for humans and AI agents.

`vault` is `createCli` of [`@marinoscar/platform-cli`](https://github.com/marinoscar/EnterpriseAppBase/tree/main/packages/platform-cli) plus Vault's own command groups. It replaces the two CLIs this repository used to carry: `vaultcli` (domain) and `app` (generic template). Coming from `vaultcli`? Read [Migrating from `vaultcli`](#migrating-from-vaultcli).

- **Platform commands** (the engine's, identical across apps): `init`, `login`, `api`, `config`, `node`, `deploy`, and a terminal UI when run with no arguments in a terminal.
- **Vault commands for scripts and agents**: `secrets`, `versions`, `types`, `sync`, `backup`, `admin backups`, `health`, `auth`, with `--json` / `-q` output.
- **Terminal menu for people**: `vault menu` is the guided backup menu: sign in, set up and run password-protected backups, list and clean up old ones, print a ready-made schedule entry. See [Quick start with the menu](#quick-start-with-the-menu).
- **Self-cleaning backups**: `vault backup` can save its settings once and delete old backups by age or count after each successful run. See [`backup`](#backup--password-protected-backup).
- **Server backups for administrators**: `vault admin backups` shows and changes the server's backup schedule, starts a backup, and lists, downloads and deletes the results. See [`admin backups`](#admin-backups--server-backups).

```
vault ──▶ Vault API ──▶ PostgreSQL (encrypted)
  │            │
  │ PAT Bearer │ AES-256-GCM at rest
```

## Install, Update & Uninstall

### Install (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/apps/cli/install.sh | bash
```

This clones the repo to `~/.vault-cli` (or reuses an existing `~/.vaultcli` checkout), installs dependencies, builds `apps/cli`, and creates symlinks at `/usr/local/bin/vault` and `/usr/local/bin/vault-update`. Needs Node.js 20 or later and git.

### Update

```bash
vault-update
# or re-run the install command
```

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/apps/cli/install.sh | bash -s -- --uninstall
```

### From a checkout of this repository

```bash
npm install
npm run cli:build                 # builds apps/cli
node apps/cli/dist/cli.js --help  # or: npm run vault -- --help
```

`apps/cli/dist/cli.js` is the executable; link it (`sudo ln -sf "$PWD/apps/cli/dist/cli.js" /usr/local/bin/vault`) to get a `vault` on your PATH.

### Version

```bash
vault --version      # e.g. 2.0.0 (platform 0.1.0-next.21)
```

### Environment Variables

The prefix is `VAULT_`, derived from `cliName` in `packages/shared/identity.json`. The pre-rename `VAULTCLI_` names still work; when both are set the `VAULT_` one wins.

| Variable | Description | Default |
|----------|-------------|---------|
| `VAULT_SERVER_URL` (alias `VAULTCLI_SERVER_URL`) | Server URL for this process; overrides the file written by `vault login` | the stored URL, else `https://vault.marin.cr` |
| `VAULT_TOKEN` | Personal access token for this process; overrides the stored token (useful in CI) | the stored token |
| `VAULT_CONFIG_DIR` (alias `VAULTCLI_CONFIG_DIR`) | Directory of the domain state files (`sync.json`, `backup.json`, `backup-password`, `backup.log`) | `~/.vault` |
| `VAULTCLI_BACKUP_PASSWORD` (alias `VAULT_BACKUP_PASSWORD`) | Default source of the `backup` archive password | unset (the CLI asks) |
| `VAULT_NO_UPDATE_CHECK` | Set to `1` to turn off the start-up "newer version available" line | unset |
| `VAULT_INSTALL_DIR` (alias `VAULTCLI_INSTALL_DIR`) | Where `install.sh` keeps its checkout | `~/.vault-cli` |

---

## Migrating from `vaultcli`

`vault` replaces `vaultcli` (and the generic `app` CLI). The domain commands keep their flags, output and exit codes; what moved is signing in, configuration and the binary name.

| `vaultcli` | `vault` |
|------------|---------|
| `vaultcli auth login` | `vault login` (device flow; `vault login --token <pat>` for an existing token) |
| `vaultcli auth status` / `auth logout` | `vault auth status` / `vault auth logout` (unchanged) |
| `vaultcli config show` | `vault config` |
| `vaultcli config set-url <url>` | `vault login --server <url>`, or `VAULT_SERVER_URL` |
| `vaultcli config reset` | delete `~/.vault/config.json`, or `vault auth logout` to drop only the token |
| `vaultcli secrets ...`, `versions ...`, `types ...`, `health ...` | same, with `vault` |
| `vaultcli sync ...` | `vault sync ...` (same registry, same flags) |
| `vaultcli backup ...`, `backup prune`, `backup config show|set|unset|reset` | `vault backup ...` (same flags, template tokens, retention and saved settings) |
| `vaultcli admin backups ...` | `vault admin backups ...` |
| `vaultcli` or `vaultcli -i` (terminal menu) | `vault menu` (`vault` alone opens the platform TUI) |
| `vaultcli --json secrets list` (flag before the group) | `vault secrets list --json` or `vault secrets --json list` (flags belong to the group) |
| `app ...` (generic template CLI: docker, prisma, settings, users, ...) | gone; use `vault api <method> <path>` for API calls and `vault deploy` / `vault node` for operations |

What stays the same: the `VAULTCLI_SERVER_URL`, `VAULTCLI_CONFIG_DIR` and `VAULTCLI_BACKUP_PASSWORD` variables are still read (the `VAULT_` names are preferred and win when both are set); scheduled jobs keep working because `auth.json`, `sync.json`, `backup.json` and `backup-password` are still found in `~/.config/vaultcli` or `$VAULTCLI_CONFIG_DIR`. Move them with `vault login` and by copying the files into `~/.vault` when convenient.

What to change: crontab / launchd / Task Scheduler entries that call `vaultcli` (re-generate them from `vault menu` > Backups > Schedule, or replace the command), the install location (`vault-update` replaces `vaultcli-update`), and any script that used `vaultcli config set-url` or `auth login` non-interactively (use `VAULT_SERVER_URL` and `VAULT_TOKEN`). The old `/usr/local/bin/vaultcli` symlink is not removed for you: `rm` it after switching.

---

## Quick Start

```bash
# 1. Authenticate (device flow: opens the browser, or prints a URL and code)
vault login --server https://vault.example.test

# 2. Browse available secret types
vault types list

# 3. Create a secret
vault secrets create \
  --name "AWS Production" \
  --type-id <uuid-from-types-list> \
  --data '{"access_key":"AKIAIOSFODNN7EXAMPLE","secret_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}'

# 4. List your secrets
vault secrets list

# 5. Retrieve a secret by name
vault secrets get "AWS Production"

# 6. View version history
vault versions list "AWS Production"
```

Prefer a guided menu? Run `vault menu`. It can sign you in, set up a password-protected backup with retention, run it and show how to schedule it: see [Quick start with the menu](#quick-start-with-the-menu).

---

## Authentication

Authentication is the platform's: `vault login` runs the **device flow** (the same one the web app approves) and stores a **personal access token** (starts with `pat_`) in `~/.vault/config.json` with mode `0600`.

### Login

```bash
vault login --server https://vault.example.test     # device flow: approve the code in your browser
vault login --token pat_xxxxxxxx                     # headless: paste an existing token
vault login --no-browser                             # print the URL and code, do not open a browser
```

Create a token by hand in the web app under **Settings > Personal Access Tokens** (copy it once; it is only shown once) and pass it with `--token`, or set `VAULT_TOKEN` for a single process (CI).

### Check Status

```bash
vault auth status          # who you are, and the server
vault config               # stored server URL and a masked token hint (platform command)
```

### Logout

```bash
vault auth logout          # removes the token from ~/.vault/config.json, keeps the server URL
```

A token left by `vaultcli auth login` (`~/.config/vaultcli/auth.json`, or `auth.json` in `$VAULTCLI_CONFIG_DIR`) is still read when there is no `VAULT_TOKEN` and no stored token, so existing scheduled jobs keep working; run `vault login` to move to the new file.

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
vault secrets list

# JSON — machine-readable
vault secrets list --json

# Quiet — one ID per line
vault secrets list -q
```

---

## Command Reference

### Global Flags

The domain groups (`auth`, `secrets`, `versions`, `types`, `health`, `sync`, `backup`, `admin`) accept these, before or after the subcommand (`vault secrets list --json`, `vault secrets --json list`). The platform commands (`login`, `api`, `config`, `node`, `deploy`) have their own flags: see `vault <command> --help`.

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `-q, --quiet` | Minimal output (IDs only) |
| `--server <url>` | Override server URL for this invocation |
| `--no-color` | Disable ANSI color codes |
| `-v, --verbose` | Show HTTP request details |

`vault --version` prints the CLI version and the platform engine's; `-h, --help` works on every command.

---

### Platform commands

| Command | What it does |
|---------|--------------|
| `vault login` | Device-flow sign-in (or `--token`); stores `~/.vault/config.json` |
| `vault config` | Shows the stored server URL and a masked token hint |
| `vault api <method> <path>` | Calls any API endpoint (`--data`, `--query`, `--raw`) |
| `vault init` | Creates `infra/compose/.env` for a fresh checkout |
| `vault deploy ...` | `doctor`, `install`, `update`, `status`, `about`, `list`, `certs`, `uninstall` for a VPS deployment |
| `vault node ...` | Runs this machine as a worker node for the job queue |
| `vault` (no arguments, in a terminal) | The platform's terminal UI |

Their full reference is the platform CLI's `--help` and README (`node_modules/@marinoscar/platform-cli/README.md`).

---

### `auth` — Authentication

```bash
vault auth status             # Show current auth state
vault auth logout             # Clear the stored token
vault auth login              # Moved: tells you to run "vault login"
```

---

### `secrets` — Secret Management

Secrets can be referenced by **UUID** or by **name** (unique per user). The CLI auto-detects UUID format.

#### `secrets list`

```bash
vault secrets list
vault secrets list --search "aws"
vault secrets list --type-id <uuid> --sort name --order asc
vault secrets list --page 2 --page-size 10
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
vault secrets get "AWS Production"       # By name
vault secrets get abc12345-...           # By UUID
vault secrets get "AWS Production" --json | jq '.data.values.secret_key'
```

Returns full secret detail with **decrypted data**, version info, and attachments.

#### `secrets create`

```bash
vault secrets create \
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
vault secrets update "Database Prod" --description "Updated description"

# Update data (creates a new version)
vault secrets update "Database Prod" --data '{"host":"db.example.com","port":"5432","username":"admin","password":"n3w_p@ss"}'

# Rename
vault secrets update "Database Prod" --name "DB Production"
```

| Option | Description |
|--------|-------------|
| `--name <name>` | New name |
| `--description <text>` | New description (use `""` to clear) |
| `--data <json>` | New data (creates a new version) |

#### `secrets delete <id-or-name>`

```bash
vault secrets delete "Database Prod"
vault secrets delete abc12345-...
```

---

### `versions` — Version History

Every data change creates an immutable version. You can inspect any version and rollback.

#### `versions list <secret-id-or-name>`

```bash
vault versions list "AWS Production"
```

Shows all versions with version number, current marker, creator, and timestamp.

#### `versions get <secret-id-or-name> <version-id>`

```bash
vault versions get "AWS Production" <version-uuid>
```

Returns the version with **decrypted data** so you can compare with the current version.

#### `versions rollback <secret-id-or-name> <version-id>`

```bash
vault versions rollback "AWS Production" <version-uuid>
```

Creates a **new version** with the data from the specified old version. The old version is preserved.

---

### `types` — Secret Types

Secret types define the field schema for secrets (field names, types, required, sensitive flags).

#### `types list`

```bash
vault types list
vault types list --search "login"
```

#### `types get <id>`

```bash
vault types get <uuid>
```

Shows the full field definitions table: field name, label, type, required, sensitive.

---

### `health` — Server Health

No authentication required.

```bash
vault health live          # Is the process running?
vault health ready         # Is the server ready (DB connected)?
```

---

### `menu` — interactive terminal menu

```bash
vault menu            # alias: vault interactive; needs a terminal on stdin and stdout
```

Opens the guided backup menu (see [Quick start with the menu](#quick-start-with-the-menu)). It is not the platform's TUI, which `vault` with no arguments opens.

---

### `sync` — Local File Sync

Keep local `.env` files (or any UTF-8 text files) backed up in Vault as **Document-type secrets**, with full version history. Designed to run unattended from cron. Change detection is client-side via SHA-256 — unchanged files are skipped and no new version is created.

The local registry is persisted at `~/.vault/sync.json` (mode `0600`; honors `VAULT_CONFIG_DIR` / `VAULTCLI_CONFIG_DIR`). Registration is local-only; the Vault secret is created lazily on the first `sync run`. Removing an entry only unregisters it locally — it does **not** delete the Vault secret.

#### `sync add`

Register a single file.

```bash
vault sync add --name "app/env-prod" --path /home/user/myapp/.env.production
vault sync add --name "app/env-prod" --path /home/user/myapp/.env.production \
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
vault sync add-dir --path /home/user/myapp
vault sync add-dir --path /home/user/myapp --pattern "*.env" --recursive
vault sync add-dir --path /home/user/myapp --name-prefix "myapp"
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
vault sync remove "app/env-prod"
vault sync remove /home/user/myapp/.env.production
vault sync remove /home/user/myapp          # removes the directory entry
```

#### `sync list`

Offline listing of all registered files and watched directories. Shows cached status and last-synced date without contacting the server.

```bash
vault sync list
vault sync list --json
```

Status values: `not-yet-created`, `synced (vN)`.

#### `sync status`

Dry run — compares each file against Vault and reports what would happen, without writing anything. Exits non-zero if any entry errored.

```bash
vault sync status
vault sync status --name "app/env-prod"
```

Report values: `would-create`, `would-update`, `unchanged`, `error`.

#### `sync run`

The primary command and cron entry point. Pushes only changed files, continues past per-file errors, and prints a summary line.

```bash
vault sync run
vault sync run --name "app/env-prod"    # one entry only
vault sync run --dry-run               # preview without writing
vault sync run --json                  # machine-readable output
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
vault sync where
# → /home/user/.config/vault/sync.json
```

---

### Running `sync` from Cron

`sync run` is designed to be called unattended. Authenticate once interactively (`vault login`), then add a crontab entry. Because cron runs with a minimal environment, set `HOME` (or `VAULT_CONFIG_DIR`) and `PATH` explicitly and use absolute paths; `VAULT_TOKEN` and `VAULT_SERVER_URL` can supply the credentials instead of the stored file.

```cron
*/15 * * * * HOME=/home/USER PATH=/usr/local/bin:/usr/bin:/bin vault sync run --json >> /home/USER/.local/state/vault-sync.log 2>&1
```

The non-zero exit on errors makes the job alertable via standard cron mail or external monitoring.

**Prerequisites:**
- The CLI must already be authenticated. Run `vault login` once; the PAT is stored at `~/.vault/config.json` (or provide `VAULT_TOKEN`).
- If using a local build instead of the installed symlink, use absolute paths to `node` and `apps/cli/dist/cli.js`.

#### Sync Caveats

- The encrypted `notes` field on the Vault secret is the authoritative versioned copy. A storage attachment is also kept as a best-effort downloadable mirror — a failed or blocked upload logs a warning and does **not** fail the entry or change the exit code.
- Only UTF-8 text files are supported. A trailing-newline change counts as a real change.
- `sync run` operates on the authenticated user's own secrets.

---

### `backup` — Password-Protected Backup

Downloads an **AES-256 encrypted zip** of the data you own, protected by a password you choose. By default that is your secrets (decrypted values, a readable `secrets.html` report, `secrets.json`, and attachments); you can add old versions and your media library, or back up media only. It calls `POST /api/secrets/export`, so it produces exactly the same file as **Settings > Back up my data** in the web app. What is inside the archive, the password trade-offs and the warnings: [docs/SECRETS.md § Backup and export](../../docs/SECRETS.md#backup-and-export).

Open the file with 7-Zip (Windows), Keka or The Unarchiver (macOS), or `7z x` / File Roller (Linux). The built-in Windows and macOS zip tools cannot open AES zips.

Three ways to use it, from easiest to most scriptable:

1. The **terminal menu** (`vault menu`): a guided setup that saves your choices, then runs, lists, cleans up and schedules backups. See [Quick start with the menu](#quick-start-with-the-menu).
2. **Saved settings** (`vault backup config ...`): set your choices once, then `vault backup` needs no flags. See [Saved settings](#saved-settings-backupjson).
3. **Flags** on every run, for one-off or fully scripted use.

#### Quick start with the menu

Run `vault menu` to open the menu (`vault` with no arguments opens the platform's terminal UI instead). It needs a real terminal: when stdin or stdout is not a terminal (a pipe, cron), `vault menu` refuses to start with an error. Use arrow keys and Enter; Ctrl+C exits at any time.

```
vault 2.0.0  (Ctrl+C to exit; run "vault --help" for all commands)
? Main menu
  Backups ▸
  Admin backups ▸        (only with system_settings:read)
  Sign in / status
  Exit
```

The main menu has these entries besides Exit:

- **Sign in / status** shows the server and who you are signed in as. If you are not signed in it offers to paste a personal access token (`pat_...`, created under **Settings > Personal Access Tokens**) and validates it. When signed in it lets you sign in with a different token or sign out (removes the stored token). It stores the token the same way as `vault login --token`.
- **Admin backups** manages the server's backups of every user. It is shown only to users with `system_settings:read` (and is hidden when you are signed out). See [Admin backups in the menu](#admin-backups-in-the-menu).
- **Backups** opens this submenu:

| Entry | What it does |
|-------|--------------|
| Run a backup now | Backs up with your saved settings. Gets the password from the saved source, or asks (with confirmation) if there is none. Then applies retention, if it is on, and shows the result. |
| Set up backups | The wizard, described below. |
| View backup settings | Shows the saved settings file, the path the next backup would be written to, the password source, the contents, time zone and retention. |
| List backups | Lists the files that match your output template with size and age, and marks those retention would delete. |
| Clean up old backups now | Previews what retention would delete, asks for confirmation (default No), then deletes. Needs retention to be set up first. |
| Schedule backups | Asks for a daily time (`HH:MM`, default `02:30`) and prints the exact cron line, launchd plist or `schtasks` command for your operating system, with warnings about anything that would make a scheduled run fail. It shows the entry; **it installs nothing**. |

**The "Set up backups" wizard** asks, in order:

1. UTC or local time for dates in file names.
2. The output file name template, with a live preview of the resulting path as you type (default suggestion `~/vault-backups/vault-backup-{datetime}.zip`).
3. Where backups get their password: create a password file in the config folder (`<config dir>/backup-password`, mode `0600`; you type the password twice), use an existing password file, read an environment variable, or ask every time (scheduled backups will not work with this one).
4. **What do you want to back up?** A checkbox list (space to toggle): secrets, attachments, old versions, media library. Secrets and attachments are ticked by default. It refuses an empty selection, and attachments or versions without secrets.
5. Retention: delete backups older than how many days (the menu suggests **30**; blank or `0` means never), and keep at most how many backups (blank means no limit).
6. A summary, then "Save these settings?". Nothing is written until you confirm.

The wizard writes [`backup.json`](#saved-settings-backupjson); the password itself is only ever written to the password file, never to `backup.json`.

From zero to a scheduled, self-cleaning backup:

```bash
vault                      # Sign in / status: paste a token
                              # Backups > Set up backups: pick a template, a password file, 30 days
                              # Backups > Run a backup now: check that it works
                              # Backups > Schedule backups: copy the printed entry into your scheduler
```

The same thing without the menu:

```bash
vault login
printf '%s\n' 'blue tiger river' > ~/.vault/backup-password && chmod 600 ~/.vault/backup-password
vault backup config set \
  --output "~/vault-backups/vault-backup-{datetime}.zip" \
  --password-file ~/.vault/backup-password \
  --keep-days 30
vault backup          # test it
# then schedule `vault backup --json`; see "Scheduled Backups" below
```

#### Command reference

```bash
vault backup                                   # prompts for a password, writes ./vault-backup-<datetime>.zip
vault backup -o "~/backups/{year}/{month}/vault-{datetime}.zip"
VAULTCLI_BACKUP_PASSWORD='blue tiger river' vault backup --json
vault backup --password-file ~/.vault-backup-pw --include-versions --no-attachments
vault backup --media                                                 # secrets, attachments and your media library
vault backup --contents media                                        # only the media library
vault backup --contents secrets,attachments,versions,media           # everything you own
vault backup -o "~/backups/vault-{datetime}.zip" --keep-days 30      # back up, then delete backups older than 30 days
vault backup --keep-last 10 --prune-dry-run                          # back up, show what cleanup would delete
vault backup --no-prune                                              # back up, skip the saved retention this once
```

##### `backup` options

Every option below overrides the saved setting of the same name for that run only; see [Precedence](#precedence).

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <template>` | Output path template (see tokens below) | `vault-backup-{datetime}.zip` |
| `--password-env <VAR>` | Read the password from this environment variable | `VAULTCLI_BACKUP_PASSWORD` |
| `--password-file <path>` | Read the password from a file (first line, trimmed) | - |
| `-p, --password <pw>` | Password on the command line (warns: visible in the process list and shell history). Never saved | - |
| `--contents <list>` | What to back up, comma separated: `secrets`, `attachments`, `versions`, `media`. Overrides the four flags below; keys not listed are left out. An unknown key is an error that lists the valid ones | - |
| `--secrets` / `--no-secrets` | Include or exclude secrets. `--no-secrets` also drops attachments and versions | secrets included |
| `--attachments` / `--no-attachments` | Include or exclude attachments (needs secrets) | attachments included |
| `--include-versions` / `--no-include-versions` | Include every version of each secret, or only the current ones (needs secrets) | current versions only |
| `--media` / `--no-media` | Include or exclude your media library (folders and files) | media excluded |
| `--overwrite` | Replace an existing file instead of adding `-1`, `-2` ... | off |
| `--utc` / `--no-utc` | Use UTC or local time for the date/time tokens | local time |
| `--keep-days <n>` | After a successful backup, delete backups older than `n` days | off |
| `--keep-last <n>` | After a successful backup, keep only the `n` newest backups | off |
| `--no-prune` | Skip retention for this run, even if saved settings turn it on | retention runs if configured |
| `--prune-dry-run` | Show what retention would delete, delete nothing | off |
| `--json` | Machine-readable result (global flag) | off |

`--keep-days` and `--keep-last` must be whole numbers of at least 1. The negated forms (`--no-attachments`, `--no-include-versions`, `--no-media`, `--no-utc`) exist so a run can override a saved `true`.

At least secrets or media must be selected, and attachments or versions need secrets; otherwise the command fails before any request. With `--no-secrets`, saved attachment and version settings are ignored. System configuration is not offered here: it exists only in the administrator's backup.

##### `backup prune` — clean up without backing up

Applies the retention rules to existing backups without making a new one.

```bash
vault backup prune --keep-days 30 --dry-run     # preview
vault backup prune --keep-days 30               # preview, ask "Delete N backup(s)? [y/N]", delete
vault backup prune --yes                        # unattended, uses the saved limits
```

| Option | Description |
|--------|-------------|
| `-o, --output <template>` | The template the backups were written with (default: the saved output, else the built-in default) |
| `--keep-days <n>` | Delete backups older than `n` days (default: saved `keepDays`) |
| `--keep-last <n>` | Keep only the `n` newest backups (default: saved `keepLast`) |
| `--dry-run` | Only show what would be deleted |
| `-y, --yes` | Do not ask for confirmation. **Required when not run in a terminal** |

With no limits from flags or saved settings, `prune` fails and tells you how to set one. Without `--yes` or `--dry-run` it shows the plan and asks for confirmation (default No); when there is nothing to delete it just says so. In a non-interactive context (cron, a pipe) it refuses to delete rather than guess: pass `--yes`, or `--dry-run` to preview. Exit code `1` if any file could not be deleted. Options that only belong to `backup` itself (for example `--password`) are rejected on `prune` and `config` subcommands. With `--json`:

```json
{
  "success": true,
  "data": {
    "dryRun": true,
    "root": "/home/user/vault-backups",
    "keepDays": 30,
    "keepLast": null,
    "deleted": [],
    "wouldDelete": ["/home/user/vault-backups/vault-backup-2026-09-01_023000.zip"],
    "kept": 29,
    "errors": []
  }
}
```

In `-q` mode `prune` prints one path per line (the files it deleted, or would delete with `--dry-run`).

##### `backup config` — saved settings

```bash
vault backup config show                        # saved values, effective values and where each comes from
vault backup config set --output "~/vault-backups/vault-{datetime}.zip" --keep-days 30
vault backup config set --password-file ~/.vault/backup-password --keep-last 14
vault backup config unset keep-days             # turn one setting back to its default
vault backup config reset                       # delete backup.json
```

| Subcommand | What it does |
|------------|--------------|
| `show` | Prints the file location and, for every key, its effective value and whether it is `saved` or a `default`, plus whether retention is on. `--json` returns `file`, `saved`, `effective` and `sources`; `-q` prints the saved settings as one JSON line. |
| `set [options]` | Saves the options you give and leaves the rest alone. Takes `-o/--output`, `--password-env`, `--password-file`, `--contents` (sets all four content settings), `--secrets`/`--no-secrets`, `--attachments`/`--no-attachments`, `--include-versions`/`--no-include-versions`, `--media`/`--no-media`, `--utc`/`--no-utc`, `--keep-days`, `--keep-last`. Fails if you give none. There is no `--password`: the password is never saved. |
| `unset <key...>` | Removes one or more saved keys. Keys are the camelCase names below; kebab-case (`keep-days`) is accepted too. |
| `reset` | Deletes `backup.json`. |

Details: the output template is validated when saved (an unknown `{token}` is rejected). `--password-file` is stored as an absolute path (a leading `~` is expanded). A password source is a single choice: saving `--password-file` removes a saved `passwordEnv`, and the other way round. A relative output path is accepted but resolved against the folder `vault` runs in, so use an absolute path or one starting with `~` for anything scheduled.

#### Saved settings (`backup.json`)

Saved settings live in `backup.json` in the config directory (`~/.vault/` by default, or `$VAULT_CONFIG_DIR` / `$VAULTCLI_CONFIG_DIR`; a `backup.json` that only exists in `~/.config/vaultcli/` is used there until you save a copy in the new place), written with mode `0600`. `vault backup config show` prints the exact path. Only these keys are stored; anything else in the file (including any `password`) is ignored:

```json
{
  "output": "~/vault-backups/vault-backup-{datetime}.zip",
  "passwordFile": "/home/user/.config/vault/backup-password",
  "includeSecrets": true,
  "includeAttachments": true,
  "includeVersions": false,
  "includeMedia": false,
  "utc": false,
  "keepDays": 30,
  "keepLast": 14
}
```

| Key | Type | Meaning | Default when not saved |
|-----|------|---------|------------------------|
| `output` | string | Output path template | `vault-backup-{datetime}.zip` |
| `passwordFile` | string | Path of a file whose first line is the password | none |
| `passwordEnv` | string | Name of an environment variable holding the password | none (`VAULTCLI_BACKUP_PASSWORD` is still used if set) |
| `includeSecrets` | boolean | Include secrets | `true` |
| `includeAttachments` | boolean | Include attachments (needs secrets) | `true` |
| `includeVersions` | boolean | Include every version of each secret (needs secrets) | `false` |
| `includeMedia` | boolean | Include your media library | `false` |
| `utc` | boolean | UTC instead of local time for date/time tokens | `false` |
| `keepDays` | whole number >= 1 | Retention: delete backups older than this many days | off |
| `keepLast` | whole number >= 1 | Retention: keep only this many newest backups | off |

An invalid file (bad JSON, wrong types, unknown template token) makes `backup` fail with an error that names the file, instead of being half-applied.

**The password is never saved.** `backup.json` records only *where* to read it from (`passwordFile` or `passwordEnv`). The only place the CLI writes a password is the `0600` password file the menu's wizard creates when you choose that option.

##### Precedence

For every setting: **command-line flag > saved setting > built-in default.** Settings are merged key by key, so `vault backup --keep-last 3` uses `--keep-last 3` together with the saved output and the saved `keepDays`. The exception is the password source, which is treated as a group: naming any password source on the command line (`--password-file` or `--password-env`) ignores both saved password sources for that run.

##### Password source order

For `backup` the first source present wins:

1. `--password`
2. `--password-file` (first line, trimmed; fails if unreadable or empty)
3. `--password-env <VAR>`; fails if that variable is unset or empty
4. Saved `passwordFile`
5. Saved `passwordEnv`
6. The `VAULTCLI_BACKUP_PASSWORD` environment variable, if set
7. A hidden interactive prompt with confirmation, only when stdin is a terminal
8. Otherwise the command **fails immediately** with a message naming the options; it never hangs waiting for input, so scheduled runs are safe.

A saved source that turns out to be unreadable, empty or unset is an error in a scheduled run; in a terminal it warns and asks for the password instead. A source you named with a flag is always a hard error when broken. The password must be 6 to 256 characters; this is checked locally before any request. There are no complexity rules, but a longer passphrase is much safer: see the [password trade-off](../../docs/SECRETS.md#password-policy-and-the-honest-trade-off). There is no password recovery. Prefer a password file (mode `0600`) or the environment variable over `--password`.

#### Retention

Retention deletes old backup files after a successful backup so a scheduled job does not fill the disk. **It is off until you configure it**: nothing is ever deleted unless `keepDays` or `keepLast` is set, by flag or in `backup.json`. The menu's setup wizard suggests 30 days, but never applies it without you confirming.

A backup is deleted when it is **older than `keepDays` days OR outside the `keepLast` newest** (if you set both, either condition is enough). Age is the file's modification time (mtime), so copying or touching files with tools that reset mtime changes how old they look.

Safety rules:

- **Template matching only.** Only files whose full path could have been produced by the output template are candidates: `{date}` must look like a date, `{datetime}` like `2026-11-01_203015`, a literal part must match exactly, and the `-1`, `-2` suffix added for collisions is allowed. Everything else in the folder is left alone. Directories in the template that contain tokens (`{year}/{month}`) are searched too, to exactly the depth the template has.
- **The newest backup is always kept**, even if it is past its age or outside the count. So is the file the current run just wrote.
- **Symlinks, directories and other files are ignored.** Symlinks are never followed or deleted; only regular files are considered. `.partial` files from an unfinished download never match.
- **Runs only after a successful backup.** A failed backup deletes nothing.
- **A cleanup failure never fails the backup.** If retention cannot run or a file cannot be deleted, `backup` prints a warning (in `--json`, the details go in `prune.errors`) and still exits `0`. The backup file is kept.
- **Re-checked before each delete.** Each file is confirmed to still be a matching regular file immediately before it is removed.
- **Non-terminal `backup prune` needs `--yes`.** It will not delete unattended without it. (`backup --keep-days ...` needs no `--yes`: the limits you passed or saved are the consent.)
- **Preview first.** `--prune-dry-run` (on `backup`) and `--dry-run` (on `backup prune`) show the plan; the menu's **List backups** marks the files that would go.

Because only files matching the *current* template are touched, changing `output` leaves backups made with the old template in place. Run `backup prune -o "<old template>" ...` to clean those up.

With `--json`, a `backup` run reports both parts:

```json
{
  "success": true,
  "data": {
    "backup": {
      "path": "/home/user/vault-backups/vault-backup-2026-11-01_023000.zip",
      "size": 48213,
      "secrets": 12,
      "attachments": 5,
      "includeAttachments": true,
      "includeVersions": false,
      "overwritten": false
    },
    "prune": {
      "dryRun": false,
      "root": "/home/user/vault-backups",
      "keepDays": 30,
      "keepLast": null,
      "deleted": ["/home/user/vault-backups/vault-backup-2026-09-30_023000.zip"],
      "wouldDelete": [],
      "kept": 30,
      "errors": []
    }
  }
}
```

`prune` is `null` when retention is off or `--no-prune` was given. `wouldDelete` is filled only with `--prune-dry-run`. If the cleanup itself failed, `prune.errors` holds `{"path": null, "error": "..."}`.

#### Output template tokens

The `-o` value may contain directories; missing folders are created. A leading `~` expands to your home directory. An unknown `{token}` is an error that lists the valid ones (checked before you are asked for a password). Token values only use filesystem-safe characters (no `:`), so the names work on Windows.

| Token | Meaning | Example |
|-------|---------|---------|
| `{date}` | `YYYY-MM-DD` | `2026-11-01` |
| `{time}` | `HHmmss` | `203015` |
| `{datetime}` | `YYYY-MM-DD_HHmmss` | `2026-11-01_203015` |
| `{timestamp}` | Unix seconds | `1793564415` |
| `{year}` `{month}` `{day}` | Zero-padded date parts | `2026` `11` `01` |
| `{hour}` `{minute}` `{second}` | Zero-padded time parts | `20` `30` `15` |
| `{host}` | This machine's host name, sanitized | `build-server-1` |
| `{user}` | Local part of the signed-in user's email, sanitized (looked up from the server only if the template uses it) | `person.a` for `person.a@example.test` |

Date/time tokens use local time unless `--utc` is given. Examples:

```bash
vault backup -o "/srv/backups/vault-{host}-{date}.zip"      # /srv/backups/vault-build-server-1-2026-11-01.zip
vault backup -o "~/backups/{year}/{month}/{user}-{datetime}.zip"
vault backup -o "vault-{timestamp}.zip" --utc
```

#### Existing files, partial files and permissions

- **Never silently overwrites.** If the target exists, `-1`, `-2`, ... is added before the extension (`vault-2026-11-01-1.zip`, then `-2`). `--overwrite` replaces the existing file instead.
- The download is written to `<target>.partial` first and renamed into place only after it completes. On any failure, or on Ctrl-C / SIGTERM, the `.partial` file is deleted, so a half-written backup is never left under the final name.
- The file is created with mode `0600` (owner read/write only). Windows filesystems do not honour Unix modes, so keep the destination folder private there.

#### Output and exit codes

Human mode prints the path, size, secret, attachment and media file counts (from the `X-Vault-Export-*` headers; media shows `excluded` when not selected), the version scope, the retention outcome (what was deleted and how many backups were kept), and a reminder to keep the password safe. With `--json` the result is the envelope shown under [Retention](#retention): `data.backup` is the backup and `data.prune` the cleanup. `secrets` / `attachments` are `null` if the server did not send the count headers; `mediaFiles` is `0` when media was not included, and the backup lists its selected `contents`. In `-q` mode only the backup path is printed (retention problems go to stderr).

| Exit code | Meaning |
|-----------|---------|
| `0` | Backup saved (even if the follow-up cleanup warned) |
| `1` | Any failure: not authenticated, bad template or password, invalid `backup.json`, server error, or an incomplete or empty download. With `--json` the error goes to stderr as `{"success": false, "error": "...", "code": "backup_failed"}`. `backup prune` also exits `1` when a file could not be deleted |
| `130` | Interrupted by SIGINT / SIGTERM (the partial file is removed) |

Warnings about attachments or media files that could not be exported are inside the archive (`README.txt`, `secrets.json`), not on the CLI's output: check them occasionally.

---

### Scheduled Backups

`backup` is built for unattended use: it never prompts when stdin is not a terminal, it exits non-zero on failure, and it never leaves a partial file behind. With [saved settings](#saved-settings-backupjson) the scheduled command is just `vault backup --json`: the template, password source and retention come from `backup.json`, so the scheduler entry stays short and the password never appears in a crontab or task definition.

**Step 1: authenticate.** The CLI authenticates with the Personal Access Token stored by `vault login` in `~/.vault/config.json` (long-lived), or supplied in the job's environment as `VAULT_TOKEN`. Run `vault login` once, interactively, as the same OS user the scheduler will run as, and make sure the job can find that config: set `HOME` (`USERPROFILE` on Windows) and, if needed, `VAULT_CONFIG_DIR`. Consider creating a dedicated PAT for the job so it can be revoked on its own. If the PAT is revoked, scheduled runs fail with exit code 1.

**Step 2: save the settings** (or use the menu's **Set up backups**). Store the password in a file readable only by the job's user, and use an **absolute** output path (or one starting with `~`), because a scheduled job runs in a different folder than your shell:

```bash
umask 077
printf '%s\n' 'blue tiger river' > ~/.vault/backup-password   # use your own passphrase
chmod 600 ~/.vault/backup-password

vault backup config set \
  --output "/home/USER/backups/vault-{date}.zip" \
  --password-file ~/.vault/backup-password \
  --keep-days 30
vault backup config show          # check it
vault backup --prune-dry-run      # try it once by hand
```

If the job needs a different config folder, the same `VAULT_CONFIG_DIR` (or `VAULTCLI_CONFIG_DIR`) must be set for the job, because `backup.json` lives there. A password stored next to the job is only as safe as that machine: anyone who can read both the backup and the password file can open the backup, so copy backups off-host where you can. To use an environment variable instead, run `vault backup config set --password-env VAULTCLI_BACKUP_PASSWORD` and set that variable in the scheduler's own environment (a crontab is often readable by more people than you expect, so prefer the file).

**Step 3: schedule `vault backup --json`.** The menu's **Schedule backups** prints a ready-made entry with the correct paths for your system; the recipes below are the same idea written by hand. Replace `USER`.

#### Linux (cron)

Daily at 02:30, with `HOME` and `PATH` set explicitly because cron runs with a minimal environment:

```cron
30 2 * * * HOME=/home/USER PATH=/usr/local/bin:/usr/bin:/bin vault backup --json >> /home/USER/.local/state/vault-backup.log 2>&1
```

The non-zero exit code makes failures detectable by an external monitor; the log file keeps the JSON result (including what retention deleted) and any error message.

#### macOS (launchd)

Save as `~/Library/LaunchAgents/test.example.vault-backup.plist`, adjust the paths and user, then load it with `launchctl load ~/Library/LaunchAgents/test.example.vault-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>test.example.vault-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/vault</string>
    <string>backup</string>
    <string>--json</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/Users/USER</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/USER/Library/Logs/vault-backup.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/USER/Library/Logs/vault-backup.log</string>
</dict>
</plist>
```

If the Mac was asleep at 02:30, launchd runs the job when it wakes. Check the last result with `launchctl list | grep vault-backup` (the second column is the last exit status).

#### Windows (Task Scheduler)

Save the settings first (Step 2), with a password file only your account can read. In PowerShell:

```powershell
# One-time: save the password (use your own passphrase) and restrict the file to your account
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\vault", "$env:USERPROFILE\Backups" | Out-Null
Set-Content -Path "$env:USERPROFILE\.config\vault\backup-password" -Value "blue tiger river"
icacls "$env:USERPROFILE\.config\vault\backup-password" /inheritance:r /grant:r "${env:USERNAME}:(R)"

# One-time: save the settings (retention included)
vault backup config set --output "$env:USERPROFILE\Backups\vault-{date}.zip" --password-file "$env:USERPROFILE\.config\vault\backup-password" --keep-days 30

# Register the task: daily at 02:30
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c vault backup --json >> `"$env:USERPROFILE\Backups\vault-backup.log`" 2>&1"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30am
Register-ScheduledTask -TaskName "VaultCLI Backup" -Action $action -Trigger $trigger
```

The same with `schtasks` from a Command Prompt:

```bat
schtasks /Create /SC DAILY /ST 02:30 /TN "VaultCLI Backup" /TR "cmd /c vault backup --json >> %USERPROFILE%\Backups\vault-backup.log 2>&1"
```

The task must run as the user who ran `vault login`, and the `Backups` folder must exist for the log file (the CLI creates missing folders for the backup itself). Check the result with `schtasks /Query /TN "VaultCLI Backup" /V /FO LIST`: a "Last Result" of `0` means success. Open the zip with 7-Zip.

#### Retention in scheduled runs

Old backups are cleaned up by the same scheduled command, so no separate cleanup job is needed: every successful run applies the saved `keepDays` / `keepLast` and deletes only files that match the saved output template (see [Retention](#retention) for the safety rules). A failed backup deletes nothing, and a cleanup problem shows up as a warning in the log without failing the job. To adjust it, change the saved limits (`vault backup config set --keep-days 60`); to pause it for a while, `vault backup config unset keep-days keep-last`.

Age is measured from each file's modification time. If you copy backups with a tool that resets mtime, or restore them from another disk, they look newer than they are and survive longer. To clean a folder that no longer matches the current template, use `vault backup prune -o "<template>" --keep-days <n> --yes`.

Test a restore occasionally: open one backup with 7-Zip using the password and check that `secrets.html` looks right.

---

### `admin backups` — Server Backups

For administrators. These commands manage the **server's own backups** of every user's data in object storage: the schedule, running one now, and the history. They are separate from `vault backup`, which downloads your own data. What a backup contains, the zip layout and the password risks: [docs/SECRETS.md § Scheduled backups (admin)](../../docs/SECRETS.md#scheduled-backups-admin). The routes are listed in [API.md](../../docs/API.md#backups-admin).

Reading (`schedule show`, `list`) needs `system_settings:read`. Everything else needs `system_settings:write`; without it the command stops with a message saying an administrator is required. Run `vault admin backups --help`, or `--help` on any subcommand, for the flags.

```bash
vault admin backups schedule show
vault admin backups schedule set --enable --frequency daily --at 03:00 --timezone America/Chicago --keep 14
vault admin backups schedule set --frequency weekly --day sun --at 02:30 --password-prompt
vault admin backups schedule set --contents secrets,attachments,system
vault admin backups run --wait
vault admin backups list
vault admin backups download <id> -o ~/backups/
vault admin backups delete <id> --yes
```

| Command | What it does |
|---------|--------------|
| `schedule show` | Prints the schedule in plain words, the next and last run, whether a password and storage are configured, and the contents. `--json` returns the schedule object. |
| `schedule set [options]` | Reads the current schedule, applies the options given and saves the whole schedule. Fails if you give none. |
| `run [--wait]` | Starts a backup now (saved to storage, with the stored password and the schedule's contents) and prints its id. With `--wait` it polls every 5 seconds until it finishes and exits `1` if it failed. |
| `list [--page n] [--page-size n]` | Lists backups, newest first: id, start time, trigger, status, size, counts and contents. `--page-size` is 1 to 100 (default 20). |
| `download <id> [-o path] [--overwrite]` | Downloads an archive. `-o` is a file or a folder (default: the server's file name in the current folder). |
| `delete <id> [-y]` | Deletes the archive from storage; the run stays in the history. |

There is no endpoint that returns a single run, so `run --wait` polls the list and finds the run by id. If the run drops out of the list, it fails with an error.

##### `schedule set` options

Only the options given change; the rest keep their current values. Fields a frequency does not use are cleared. Every option can be combined.

| Option | Description |
|--------|-------------|
| `--enable` / `--disable` | Turn scheduled backups on or off. Enabling needs a password and configured storage. |
| `--frequency <f>` | `hourly`, `daily`, `weekly` or `monthly`. |
| `--every <hours>` | Hourly only: 1, 2, 3, 4, 6, 8 or 12. Runs on the hour, counted from local midnight. |
| `--at <HH:mm>` | Daily, weekly and monthly: time of day, 24 hours. **Refused with an hourly schedule** ("`--at` does not apply to an hourly schedule"); use `--every`. |
| `--day <day>` | Weekly only: `mon`..`sun`, or `0`-`6` (0 = Sunday). |
| `--day-of-month <n>` | Monthly only: 1 to 28. |
| `--timezone <IANA>` | For example `America/Chicago` or `UTC`. |
| `--keep <n>` | How many successful backups to keep, 1 to 365. |
| `--contents <list>` | What to back up, comma separated: `secrets`, `attachments`, `versions`, `media`, `system`. Overrides the flags below. |
| `--secrets` / `--no-secrets` | Every user's secrets (`--no-secrets` also drops attachments and versions). |
| `--attachments` / `--no-attachments` | Secret attachments (needs secrets). |
| `--include-versions` / `--no-include-versions` | Old secret versions (needs secrets). |
| `--media` / `--no-media` | Every user's media library. |
| `--system` / `--no-system` | System configuration: users and roles, allowlist, custom secret types, settings. |
| `--password-prompt` | Set a new backup password, typed twice at a hidden prompt (needs a terminal). |
| `--password-env <VAR>` | Set a new backup password read from this environment variable. |
| `--password-file <path>` | Set a new backup password read from a file (first line, trimmed). |

Use only one password option. The password is sent only when one is given, otherwise the stored one is kept, and it is never shown again. It is 6 to 256 characters. **One password protects every user's data and cannot be recovered**. Other options that do not fit the chosen frequency (`--every` without hourly, `--day` without weekly, `--day-of-month` without monthly) are refused with a message naming the missing `--frequency`. The content rules are the same as for `vault backup`, plus `system`: at least one of secrets, media and system must be selected.

`download` writes to `<path>.partial` with mode `0600` and renames it when complete; an interrupted download leaves nothing behind. Open the zip with 7-Zip or Keka using the schedule's backup password. `delete` asks for confirmation in a terminal; outside a terminal it refuses unless you pass `--yes`. Add `--json` to `run`, `list`, `download` and `delete` for machine-readable output; `run --wait --json` prints `{ "success": true|false, "data": <run> }`.

#### Admin backups in the menu

**Admin backups ▸** in the main menu (shown only to users with `system_settings:read`) offers:

| Entry | What it does |
|-------|--------------|
| View schedule | The same summary as `schedule show`. |
| Set up schedule | A wizard: frequency, hours/day/time, time zone, how many to keep, a **What to back up?** checklist (secrets, attachments, old versions, media, system), the password (keep, set a new one, or leave unset), and whether to enable. It shows a summary and asks before saving. Without storage or a password the schedule is saved disabled. |
| Run backup now | Starts a backup and follows it every 5 seconds. Ctrl+C stops watching; the backup keeps running. |
| List backups | The latest 20 backups. |
| Download a backup | Pick a successful backup, choose a folder or file name, download it. |
| Delete a backup | Pick a backup and confirm (default No). |

If the server does not report your permissions, or the check fails while a token is stored, the entry is still shown and a missing permission is explained when you use it.

---

## AI Agent Integration

The CLI is designed for seamless AI agent integration with `--json` and `-q` modes.

### Capture IDs for Chaining

```bash
# Create and capture the ID
SECRET_ID=$(vault secrets create \
  --name "API Key" \
  --type-id <uuid> \
  --data '{"key":"sk-abc123"}' -q)

# Use the ID in subsequent commands
vault secrets get "$SECRET_ID" --json
```

### Extract Fields from JSON

```bash
# Get a specific field value
vault secrets get "AWS Prod" --json | jq -r '.data.values.secret_key'

# List all secret names
vault secrets list --json | jq -r '.data.items[].name'

# Get type IDs and names
vault types list --json | jq '.data.items[] | {id, name}'
```

### Secret Lifecycle Automation

```bash
# Create → Update → Check versions → Rollback
vault secrets create --name "Config" --type-id $TYPE_ID --data '{"v":"1"}' -q
vault secrets update "Config" --data '{"v":"2"}'
vault versions list "Config" --json | jq '.data'
VERSION_ID=$(vault versions list "Config" --json | jq -r '.data[1].id')
vault versions rollback "Config" "$VERSION_ID"
```

### Error Handling in Scripts

```bash
if result=$(vault secrets get "missing" --json 2>&1); then
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
| `~/.vault/config.json` | Server URL and token written by `vault login` (the platform's file) | `0600` |
| `~/.vault/sync.json` | Sync registry (files and directories) | `0600` |
| `~/.vault/backup.json` | Saved `backup` settings, never the password ([details](#saved-settings-backupjson)) | `0600` |
| `~/.vault/backup-password` | Password file created by the menu's backup setup (only if you choose that option) | `0600` |
| `~/.vault/backup.log` | Output of a scheduled `backup` job, when the menu's schedule entry is used | |

With `VAULT_CONFIG_DIR` (or `VAULTCLI_CONFIG_DIR`) set, the last four live in that directory instead; `config.json` is always `~/.vault/config.json`. A `sync.json`, `backup.json` or `backup-password` that exists only in `~/.config/vaultcli/` (where `vaultcli` kept them) is used there until a copy exists in the new directory.

### Server URL and token priority

1. `--server <url>` flag (highest; domain commands)
2. `VAULT_SERVER_URL` (or `VAULTCLI_SERVER_URL`) environment variable
3. `serverUrl` in `~/.vault/config.json`
4. `serverUrl` in a `vaultcli` `config.json` / `auth.json`
5. Default: `https://vault.marin.cr`

The token: `VAULT_TOKEN`, then `token` in `~/.vault/config.json`, then the `auth.json` of `vaultcli` (read only).

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
apps/cli/
├── package.json             # bin: vault -> dist/cli.js; version lives only here
├── install.sh               # curl-pipe installer (clone, build, symlink)
├── src/
│   ├── cli.ts               # entry point (the only module with import-time side effects)
│   ├── run.ts               # one invocation: createCli(APP_CLI_OPTIONS).run(argv)
│   ├── app.ts               # APP_CLI_OPTIONS: identity, version, extraCommands, update notice
│   ├── version.ts           # readVersion() from package.json
│   └── vault/               # Vault's domain commands (extraCommands)
│       ├── register.ts      # registrations, global options per group, the menu command
│       ├── commands/        # auth, secrets, versions, types, health, sync, backup, admin-backups
│       ├── lib/             # api client, backup runner/settings/retention/filename, sync engine, formatters
│       ├── interactive/     # `vault menu` (inquirer)
│       ├── utils/           # config (server, token, state files), output, types
│       └── __tests__/       # Vitest: ported vaultcli suites + config
└── tsconfig.json, tsconfig.build.json, vitest.config.ts
```

### Building and testing

```bash
npm run build --workspace=cli        # tsc -> apps/cli/dist (also: npm run cli:build)
npm run typecheck --workspace=cli
npm run test:run --workspace=cli     # Vitest
npm run dev --workspace=cli -- secrets --help   # run from source with tsx
```

Rules for changing the CLI (version bump, no engine copies, no secrets in logs): [AGENTS.md](AGENTS.md).

---

## API Endpoints Used

| CLI Command | HTTP Method | API Endpoint |
|-------------|-------------|--------------|
| `auth status`, `login` (validation) | `GET` | `/api/auth/me` |
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
| `backup` | `POST` | `/api/secrets/export` |
| `admin backups schedule show` | `GET` | `/api/admin/backups/schedule` |
| `admin backups schedule set` | `GET`, `PUT` | `/api/admin/backups/schedule` |
| `admin backups run` | `POST` | `/api/admin/backups/run` |
| `admin backups list`, `run --wait` | `GET` | `/api/admin/backups` |
| `admin backups download` | `GET` | `/api/admin/backups/:id/download` (then the signed URL) |
| `admin backups delete` | `DELETE` | `/api/admin/backups/:id` |
