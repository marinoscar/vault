---
'@marinoscar/vault-api': minor
'@marinoscar/vault-db': minor
'@marinoscar/vault-web': minor
---

Make the packages embeddable in a host that is not Vault (issue #194; guide: `docs/EMBEDDING.md`). `@marinoscar/vault-api`: a new optional `VAULT_HOST` binding (`host: { appUrl }`) replaces the backup and card-expiry notifications' reads of `APP_URL`; `vaultPermissionDeclarations(roleMapping)` gives Vault's default grants to a host's own roles; `VAULT_RESERVED_NAMES` and `findVaultNameCollisions` list and check every route prefix, permission resource, settings namespace, job, notification, template, OAuth scope, audit prefix and OpenAPI tag the packages own; `VAULT_USER_OWNED_MODELS`, `VAULT_MODEL_OWNERSHIP`, `VAULT_CARDS_SETTINGS_DEFAULTS` and `VAULT_BACKUPS_SETTINGS_DEFAULTS` move into `core`; `seedVaultSystemSecretTypes` (`/secret-types`) seeds the built-in types; `runVaultHostConformance` (`/testing`) is the host conformance kit. `@marinoscar/vault-db`: `checkVaultInstall` no longer defaults `databaseUrl` to `process.env.DATABASE_URL` and `runVaultDb` requires its context (the `vault-db` command passes both, unchanged). `@marinoscar/vault-web`: `configureVaultWeb` takes `productName` (default `Vault`), shown by the pages' copy.
