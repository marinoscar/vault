import { Navigate } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { DataBackup } from '../components/DataBackup.js';
import { SettingsPageFrame } from '../../../core/ui/SettingsPageFrame.js';

/**
 * The `My backups` card of `/settings` (`/settings/backups`, E10.3 #94): the
 * "Back up my data" section (download, save to storage, the saved list),
 * unchanged. `my-backups.controller.ts` and `POST /api/secrets/export` need
 * `secrets:read` (never `secrets:read_any` alone). The password stays in
 * component state only.
 */
export default function MyBackupsPage() {
  const { hasPermission } = usePermissions();

  if (!hasPermission('secrets:read')) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <SettingsPageFrame title="My backups" description="Encrypted backups of the secrets you own" maxWidth="lg">
      <DataBackup />
    </SettingsPageFrame>
  );
}
