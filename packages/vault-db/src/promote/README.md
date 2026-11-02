# promote

Move a migration authored in the app into the package.

## Purpose and scope

`promoteVaultMigration` takes a draft made with `prisma migrate dev --create-only`, refuses one that changes a table the domain does not own, copies it into `migrations/`, appends it to `manifest.json` and installs it under its original name.

Status: implemented (issue 5.3).

## Entry point

`@marinoscar/vault-db`: `promoteVaultMigration` and the option and result types.

## Peer dependencies

None. The slice imports Node built-ins only.

## Configuration

`VaultPromoteOptions` (`root`, `localDir`, `id`, `slice`, `packageDir`).

## Extension-point catalog

None.

### Desktop

Desktop does not author domain migrations; they come with a package release. See [the Vault Desktop guide](../../../../docs/guides/vault-desktop.md#database).
