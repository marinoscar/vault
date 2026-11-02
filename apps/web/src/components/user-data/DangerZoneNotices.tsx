/**
 * Vault's notices on the packaged Danger Zone and factory reset pages (issue #91, E9.3).
 *
 * Both pages list what is deleted and what is kept from the API's own lists (the platform's lines plus the
 * ones Vault registered), so the pages never carry a second copy of that. What the API cannot say is the
 * way out: deleting secrets is permanent, and the only copy that survives is a password-protected backup
 * the user already holds. These notices say that, in Vault's words, ABOVE the buttons.
 */

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

import { MY_BACKUPS_PATH } from '../exports/VaultExportNotice';

/** The Console page where scheduled backups are made, listed and downloaded. */
export const ADMIN_BACKUPS_PATH = '/admin/settings/backups';

export function UserDangerZoneNotice() {
  const { hasPermission } = usePermissions();
  return (
    <Alert severity="warning" variant="outlined" sx={{ mb: 3 }}>
      <AlertTitle>Deleting secrets cannot be undone</AlertTitle>
      Vault cannot recover a deleted secret, its older versions or its attachments. If you might need them,
      {hasPermission('secrets:read') ? (
        <>
          {' '}
          save a password-protected backup on{' '}
          <Link component={RouterLink} to={MY_BACKUPS_PATH}>
            My backups
          </Link>{' '}
          first and keep the file and its password somewhere safe. Deleting everything also deletes your saved
          backups, so download one before you start.
        </>
      ) : (
        ' keep a copy elsewhere first.'
      )}
    </Alert>
  );
}

export function FactoryResetNotice() {
  const { hasPermission } = usePermissions();
  return (
    <Alert severity="warning" variant="outlined" sx={{ mb: 3 }}>
      <AlertTitle>The reset also deletes Vault&apos;s own backups</AlertTitle>
      Every secret of every user is deleted, and so is every backup archive Vault made: the scheduled ones and
      each user&apos;s saved backups. Download any archive you want to keep before you start
      {hasPermission('system_settings:read') ? (
        <>
          {' '}
          from{' '}
          <Link component={RouterLink} to={ADMIN_BACKUPS_PATH}>
            Backups
          </Link>
        </>
      ) : null}
      . The backup schedule and its password stay, as do the system secret types.
    </Alert>
  );
}
