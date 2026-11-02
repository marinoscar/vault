/**
 * Console -> Operations -> Database Backup (issue #89, E9.1, epic #64): the packaged
 * `DbBackupPage` with Vault's adapters. WHOLE-DATABASE disaster recovery; the encrypted
 * secret backups are the separate `Backups` page (`BackupSettingsPage`).
 *
 * The page needs the platform host (`VaultPlatformHostProvider`, mounted around every route)
 * and, for the run table, the db-backup adapters, provided here around the page only.
 * Writes need `db_backup:write` and restore/rollback `db_backup:restore`; the page disables
 * those controls (with the reason), the route gate is `db_backup:read`.
 */

import { DbBackupWebAdaptersProvider } from '@marinoscar/platform-web/db-backup/headless';
import { DbBackupPage } from '@marinoscar/platform-web/db-backup/ui';

import { appDbBackupAdapters } from '../../platform/dbBackupAdapters';

export default function DbBackupSettingsPage() {
  return (
    <DbBackupWebAdaptersProvider adapters={appDbBackupAdapters}>
      <DbBackupPage />
    </DbBackupWebAdaptersProvider>
  );
}
