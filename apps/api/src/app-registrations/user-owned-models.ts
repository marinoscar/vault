// =============================================================================
// Vault's user-owned models (issue #77, E3.2)
// =============================================================================
//
// Every Vault model with a foreign key to `User`, classified for the platform's
// user-data machinery (the scoped client, the user-data purge planner and export,
// and the `user-owned-data` conformance suite, which fails when this list and
// `prisma/schema/` disagree).
//
// PURGE FOLLOWS `onDelete`: `Cascade` is `delete`, `SetNull` is `detach`.
//
// SECRET MATERIAL NEVER TAKES THE GENERIC EXPORT. `Secret` and `SecretVersion`
// are `exclude`: a secret leaves the deployment only through Vault's own
// password-protected export (`POST /api/secrets/export`), never through a
// plaintext data download. The `vault-secrets` export source (E9.3,
// `platform/exports/vault-secrets.source.ts`) adds secret METADATA (names, types,
// timestamps, counts) by an explicit column list; it reads no value and no ciphertext.
// =============================================================================

// The classification moved to @marinoscar/vault-api/core (issue #194), so every host registers the same one.
export { VAULT_USER_OWNED_MODELS } from '@marinoscar/vault-api/core';
