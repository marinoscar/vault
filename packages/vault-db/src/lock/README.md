# lock

The lock files and the hashing they rest on.

## Purpose and scope

Reads, validates and writes `prisma/vault.lock`; merges the domain's raw-SQL indexes and installed directories into the host's `prisma/platform.lock` (kept as a plain document so every field the platform owns is written back untouched); serialises JSON deterministically (keys sorted, two-space indent, one trailing newline, the way `platform.lock` is written); hashes bytes with SHA-256.

Status: implemented (issue 5.3).

## Entry point

`@marinoscar/vault-db` (the package root re-exports this slice): `VaultLock`, `VaultLockEntry`, `readVaultLock`, `parseVaultLock`, `serializeVaultLock`, `emptyVaultLock`, `readPlatformLock`, `mergePlatformLock`, `serializeJson`, `sha256Hex`, `normaliseDefinition`, `VaultLockError`, `VAULT_LOCK_FILE`.

## Peer dependencies

None. The slice imports Node built-ins only.

## Configuration

None.

## Extension-point catalog

None.

### Desktop

`prisma/vault.lock` is what makes an upgrade install only the new migrations in Desktop. See [the Vault Desktop guide](../../../../docs/guides/vault-desktop.md#database).
