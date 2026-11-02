import { useState, useEffect, useCallback } from 'react';
import { api, ApiError, patchCardExtractModel } from '../services/api';
import type { SystemSettings } from '../types';

const CONFLICT_MESSAGE =
  'Settings were updated elsewhere. Please review and try again.';

interface UseSystemSettingsReturn {
  settings: SystemSettings | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  updateSettings: (updates: Partial<SystemSettings>) => Promise<void>;
  /**
   * Set `ai.cardExtractModel`, the model card scanning runs on (E8.2). The rest
   * of the `ai` namespace is the platform's AI page's (`/api/admin/ai/*`).
   */
  updateCardExtractModel: (model: string) => Promise<void>;
  replaceSettings: (settings: Omit<SystemSettings, 'updatedAt' | 'updatedBy' | 'version'>) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSystemSettings(): UseSystemSettingsReturn {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.get<SystemSettings>('/system-settings');
      setSettings(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view system settings');
      } else {
        const message = err instanceof ApiError ? err.message : 'Failed to load settings';
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (updates: Partial<SystemSettings>) => {
      if (!settings) return;

      try {
        setIsSaving(true);
        setError(null);

        const data = await api.patch<SystemSettings>('/system-settings', updates, {
          headers: {
            'If-Match': settings.version.toString(),
          },
        });

        setSettings(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await fetchSettings();
          throw new Error(CONFLICT_MESSAGE);
        }
        const message = err instanceof ApiError ? err.message : 'Failed to save settings';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [settings, fetchSettings],
  );

  const updateCardExtractModel = useCallback(
    async (model: string) => {
      if (!settings) return;

      try {
        setIsSaving(true);
        setError(null);

        const data = await patchCardExtractModel(model, settings.version);

        setSettings(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await fetchSettings();
          throw new Error(CONFLICT_MESSAGE);
        }
        const message = err instanceof ApiError ? err.message : 'Failed to save settings';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [settings, fetchSettings],
  );

  const replaceSettings = useCallback(
    async (newSettings: Omit<SystemSettings, 'updatedAt' | 'updatedBy' | 'version'>) => {
      try {
        setIsSaving(true);
        setError(null);

        const data = await api.put<SystemSettings>('/system-settings', newSettings);
        setSettings(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed to save settings';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  return {
    settings,
    isLoading,
    error,
    isSaving,
    updateSettings,
    updateCardExtractModel,
    replaceSettings,
    refresh: fetchSettings,
  };
}
