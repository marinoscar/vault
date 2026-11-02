import { ProfileSettings } from '../components/ProfileSettings.js';
import { UserSettingsSection } from '../components/UserSettingsSection.js';

/**
 * The `Profile` card of `/settings` (`/settings/profile`, E10.3 #94): the
 * profile section of the old stacked settings page, unchanged. Reads and saves
 * `/api/user-settings` (`user_settings:read` / `:write`).
 */
export default function ProfileSettingsPage() {
  return (
    <UserSettingsSection title="Profile" description="How you appear in Vault">
      {({ settings, isSaving, run, updateProfile }) => (
        <ProfileSettings
          profile={settings.profile}
          onSave={(profile) => run(() => updateProfile(profile), 'Profile updated', 'Failed to update profile')}
          disabled={isSaving}
        />
      )}
    </UserSettingsSection>
  );
}
