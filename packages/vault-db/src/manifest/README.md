# manifest

The package's own data: manifest, inventories, host tables.

## Purpose and scope

Reads and validates `migrations/manifest.json`, `raw-sql-indexes.json`, `extensions.json` and `schema-objects.json` of the package folder, and exports the inventories as constants (`VAULT_RAW_SQL_INDEXES`, `VAULT_EXTENSIONS`, `VAULT_HOST_TABLES`). It also finds the package root and its version.

Status: implemented (issue 5.3).

## Entry point

`@marinoscar/vault-db`: `readManifest`, `parseManifest`, `serializeManifest`, `readInventories`, `listPackageFragments`, `vaultDbPackageRoot`, `vaultDbVersion`, `VAULT_RAW_SQL_INDEXES`, `VAULT_EXTENSIONS`, `VAULT_HOST_TABLES`, `VAULT_HOST_MODELS` and the entry types.

## Peer dependencies

None. The slice imports Node built-ins only.

## Configuration

None. The constants are read from the package folder when the module loads.

## Extension-point catalog

None.

### Desktop

The manifest is what `vault-db sync` installs from in Desktop. See [the Vault Desktop guide](../../../../docs/guides/vault-desktop.md#database).
