import { useState, useEffect, useCallback } from 'react';
import { api, ApiError, patchCardExtractModel, patchDocumentExtractModel } from './api.js';
import type { SystemSettings } from './types.js';

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
  updateCardExtractModel: (model: string, provider?: string) => Promise<void>;
  /**
   * Set `ai.documentExtractModel` and its provider, the model document scanning
   * runs on (#213); `null` clears both, so documents run on the card model.
   */
  updateDocumentExtractModel: (choice: { model: string; provider: string } | null) => Promise<void>;
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

  /** One `ai` extension write: `If-Match`, a 409 refetches and says so. */
  const saveAiExtension = useCallback(
    async (write: (version: number) => Promise<SystemSettings>) => {
      if (!settings) return;

      try {
        setIsSaving(true);
        setError(null);

        const data = await write(settings.version);

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
    (model: string, provider?: string) => saveAiExtension((version) => patchCardExtractModel(model, version, provider)),
    [saveAiExtension],
  );

  const updateDocumentExtractModel = useCallback(
    (choice: { model: string; provider: string } | null) =>
      saveAiExtension((version) => patchDocumentExtractModel(choice, version)),
    [saveAiExtension],
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
    updateDocumentExtractModel,
    replaceSettings,
    refresh: fetchSettings,
  };
}
