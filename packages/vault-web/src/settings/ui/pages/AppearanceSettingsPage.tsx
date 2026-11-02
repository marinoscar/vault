import { ThemeSettings } from '../components/ThemeSettings.js';
import { UserSettingsSection } from '../components/UserSettingsSection.js';

/**
 * The `Appearance` card of `/settings` (`/settings/appearance`, E10.3 #94):
 * the theme section of the old stacked settings page, unchanged. Saving the
 * `theme` setting also switches the shell (`useUserSettings` syncs it).
 */
export default function AppearanceSettingsPage() {
  return (
    <UserSettingsSection title="Appearance" description="Light, dark, or follow the system">
      {({ settings, isSaving, run, updateTheme }) => (
        <ThemeSettings
          currentTheme={settings.theme}
          onThemeChange={(theme) => run(() => updateTheme(theme), 'Theme updated', 'Failed to update theme')}
          disabled={isSaving}
        />
      )}
    </UserSettingsSection>
  );
}
