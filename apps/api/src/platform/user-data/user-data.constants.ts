// =============================================================================
// Vault's user-data identifiers (issue #91, E9.3, epic #64)
// =============================================================================
//
// PERMANENT strings: the job type is pinned by `test/jobs/job-type-snapshot.spec.ts`, the category
// and scope ids and the confirmation phrase are API once a client has used them.
// =============================================================================

/**
 * The delegate of the Vault models the platform's inline purge cannot delete on its own: a user's
 * "My backups" runs (their archives are object keys, not `storage_objects` rows, so the bytes must
 * go first) and the user's unused custom secret types. SERVER-ONLY.
 */
export const VAULT_USER_DATA_PURGE_JOB_TYPE = 'vault.user_data.purge';

/** Categories this app adds to the Danger Zone. */
export const VAULT_USER_DATA_CATEGORIES = {
  SECRETS: 'secrets',
  SECRET_TYPES: 'secretTypes',
  MEDIA: 'media',
  BACKUPS: 'backups',
} as const;

/** The one narrow scope this app adds (the composite `content` and `everything` are the platform's). */
export const VAULT_BACKUPS_SCOPE_ID = 'backups';
export const VAULT_BACKUPS_SCOPE_CONFIRMATION = 'DELETE MY BACKUPS';
