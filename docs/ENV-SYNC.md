# Backing Up .env Files into Vault with `vaultcli sync`

`vaultcli sync` keeps local `.env` files (or any UTF-8 text file) backed up in your Vault instance as **versioned Document secrets**. Every time the file content changes, a new immutable version is written. Unchanged files are skipped, which makes the command safe to call repeatedly from a cron job without creating spurious versions or unnecessary API traffic.

This is a one-way backup: local files are pushed into Vault. Vault is the read-only archive. The command never modifies files on disk.

---

## How It Works

### Storage model

Each tracked file maps to a single **Document-type secret** in Vault. The secret's encrypted `notes` field holds the raw file content and is the authoritative, versioned source of truth — the API automatically creates a new version on every `PUT` that changes the data. A storage attachment is also kept as a best-effort downloadable mirror. If the attachment upload fails (for example, due to a MIME type policy), a warning is logged and the sync entry still succeeds; the `notes` copy is always the reliable backup.

### Change detection

Change detection is **client-side SHA-256**. Before uploading, the CLI hashes the local file and compares it to the hash stored in the local registry. If no cached hash is available (for example, on first run or after a registry reset), it falls back to hashing the current `notes` content fetched from the server. If the hashes match, the file is skipped and no new version is written.

### Lazy creation

Registering a file (via `sync add` or `sync add-dir`) is a local-only operation — no network call is made. The Vault secret is created on the first `sync run` that actually processes the entry.

### Local registry

Registration and cached hashes are persisted in a local registry at:

```
~/.config/vaultcli/sync.json
```

The file is created with mode `0600` (owner read/write only). The location can be overridden with the `VAULTCLI_CONFIG_DIR` environment variable.

### Flow summary

```
┌──────────────────────────────────────────────────────────────────┐
│  vaultcli sync run                                               │
│                                                                  │
│  For each registered entry:                                      │
│    1. Hash local file (SHA-256)                                  │
│    2. Compare to cached hash in sync.json                        │
│       ├─ Match → skip (unchanged)                                │
│       └─ Differ (or no cache) → compare to server notes hash     │
│            ├─ Match → skip, update cache                         │
│            └─ Differ → push to Vault                             │
│                 ├─ Secret exists? → PUT (new version created)    │
│                 └─ No secret yet? → POST (secret created)        │
│                 └─ Upload attachment (best-effort)               │
│    3. Update cached hash in sync.json                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Authenticate

Run this once. The PAT is stored at `~/.config/vaultcli/auth.json`.

```bash
vaultcli auth login
```

See [personal-access-tokens.md](personal-access-tokens.md) for how to create a token in the web UI.

### 2. Register a file

```bash
vaultcli sync add --name "myapp/env-prod" --path /home/user/myapp/.env.production
```

This writes to the local registry only. No Vault secret is created yet.

### 3. Push to Vault

```bash
vaultcli sync run
```

The CLI hashes each registered file, skips unchanged ones, and creates or updates the corresponding Document secret. On the first run for a new entry, the secret is created.

### 4. Verify

```bash
# Retrieve the content from the notes field
vaultcli secrets get "myapp/env-prod" --json | jq -r '.data.values.notes'

# View version history
vaultcli versions list "myapp/env-prod"
```

### 5. Confirm change detection works

Edit the file, then run again:

```bash
echo "NEW_VAR=1" >> /home/user/myapp/.env.production
vaultcli sync run
# → 1 updated
```

Run once more without changing the file:

```bash
vaultcli sync run
# → 1 unchanged
```

---

## Registering Files

### Per-file registration

Use `sync add` to register a single file with an explicit secret name:

```bash
vaultcli sync add \
  --name "myapp/env-prod" \
  --path /absolute/path/to/.env.production \
  --description "Production environment variables"
```

- `--name` must be unique per user in Vault.
- `--path` must be an absolute path.
- A warning is printed if the file does not exist yet, but the entry is still registered.

### Directory auto-discovery

Use `sync add-dir` to register a directory. File matching happens at `sync run` time, not at registration:

```bash
# Default: matches .env* files in the directory (non-recursive)
vaultcli sync add-dir --path /home/user/myapp

# Custom glob, recursive, with a name prefix
vaultcli sync add-dir \
  --path /home/user/myapp \
  --pattern "*.env" \
  --recursive \
  --name-prefix "myapp"
