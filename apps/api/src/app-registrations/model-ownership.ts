// =============================================================================
// Vault's model ownership classification (issue #77, E3.2)
// =============================================================================
//
// Every Vault model is classified (`user`, `org`, `org-optional` or `system`);
// the `user-owned-data` conformance suite fails on any model it cannot find
// here. Vault content belongs to a USER, not to an organization: the org-isolated
// models are the platform's (`StorageObject` and its chunks, ...).
// `MediaFolderFile` carries an `org_id` only as the second half of the
// composite key to its storage object (no row-level security of its own, see
// docs/platform-adoption/local-exceptions.md), so it names it as a reference.
// =============================================================================

// The classification moved to @marinoscar/vault-api/core (issue #194), so every host registers the same one.
export { VAULT_MODEL_OWNERSHIP } from '@marinoscar/vault-api/core';
