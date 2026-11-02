// =============================================================================
// Vault's database restore registrations (issue #89, E9.1, epic #64)
// =============================================================================
//
// Imported by `app-registrations/registrations.ts` and `platform/db-backup/db-backup.config.ts`,
// so it runs before the registries freeze when the application bootstraps.
//
// RESTORE CARRY-OVER: NONE, ON PURPOSE
// -----------------------------------------------------------------------------
// A restore replays an archive into a scratch database and swaps it in. Before the swap
// the platform reads, from the database being displaced, what must survive: the backup
// catalog (`database_backup_runs`), the restore's own `jobs` row and the completion audit
// row. An app registers an extra `RestoreCarryOver` only for a table that records a fact
// OUTSIDE the database, a fact the older archive cannot know.
//
// What Vault stores outside the database, and why none of it needs a carry:
//
//   * Secret ciphertext, versions, card data, attachment METADATA, media folders: all in
//     the dump. The attachment BYTES live in object storage; the archive holds the
//     `storage_objects` rows that point at them. Restoring an older archive drops the rows
//     of files uploaded since, and those orphaned objects are reachable by the registered
//     key prefixes (`npm run storage:purge`). Nothing dangles in the other direction: an
//     object a restored row points at was either never deleted or was deleted by a
//     refcount path whose row is gone too.
//   * The logical secret backups (`backup_runs`, the zips under `system-backups/` and
//     `user-backups/`). A restored older archive loses the catalog rows of zips taken
//     since; the zips stay in storage and are NOT lost, but they stop being listed in the
//     admin and "My backups" pages until their rows are recreated. That is a catalog gap,
//     not a loss of secrets, and carrying the rows would need Vault's table definitions
//     (user FKs, scope) to survive a schema that differs between archive and live. It is
//     the accepted trade-off, listed in docs/runbooks/database-restore.md ("After the
//     restore") so an operator knows where to look.
//   * Encryption keys: `VAULT_ENCRYPTION_KEY` and `SECRETS_ENCRYPTION_KEY` are environment
//     variables, not rows. They must equal the keys the dumped database was written under;
//     that is a precondition checked by the operator (runbook), not a carry-over.
//   * Storage configuration and credentials: `system_settings` and the `credentials` table
//     are in the dump, encrypted under `SECRETS_ENCRYPTION_KEY`; restoring an older archive
//     restores the older storage configuration with them.
//
// If a table ever records an outside fact (a remote resource that exists only because a row
// says so), register it here with the reason. The `dbBackup` conformance suite binds
// every registered carry's `reinsertSql` to `$1`.
// =============================================================================

import { registerRestoreCarryOver } from '@marinoscar/platform-api/db-backup';
import type { RestoreCarryOver } from '@marinoscar/platform-api/db-backup';

/** The carries Vault registers beyond the platform's built-in four. Empty by decision, see the header. */
export const VAULT_RESTORE_CARRY_OVERS: readonly RestoreCarryOver[] = [];

let registered = false;

if (!registered) {
  registered = true;
  VAULT_RESTORE_CARRY_OVERS.forEach(registerRestoreCarryOver);
}
