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

### `backup` — Password-Protected Backup

Downloads an **AES-256 encrypted zip** of the secrets you own (decrypted values, a readable `secrets.html` report, `secrets.json`, and attachments), protected by a password you choose. It calls `POST /api/secrets/export`, so it produces exactly the same file as **Settings > Back up my data** in the web app. What is inside the archive, the password trade-offs and the warnings: [docs/SECRETS.md § Backup and export](../../docs/SECRETS.md#backup-and-export).

Open the file with 7-Zip (Windows), Keka or The Unarchiver (macOS), or `7z x` / File Roller (Linux). The built-in Windows and macOS zip tools cannot open AES zips.

```bash
vaultcli backup                                   # prompts for a password, writes ./vault-backup-<datetime>.zip
vaultcli backup -o "~/backups/{year}/{month}/vault-{datetime}.zip"
VAULTCLI_BACKUP_PASSWORD='blue tiger river' vaultcli backup --json
vaultcli backup --password-file ~/.vault-backup-pw --include-versions --no-attachments
```

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <template>` | Output path template (see tokens below) | `vault-backup-{datetime}.zip` |
| `--password-env <VAR>` | Read the password from this environment variable | `VAULTCLI_BACKUP_PASSWORD` |
| `--password-file <path>` | Read the password from a file (first line, trimmed) | - |
| `-p, --password <pw>` | Password on the command line (warns: visible in the process list and shell history) | - |
| `--no-attachments` | Exclude attachments | attachments included |
| `--include-versions` | Include every version of each secret | current versions only |
| `--overwrite` | Replace an existing file instead of adding `-1`, `-2` ... | off |
| `--utc` | Use UTC for the date/time tokens | local time |
| `--json` | Machine-readable result (global flag) | off |

#### Password sources and order

The first source that is present wins:

1. `--password`
2. `--password-file` (first line, trimmed; fails if unreadable or empty)
3. Environment variable: the one named by `--password-env`, otherwise `VAULTCLI_BACKUP_PASSWORD`. An explicit `--password-env` whose variable is unset or empty is an error; the default variable being unset just moves on.
4. A hidden interactive prompt with confirmation, only when stdin is a terminal.
5. Otherwise the command **fails immediately** with a message naming the options; it never hangs waiting for input, so scheduled runs are safe.

The password must be 6 to 256 characters; this is checked locally before any request. There are no complexity rules, but a longer passphrase is much safer: see the [password trade-off](../../docs/SECRETS.md#password-policy-and-the-honest-trade-off). There is no password recovery. Prefer `--password-file` (mode `0600`) or the environment variable over `--password`.

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
vaultcli backup -o "/srv/backups/vault-{host}-{date}.zip"      # /srv/backups/vault-build-server-1-2026-11-01.zip
vaultcli backup -o "~/backups/{year}/{month}/{user}-{datetime}.zip"
vaultcli backup -o "vault-{timestamp}.zip" --utc
```

#### Existing files, partial files and permissions

- **Never silently overwrites.** If the target exists, `-1`, `-2`, ... is added before the extension (`vault-2026-11-01-1.zip`, then `-2`). `--overwrite` replaces the existing file instead.
- The download is written to `<target>.partial` first and renamed into place only after it completes. On any failure, or on Ctrl-C / SIGTERM, the `.partial` file is deleted, so a half-written backup is never left under the final name.
- The file is created with mode `0600` (owner read/write only). Windows filesystems do not honour Unix modes, so keep the destination folder private there.

#### Output and exit codes

Human mode prints the path, size, secret and attachment counts (from the `X-Vault-Export-*` headers), the version scope, and a reminder to keep the password safe. With `--json` the result is wrapped in the usual envelope:

```json
{
  "success": true,
  "data": {
    "path": "/home/user/backups/vault-backup-2026-11-01_203015.zip",
    "size": 48213,
    "secrets": 12,
    "attachments": 5,
    "includeAttachments": true,
    "includeVersions": false,
    "overwritten": false
  }
}
```

`secrets` / `attachments` are `null` if the server did not send the count headers. In `-q` mode only the path is printed.

| Exit code | Meaning |
|-----------|---------|
| `0` | Backup saved |
| `1` | Any failure: not authenticated, bad template or password, server error, or an incomplete or empty download. With `--json` the error goes to stderr as `{"success": false, "error": "...", "code": "backup_failed"}` |
| `130` | Interrupted by SIGINT / SIGTERM (the partial file is removed) |

Warnings about attachments that could not be exported are inside the archive (`README.txt`, `secrets.json`), not on the CLI's output: check them occasionally.

---

### Scheduled Backups

`backup` is built for unattended use: it never prompts when stdin is not a terminal, it exits non-zero on failure, and it never leaves a partial file behind.

**Authentication for unattended runs.** The CLI authenticates with the Personal Access Token stored by `vaultcli auth login` in `auth.json` (long-lived; there is no token environment variable). Run `vaultcli auth login` once, interactively, as the same OS user the scheduler will run as, and make sure the job can find that config: set `HOME` (`USERPROFILE` on Windows) and, if needed, `VAULTCLI_CONFIG_DIR`. Consider creating a dedicated PAT for the job so it can be revoked on its own. If the PAT is revoked, scheduled runs fail with exit code 1.

**Password for unattended runs.** Store the password in a file readable only by the job's user:

```bash
umask 077
printf '%s\n' 'blue tiger river' > ~/.config/vaultcli/backup-password   # use your own passphrase
chmod 600 ~/.config/vaultcli/backup-password
```

Or set `VAULTCLI_BACKUP_PASSWORD` in the scheduler's environment. A password stored next to the job is only as safe as that machine: anyone who can read both the backup and the password file can open the backup, so copy backups off-host where you can.

#### Linux (cron)

Daily at 02:30, with `HOME` and `PATH` set explicitly because cron runs with a minimal environment:

```cron
30 2 * * * HOME=/home/USER PATH=/usr/local/bin:/usr/bin:/bin vaultcli backup --password-file /home/USER/.config/vaultcli/backup-password -o "/home/USER/backups/vault-{date}.zip" --json >> /home/USER/.local/state/vaultcli-backup.log 2>&1
```

With an environment variable instead of a password file (a crontab is often readable by more people than you expect, so prefer the file):

```cron
30 2 * * * HOME=/home/USER PATH=/usr/local/bin:/usr/bin:/bin VAULTCLI_BACKUP_PASSWORD='blue tiger river' vaultcli backup -o "/home/USER/backups/vault-{date}.zip" --json >> /home/USER/.local/state/vaultcli-backup.log 2>&1
```

The non-zero exit code makes failures detectable by an external monitor; the log file keeps the error message.

#### macOS (launchd)

Save as `~/Library/LaunchAgents/test.example.vaultcli-backup.plist`, adjust the paths and user, then load it with `launchctl load ~/Library/LaunchAgents/test.example.vaultcli-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>test.example.vaultcli-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/vaultcli</string>
    <string>backup</string>
    <string>--password-file</string>
    <string>/Users/USER/.config/vaultcli/backup-password</string>
    <string>-o</string>
    <string>/Users/USER/Backups/vault-{date}.zip</string>
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
  <string>/Users/USER/Library/Logs/vaultcli-backup.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/USER/Library/Logs/vaultcli-backup.log</string>
</dict>
</plist>
```

If the Mac was asleep at 02:30, launchd runs the job when it wakes. Check the last result with `launchctl list | grep vaultcli-backup` (the second column is the last exit status).

#### Windows (Task Scheduler)

Store the password in a file only your account can read, then register a daily task for your own user. In PowerShell:

```powershell
# One-time: save the password (use your own passphrase) and restrict the file to your account
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\vaultcli", "$env:USERPROFILE\Backups" | Out-Null
Set-Content -Path "$env:USERPROFILE\.config\vaultcli\backup-password" -Value "blue tiger river"
icacls "$env:USERPROFILE\.config\vaultcli\backup-password" /inheritance:r /grant:r "${env:USERNAME}:(R)"

# Register the task: daily at 02:30
$cliArgs = "backup --password-file `"$env:USERPROFILE\.config\vaultcli\backup-password`" -o `"$env:USERPROFILE\Backups\vault-{date}.zip`" --json"
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c vaultcli $cliArgs >> `"$env:USERPROFILE\Backups\vaultcli-backup.log`" 2>&1"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30am
Register-ScheduledTask -TaskName "VaultCLI Backup" -Action $action -Trigger $trigger
```

The same with `schtasks` from a Command Prompt:

```bat
schtasks /Create /SC DAILY /ST 02:30 /TN "VaultCLI Backup" /TR "cmd /c vaultcli backup --password-file %USERPROFILE%\.config\vaultcli\backup-password -o %USERPROFILE%\Backups\vault-{date}.zip --json >> %USERPROFILE%\Backups\vaultcli-backup.log 2>&1"
```

The task must run as the user who ran `vaultcli auth login`, and the `Backups` folder must exist for the log file (the CLI creates missing folders for the backup itself). Check the result with `schtasks /Query /TN "VaultCLI Backup" /V /FO LIST`: a "Last Result" of `0` means success. Open the zip with 7-Zip.

#### Retention is not automatic

`vaultcli backup` only creates files; it never deletes old ones, so a daily schedule grows without limit. Add your own cleanup. On Linux, delete backups older than 30 days:

```cron
45 2 * * * find /home/USER/backups -name 'vault-*.zip' -mtime +30 -delete
```

The same `find` works on macOS (for example from a second launchd job). On Windows:

```powershell
Get-ChildItem "$env:USERPROFILE\Backups\vault-*.zip" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item
```

Test a restore occasionally: open one backup with 7-Zip using the password and check that `secrets.html` looks right.

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
│   │   ├── sync.ts          # sync add/add-dir/remove/list/status/run/where
│   │   └── backup.ts        # backup (encrypted zip download)
│   ├── lib/                 # Core libraries
│   │   ├── api-client.ts    # HTTP client
│   │   ├── auth-store.ts    # Token persistence
│   │   ├── backup-filename.ts # Output path template expansion
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
| `backup` | `POST` | `/api/secrets/export` |
