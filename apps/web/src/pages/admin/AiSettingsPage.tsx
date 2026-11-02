import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { SettingsPageFrame } from '../../components/settings/SettingsPageFrame';
import { AiSettings } from '../../components/settings/AiSettings';

/**
 * The `AI` card of the Console (`/admin/settings/ai`, E10.3 #94): the old
 * "AI" tab, unchanged. `AiSettings` owns its own load and save (including the
 * write-only API key contract), so the page only gates: read needs
 * `system_settings:read`, every control is disabled without
 * `system_settings:write`. This is the card that switches AI on, so it is
 * never hidden behind `feature: 'ai'`.
 */
export default function AiSettingsPage() {
  const { hasPermission } = usePermissions();

  if (!hasPermission('system_settings:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('system_settings:write');

  return (
    <SettingsPageFrame
      title="AI"
      description={`Card scanning with an admin-configured vision model${canWrite ? '' : ' (read-only)'}`}
    >
      <AiSettings disabled={!canWrite} />
    </SettingsPageFrame>
  );
}
