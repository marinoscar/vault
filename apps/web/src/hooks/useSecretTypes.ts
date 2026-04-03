import { useState, useCallback } from 'react';
import type { SecretType } from '../types';
import {
  getSecretTypes as fetchSecretTypesApi,
  createSecretType as createSecretTypeApi,
  updateSecretType as updateSecretTypeApi,
  deleteSecretType as deleteSecretTypeApi,
} from '../services/api';

interface UseSecretTypesResult {
  types: SecretType[];
  isLoading: boolean;
  error: string | null;
  fetchTypes: (params?: { search?: string; includeSystem?: boolean }) => Promise<void>;
  createType: (data: Parameters<typeof createSecretTypeApi>[0]) => Promise<SecretType>;
  updateType: (id: string, data: Parameters<typeof updateSecretTypeApi>[1]) => Promise<SecretType>;
  deleteType: (id: string) => Promise<void>;
}

export function useSecretTypes(): UseSecretTypesResult {
  const [types, setTypes] = useState<SecretType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTypes = useCallback(async (params?: { search?: string; includeSystem?: boolean }) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchSecretTypesApi(params);
      setTypes(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch secret types';
      setError(message);
      setTypes([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createType = useCallback(async (data: Parameters<typeof createSecretTypeApi>[0]) => {
    setError(null);
    try {
      const result = await createSecretTypeApi(data);
      await fetchTypes();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create secret type';
      setError(message);
      throw err;
    }
  }, [fetchTypes]);

  const updateType = useCallback(async (id: string, data: Parameters<typeof updateSecretTypeApi>[1]) => {
    setError(null);
    try {
      const result = await updateSecretTypeApi(id, data);
      await fetchTypes();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update secret type';
      setError(message);
      throw err;
    }
  }, [fetchTypes]);

  const deleteType = useCallback(async (id: string) => {
    setError(null);
    try {
      await deleteSecretTypeApi(id);
      await fetchTypes();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete secret type';
      setError(message);
      throw err;
    }
  }, [fetchTypes]);

  return { types, isLoading, error, fetchTypes, createType, updateType, deleteType };
}
