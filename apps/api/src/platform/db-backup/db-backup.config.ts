// =============================================================================
// The database backup slice's composition (issue #89, E9.1, epic #64)
// =============================================================================
//
// `DbBackupModule.forRoot` is WHOLE-DATABASE disaster recovery: a streaming `pg_dump -Fc`
// of every table into object storage under `database-backups/`, its schedule and
// retention, and an in-app restore (read-only pre-flight, scratch-database replay, swap,
// rollback). The four job types are `db.backup.run`, `db.backup.sweep`, `db.restore.run`
// and `db.restore.old-db-drop`; the routes are `/api/admin/db-backup/*`
// (`db_backup:read|write|restore`, system scope, `admin` only); the Doctor checks are
// `backup.schedule`, `backup.pg-client`, `backup.rls-bypass` and `backup.mirrors`.
//
// IT IS NOT VAULT'S SECRET BACKUP. `backups/` (the `vault.backup.run` and
// `vault.user_backup.run` jobs, `system-backups/` and `user-backups/`) writes selective,
// password-protected zips of decrypted-then-re-encrypted secrets. This slice dumps the
// database as it is, ciphertext included, and restores ALL of it. See docs/SECRETS.md.
//
// Every dump and restore carries BOTH `--enable-row-security` and
// `PGOPTIONS=-c app.rls_bypass=on` (the option in the environment, never in argv): the
// platform does this, never wrap it. The flag alone writes an archive with empty
// organization tables.
//
// DEFAULTS, chosen on purpose and none adds an environment variable:
//
//   deploymentMode   the `DB_BACKUP_DEPLOYMENT_MODE` port (host module) answers from
//                    `DEPLOYMENT_MODE`; unset or `self-hosted` leaves in-app RESTORE ON,
//                    `saas` turns restore and rollback OFF (403 `deployment_mode_saas`)
//                    while backups keep working. Vault is self-hosted by default, so
//                    restore is on; a managed-database deployment sets `DEPLOYMENT_MODE=saas`
//                    and uses the provider's point-in-time recovery. `restoreEnabled` is
//                    deliberately NOT passed: one switch, one place.
//   scheduleEnabled  the `dbBackup.scheduleEnabled` config key
//                    (`DB_BACKUP_SCHEDULE_ENABLED !== 'false'`, `config/configuration.ts`).
//   target           the active storage provider (E6.1), so an archive lands in the bucket
//                    the admin configured; with that default target a worker node can take
//                    the backup (`databaseBackup.nodeOffload`).
//   extraCarryOver   NONE, see `app-registrations/db-backup.ts` for why.
//
// WHAT IT NEEDS FROM THIS APP, all already mounted: `jobsModule` and `settingsModule`
// (global), `platformHostModule` (`PLATFORM_PRISMA`), `doctorModule`, the notifications
// slice (E7.1) and the storage provider (E6.1). The `databaseBackup` namespace is listed
// in `settings/registry/system-settings.manifest.ts`, the `database-backups/` prefix in
// `platform/storage/storage-key-prefix.manifest.ts`, the permissions in
// `platform/permissions.ts` and the two events in `notifications-registry/db-backup.notifications.ts`.
// =============================================================================

import { APP_NAME } from '@app/shared';
import { DbBackupModule } from '@marinoscar/platform-api/db-backup';

import '../../app-registrations/db-backup';
import { DbBackupHostModule } from './db-backup-host.module';

export const dbBackupModule = DbBackupModule.forRoot({
  appName: APP_NAME,
  imports: [DbBackupHostModule],
});
