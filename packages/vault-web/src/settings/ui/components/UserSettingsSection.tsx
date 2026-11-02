import { Alert, Snackbar } from '@mui/material';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useUserSettings } from '../../../core/headless/useUserSettings.js';
import { LoadingSpinner } from '../../../core/ui/LoadingSpinner.js';
import type { UserSettings } from '../../../core/headless/types.js';
import { SettingsPageFrame } from '../../../core/ui/SettingsPageFrame.js';

/** What a card page of `/api/user-settings` gets to render with. */
export interface UserSettingsSectionContext {
  settings: UserSettings;
  isSaving: boolean;
  /** Runs one save, then shows `success` or the error in a snackbar. */
  run: (save: () => Promise<void>, success: string, failure: string) => Promise<void>;
  updateTheme: (theme: UserSettings['theme']) => Promise<void>;
  updateProfile: (profile: UserSettings['profile']) => Promise<void>;
}

interface UserSettingsSectionProps {
  title: string;
  description: string;
  children: (context: UserSettingsSectionContext) => ReactNode;
}

/**
 * The shared body of the Profile and Appearance cards (E10.3 #94): what the
 * stacked `UserSettingsPage` did once for both (load `/api/user-settings`,
 * spinner, error alert, success and error snackbars), now per page.
 */
export function UserSettingsSection({ title, description, children }: UserSettingsSectionProps) {
  const { settings, isLoading, error, isSaving, updateTheme, updateProfile } = useUserSettings();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const run = async (save: () => Promise<void>, success: string, failure: string) => {
    try {
      await save();
      setSuccessMessage(success);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : failure);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <SettingsPageFrame title={title} description={description}>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {settings && children({ settings, isSaving, run, updateTheme, updateProfile })}

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
        message={successMessage}
      />
      <Snackbar open={!!localError} autoHideDuration={5000} onClose={() => setLocalError(null)}>
        <Alert severity="error" onClose={() => setLocalError(null)}>
          {localError}
        </Alert>
      </Snackbar>
    </SettingsPageFrame>
  );
}
