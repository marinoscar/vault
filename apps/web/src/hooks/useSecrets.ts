import { useState, useCallback } from 'react';
import type { SecretListItem, SecretsResponse } from '../types';
import {
  getSecrets as fetchSecretsApi,
  createSecret as createSecretApi,
  deleteSecret as deleteSecretApi,
} from '../services/api';

interface UseSecretsResult {
  secrets: SecretListItem[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  fetchSecrets: (params?: {
    page?: number;
    pageSize?: number;
    typeId?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => Promise<void>;
  createSecret: (data: Parameters<typeof createSecretApi>[0]) => Promise<void>;
  deleteSecret: (id: string) => Promise<void>;
}

export function useSecrets(): UseSecretsResult {
  const [secrets, setSecrets] = useState<SecretListItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSecrets = useCallback(async (params?: {
    page?: number;
    pageSize?: number;
    typeId?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    setIsLoading(true);
    setError(null);
    try {
      const response: SecretsResponse = await fetchSecretsApi(params);
      setSecrets(response.items);
      setTotalItems(response.meta.totalItems);
      setPage(response.meta.page);
      setPageSize(response.meta.pageSize);
      setTotalPages(response.meta.totalPages);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch secrets';
      setError(message);
      setSecrets([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createSecret = useCallback(async (data: Parameters<typeof createSecretApi>[0]) => {
    setError(null);
    try {
      await createSecretApi(data);
      await fetchSecrets({ page, pageSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create secret';
      setError(message);
      throw err;
    }
  }, [fetchSecrets, page, pageSize]);

  const deleteSecret = useCallback(async (id: string) => {
    setError(null);
    try {
      await deleteSecretApi(id);
      await fetchSecrets({ page, pageSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete secret';
      setError(message);
      throw err;
    }
  }, [fetchSecrets, page, pageSize]);

  return {
    secrets, totalItems, page, pageSize, totalPages, isLoading, error,
    fetchSecrets, createSecret, deleteSecret,
  };
}
