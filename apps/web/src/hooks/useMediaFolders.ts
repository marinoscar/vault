import { useState, useCallback } from 'react';
import type { MediaFolder, MediaFoldersResponse } from '../types';
import {
  getMediaFolders as fetchFoldersApi,
  createMediaFolder as createFolderApi,
  deleteMediaFolder as deleteFolderApi,
  updateMediaFolder as renameFolderApi,
} from '../services/api';

interface UseMediaFoldersResult {
  folders: MediaFolder[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  fetchFolders: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => Promise<void>;
  createFolder: (name: string) => Promise<MediaFolder>;
  deleteFolder: (id: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
}

export function useMediaFolders(): UseMediaFoldersResult {
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFolders = useCallback(async (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    setIsLoading(true);
    setError(null);
    try {
      const response: MediaFoldersResponse = await fetchFoldersApi(params);
      setFolders(response.items);
      setTotalItems(response.meta.totalItems);
      setPage(response.meta.page);
      setPageSize(response.meta.pageSize);
      setTotalPages(response.meta.totalPages);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch folders';
      setError(message);
      setFolders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createFolder = useCallback(async (name: string): Promise<MediaFolder> => {
    setError(null);
    try {
      const result = await createFolderApi(name);
      await fetchFolders({ page, pageSize });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create folder';
      setError(message);
      throw err;
    }
  }, [fetchFolders, page, pageSize]);

  const deleteFolder = useCallback(async (id: string) => {
    setError(null);
    try {
      await deleteFolderApi(id);
      await fetchFolders({ page, pageSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete folder';
      setError(message);
      throw err;
    }
  }, [fetchFolders, page, pageSize]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    setError(null);
    try {
      await renameFolderApi(id, name);
      await fetchFolders({ page, pageSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename folder';
      setError(message);
      throw err;
    }
  }, [fetchFolders, page, pageSize]);

  return {
    folders,
    totalItems,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    fetchFolders,
    createFolder,
    deleteFolder,
    renameFolder,
  };
}
