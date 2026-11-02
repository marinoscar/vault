import { SettingsHub } from '@marinoscar/platform-web/settings/ui';
import { usePermissions } from '../../hooks/usePermissions';
import { ADMIN_HUB_TITLE, ADMIN_SECTIONS } from '../../config/adminSections';

/**
 * The Console hub (`/admin/settings`, E10.3 #94): a thin binding of the
 * packaged `SettingsHub` over `ADMIN_SECTIONS`. It replaces the tab strip of
 * the old `SystemSettingsPage`; every card navigates to its own route. The
 * route is gated in `App.tsx` on the Console destination's `anyPermission`
 * (`system_settings:read` or `users:read`); each card is filtered by its own
 * permission inside the hub. No card is feature-gated today, so no feature map
 * is passed (E8 adds `ai`).
 */
export default function AdminSettingsHubPage() {
  const { hasPermission } = usePermissions();
  return (
    <SettingsHub
      sections={ADMIN_SECTIONS}
      hubKey="admin-settings-hub"
      title={ADMIN_HUB_TITLE}
      subtitle="Configure Vault for everyone: users, AI, backups and operations."
      hasPermission={hasPermission}
    />
  );
}
