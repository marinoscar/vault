import { useState, useCallback } from 'react';
import type { SecretDetail, SecretVersion, SecretVersionDetail } from '../types';
import {
  getSecret as fetchSecretApi,
  updateSecret as updateSecretApi,
  getSecretVersions as fetchVersionsApi,
  getSecretVersion as fetchVersionApi,
  rollbackSecretVersion as rollbackApi,
} from '../services/api';

interface UseSecretDetailResult {
  secret: SecretDetail | null;
  versions: SecretVersion[];
  isLoading: boolean;
  error: string | null;
  fetchSecret: (id: string) => Promise<void>;
  updateSecret: (id: string, data: { name?: string; description?: string | null; data?: Record<string, unknown> }) => Promise<void>;
  fetchVersions: (secretId: string) => Promise<void>;
  fetchVersion: (secretId: string, versionId: string) => Promise<SecretVersionDetail>;
  rollback: (secretId: string, versionId: string) => Promise<void>;
}

export function useSecretDetail(): UseSecretDetailResult {
  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [versions, setVersions] = useState<SecretVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSecret = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchSecretApi(id);
      setSecret(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch secret';
      setError(message);
      setSecret(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSecret = useCallback(async (id: string, data: { name?: string; description?: string | null; data?: Record<string, unknown> }) => {
    setError(null);
    try {
      const result = await updateSecretApi(id, data);
      setSecret(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update secret';
      setError(message);
      throw err;
    }
  }, []);

  const fetchVersions = useCallback(async (secretId: string) => {
    setError(null);
    try {
      const result = await fetchVersionsApi(secretId);
      setVersions(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch versions';
      setError(message);
    }
  }, []);

  const fetchVersion = useCallback(async (secretId: string, versionId: string) => {
    setError(null);
    try {
      return await fetchVersionApi(secretId, versionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch version';
      setError(message);
      throw err;
    }
  }, []);

  const rollback = useCallback(async (secretId: string, versionId: string) => {
    setError(null);
    try {
      const result = await rollbackApi(secretId, versionId);
      setSecret(result);
      // Refresh versions list
      await fetchVersions(secretId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rollback';
      setError(message);
      throw err;
    }
  }, [fetchVersions]);

  return {
    secret, versions, isLoading, error,
    fetchSecret, updateSecret, fetchVersions, fetchVersion, rollback,
  };
}
