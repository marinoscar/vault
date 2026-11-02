/**
 * The notice above "Download your data" (issue #91, E9.3).
 *
 * The packaged page exports the user's DATA: media folders, custom secret types and, from the "Secrets
 * (metadata only)" source, the names, types, timestamps and version counts of their secrets. It never
 * contains a secret VALUE. This notice says so and points to where the values go: Vault's own
 * password-protected zip, made on My backups (`POST /api/secrets/export`). Nothing here reads a
 * secret.
 *
 * The link to My backups shows only for a viewer who holds `secrets:read`, the string the page's route
 * enforces; for anybody else the sentence stands without it.
 */

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

/** Where the password-protected export is made. */
export const MY_BACKUPS_PATH = '/settings/backups';

export function VaultExportNotice() {
  const { hasPermission } = usePermissions();
  const canOpenBackups = hasPermission('secrets:read');

  return (
    <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
      <AlertTitle>Secret values are not in these downloads</AlertTitle>
      The files below describe your data: your media folders, your custom secret types and, for your secrets, only their
      names, types, dates and version counts. Passwords, API keys, card numbers and notes are never included.
      {canOpenBackups ? (
        <>
          {' '}
          To take the values with you, make a password-protected backup on{' '}
          <Link component={RouterLink} to={MY_BACKUPS_PATH}>
            My backups
          </Link>
          : an encrypted zip that only your password opens.
        </>
      ) : (
        ' To take the values with you, ask somebody who can use My backups to make a password-protected backup.'
      )}
    </Alert>
  );
}

export default VaultExportNotice;