```

**Derived secret names:** For each discovered file, the secret name is `<name-prefix>/<relative path>`. If `--name-prefix` is not set, the directory's basename is used. This name is deterministic across runs — the same file always maps to the same secret.

**Skipped directories:** `.git` and `node_modules` are always excluded, even with `--recursive`.

**Deduplication:** If a file is matched by both a directory rule and an explicit `sync add` entry, the explicit entry wins.

### Managing registered entries

```bash
# List all registered entries (offline, no network call)
vaultcli sync list

# Check what would happen on the next run (dry run)
vaultcli sync status

# Remove an entry from the registry (does NOT delete the Vault secret)
vaultcli sync remove "myapp/env-prod"
vaultcli sync remove /absolute/path/to/.env.production

# Print the registry file path
vaultcli sync where
```

---

## Running on a Schedule (Cron)

`vaultcli sync run` is designed to be called unattended. Authenticate once interactively, then add a crontab entry.

Cron runs with a minimal environment, so set `HOME`, `VAULTCLI_CONFIG_DIR`, and `PATH` explicitly and use absolute paths.

**Crontab entry (every 15 minutes):**

```cron
*/15 * * * * HOME=/home/USER VAULTCLI_CONFIG_DIR=/home/USER/.config/vaultcli PATH=/usr/local/bin:/usr/bin:/bin vaultcli sync run --json >> /home/USER/.local/state/vaultcli-sync.log 2>&1
```

Replace `USER` with your actual username.

**Prerequisites:**

- Authenticate first: `vaultcli auth login`. The PAT is stored at `~/.config/vaultcli/auth.json` and is reused by all subsequent runs.
- If using a local build instead of the installed symlink, use the absolute path to `node` and `bin/vaultcli.js`.
- Create the log directory if it does not exist: `mkdir -p ~/.local/state`

**Alerting:** `sync run` exits with code `0` when all entries succeeded and `1` when one or more entries errored. This makes the job alertable via standard cron mail or external monitoring tools that check job exit codes.

**JSON logging:** Using `--json` produces structured output in the log file, which is easier to parse with tools like `jq` or forward to a log aggregator:

```json
{
  "success": true,
  "data": {
    "dryRun": false,
    "summary": { "created": 0, "updated": 1, "unchanged": 4, "errors": 0 },
    "results": [...]
  }
}
```

---

## Restoring a File from Vault

### From the notes field (authoritative copy)

The `notes` field is the versioned, encrypted copy. Read it back and write it to disk:

```bash
vaultcli secrets get "myapp/env-prod" --json \
  | jq -r '.data.values.notes' \
  > /path/to/restore/.env.production
```

To restore a specific historical version:

```bash
# List versions and find the version ID to restore
vaultcli versions list "myapp/env-prod"

# Read a specific version's notes
vaultcli versions get "myapp/env-prod" <version-uuid> --json \
  | jq -r '.data.values.notes' \
  > /path/to/restore/.env.production
```

### From the attachment (best-effort mirror)

If an attachment was uploaded successfully, download it from the secret's **Attachments** tab in the web UI. (Programmatically: list attachments with `GET /api/secrets/:id/attachments` to get the attachment's `storageObjectId`, then request a signed download URL from `GET /api/storage/objects/:storageObjectId/download`.) In most cases the `notes` field above is the simpler and authoritative way to restore.

---

## Security and Caveats

**The `notes` field is authoritative and versioned.** It is encrypted at rest with AES-256-GCM. Every content change creates a new immutable version in Vault. The storage attachment is a convenience mirror only — backups never silently fail if the attachment upload is blocked.

**Attachment MIME type caveat.** The server's `ALLOWED_MIME_TYPES` setting (default: `image/*,application/pdf,video/*`) is not currently enforced in the storage service, so text file uploads succeed. If that policy were enforced in a future release, the attachment upload would be skipped with a warning while the `notes` copy still succeeds.

**UTF-8 only.** The `notes` field stores raw text. Binary files are not supported. A trailing-newline difference counts as a real change and triggers a new version.

**Own secrets only.** `sync run` creates and updates secrets under the authenticated user's account. Admin `*_any` permissions are not required.

**Auth token.** The PAT stored at `~/.config/vaultcli/auth.json` provides access to your Vault secrets. Protect the file and rotate the token regularly. See [personal-access-tokens.md](personal-access-tokens.md) for token management.

---

## Command Reference

This document covers the intended workflows. For a complete flag reference for all `sync` subcommands, see [`../tools/vaultcli/README.md`](../tools/vaultcli/README.md#sync--local-file-sync).

For the general vaultcli authentication setup, see [personal-access-tokens.md](personal-access-tokens.md).

For how Document secrets and versioning work on the server side, see [SECRETS.md](SECRETS.md).
