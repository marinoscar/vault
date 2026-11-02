// =============================================================================
// Object-storage key prefixes (issue #84, E6.1, epic #61)
// =============================================================================
//
// Every key prefix this deployment writes under, registered before the registry
// freezes at bootstrap. A destructive path (`npm run storage:purge`, org
// offboarding, a factory reset) may enumerate ONLY this list, so a prefix that
// is not here is a prefix a purge silently leaves behind.
//
// WHAT VAULT WRITES, and where each key comes from:
//
//   uploads/<timestamp>/<uuid><ext>          the platform's `uploads/` prefix. Secret attachments, card faces
//                                            and media files are all `storage_objects` rows created through
//                                            the objects API; the row's `storage_key` is the key. Objects
//                                            written before adoption keep `uploads/<timestamp>/...` (no org
//                                            segment) and are read by their stored key; new ones are
//                                            `uploads/<orgId>/<timestamp>/...`.
//   system-backups/<file>.zip                an admin's scheduled / manual logical backup (deployment scope).
//   user-backups/<userId>/<file>.zip         a user's "My backups" archive (user scope: the layout
//                                            `<prefix><userId>/...` is exactly what `buildObjectKey` builds).
//   avatars/, node-outputs/, storage-config-test/   the platform's, registered with the slice.
//
// The backup archives are NOT `storage_objects` rows: their keys live in
// `backup_runs.storage_key`, so the registry is the only thing that lets a purge
// find them. The key BUILDERS in `backups/backup-archive.ts` stay as they are
// (the keys must not change); `storage-key-prefix.manifest.spec.ts` pins that
// they equal what `buildObjectKey` builds.
//
// These are the logical secret backups, not the platform `db-backup` slice's
// `database-backups/<app>/YYYY/MM/<file>.dump` (E9.1): whole-database `pg_dump` archives,
// deployment scope, registered here (the slice's own `DB_BACKUP_KEY_PREFIX`, right after the
// storage slice's four) so a purge reaches them. They are `database_backup_runs` rows, not
// `storage_objects`, like the zips above.
// =============================================================================

import { EXPORTS_KEY_PREFIXES } from '@marinoscar/platform-api/exports';
import { DB_BACKUP_KEY_PREFIX } from '@marinoscar/platform-api/db-backup';
import {
  STORAGE_SLICE_KEY_PREFIXES,
  registerStorageKeyPrefixes,
  type StorageKeyPrefixDef,
} from '@marinoscar/platform-api/storage';

export const SYSTEM_BACKUPS_KEY_PREFIX_DEF: StorageKeyPrefixDef = {
  id: 'system-backups',
  prefix: 'system-backups/',
  owner: 'backups',
  scope: 'deployment',
  description: 'Logical system backups (password-protected zips of every user\'s secrets): system-backups/<file>.zip',
};

export const USER_BACKUPS_KEY_PREFIX_DEF: StorageKeyPrefixDef = {
  id: 'user-backups',
  prefix: 'user-backups/',
  owner: 'backups',
  scope: 'user',
  description: 'A user\'s own "My backups" archives: user-backups/<userId>/<file>.zip',
};

/** This app's own prefixes, appended after the platform's. */
export const VAULT_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = [
  SYSTEM_BACKUPS_KEY_PREFIX_DEF,
  USER_BACKUPS_KEY_PREFIX_DEF,
];

/** Every prefix this deployment registers, in purge order. */
export const ALL_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = [
  ...STORAGE_SLICE_KEY_PREFIXES,
  DB_BACKUP_KEY_PREFIX,
  ...VAULT_KEY_PREFIXES,
  // E9.3: `exports/users/<userId>/` and `exports/orgs/<orgId>/` (the exports slice's files).
  ...EXPORTS_KEY_PREFIXES,
];

let registered = false;

/** Registers {@link ALL_KEY_PREFIXES}. Idempotent per process. */
export function registerVaultStorageKeyPrefixes(): void {
  if (registered) return;
  registered = true;
  registerStorageKeyPrefixes(ALL_KEY_PREFIXES);
}

registerVaultStorageKeyPrefixes();
