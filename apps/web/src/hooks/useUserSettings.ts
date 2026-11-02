import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../services/api';
import { UserSettings } from '../types';
import { useOptionalShellTheme } from '@marinoscar/platform-web/shell/headless';

/**
 * PLATFORM-ADOPTION-SHIM(E4.1): the API's `profile` is the platform's
 * (`imageSource: 'none' | 'provider'`, `customImageUrl`); the profile card still
 * works in terms of `useProviderImage`. These two functions translate at the
 * boundary and go away with `ProfileSettings` (the platform `UserProfilePage`, E10).
 */
type WireProfile = Partial<UserSettings['profile']> & { imageSource?: 'none' | 'provider' | 'upload' };

function fromWire(data: UserSettings): UserSettings {
  const profile = (data.profile ?? {}) as WireProfile;
  const { imageSource, ...rest } = profile;
  return {
    ...data,
    profile: { ...rest, useProviderImage: rest.useProviderImage ?? imageSource !== 'none' },
  };
}

function toWire(updates: Partial<UserSettings>): Record<string, unknown> {
  if (!updates.profile) return updates;
  const { useProviderImage, customImageUrl, ...rest } = updates.profile;
  return {
    ...updates,
    profile: {
      ...rest,
      imageSource: useProviderImage === false ? 'none' : 'provider',
      // `null` deletes the stored URL (JSON Merge Patch).
      customImageUrl: customImageUrl ? customImageUrl : null,
    },
  };
}

interface UseUserSettingsReturn {
  settings: UserSettings | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  updateTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  updateProfile: (profile: UserSettings['profile']) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useUserSettings(): UseUserSettingsReturn {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // The stored `theme` setting drives the shell's light / dark / system choice.
  // Optional: a hook test may render without a ShellRoot.
  // Keyed on the stable setter, not the context value: a theme change must not refetch.
  const setShellMode = useOptionalShellTheme()?.setMode;
  const setMode = useCallback((mode: UserSettings['theme']) => setShellMode?.(mode), [setShellMode]);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = fromWire(await api.get<UserSettings>('/user-settings'));
      setSettings(data);
      // Sync theme with settings
      setMode(data.theme);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load settings';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [setMode]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (updates: Partial<UserSettings>) => {
      if (!settings) return;

      try {
        setIsSaving(true);
        setError(null);

        const data = fromWire(await api.patch<UserSettings>('/user-settings', toWire(updates), {
          headers: {
            'If-Match': settings.version.toString(),
          },
        }));

        setSettings(data);

        // Sync theme if changed
        if (updates.theme) {
          setMode(updates.theme);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // Version conflict - refresh and retry
          await fetchSettings();
          throw new Error('Settings were updated elsewhere. Please try again.');
        }
        const message = err instanceof ApiError ? err.message : 'Failed to save settings';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [settings, setMode, fetchSettings],
  );

  const updateTheme = useCallback(
    async (theme: 'light' | 'dark' | 'system') => {
      await updateSettings({ theme });
    },
    [updateSettings],
  );

  const updateProfile = useCallback(
    async (profile: UserSettings['profile']) => {
      await updateSettings({ profile });
    },
    [updateSettings],
  );

  return {
    settings,
    isLoading,
    error,
    isSaving,
    updateSettings,
    updateTheme,
    updateProfile,
    refresh: fetchSettings,
  };
}
