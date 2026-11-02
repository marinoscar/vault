import { SettingsHub } from '@marinoscar/platform-web/settings/ui';
import { useSettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from '../config/userSettingsSections';

/**
 * The per-user hub (`/settings`, E10.3 #94): the twin of the Console hub, a
 * thin binding of the packaged `SettingsHub` over `USER_SETTINGS_SECTIONS`.
 * It replaces the stacked `UserSettingsPage`. No route gate: every signed-in
 * user reaches their own settings, and each card is filtered by its own
 * permission inside the hub.
 */
export default function UserSettingsHubPage() {
  const { hasPermission } = usePermissions();
  // The registered feature resolvers (config/settingsFeatures.ts): `ai` hides the
  // `feature: 'ai'` cards while AI is off (E8.2).
  const features = useSettingsFeatures();
  return (
    <SettingsHub
      sections={USER_SETTINGS_SECTIONS}
      hubKey="user-settings-hub"
      title={USER_HUB_TITLE}
      subtitle="Manage your account preferences"
      hasPermission={hasPermission}
      features={features}
    />
  );
}
