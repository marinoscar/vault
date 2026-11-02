import { Navigate } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { SettingsPageFrame } from '../../components/settings/SettingsPageFrame';
import { ScheduledBackups } from '../../components/admin/ScheduledBackups';

/**
 * The `Backups` card of the Console (`/admin/settings/backups`, E10.3 #94):
 * the old "Backups" tab, unchanged. `ScheduledBackups` loads and saves its own
 * data (the schedule and the run history live in `/api/admin/backups`, not in
 * the system settings object) and reads write access itself; the page only
 * gates the read on `system_settings:read`.
 */
export default function BackupSettingsPage() {
  const { hasPermission } = usePermissions();

  if (!hasPermission('system_settings:read')) {
    return <Navigate to="/" replace />;
  }

  return (
    <SettingsPageFrame
      title="Backups"
      description="Scheduled encrypted backups of the whole vault, kept in object storage"
      maxWidth="lg"
    >
      <ScheduledBackups />
    </SettingsPageFrame>
  );
}
