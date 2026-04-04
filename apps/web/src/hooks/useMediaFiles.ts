import { useState, useCallback } from 'react';
import type { MediaFile, MediaFilesResponse } from '../types';
import {
  getMediaFiles as fetchFilesApi,
  deleteMediaFile as deleteFileApi,
  renameMediaFile as renameFileApi,
  simpleStorageUpload,
  linkMediaFile,
} from '../services/api';

interface UseMediaFilesResult {
  files: MediaFile[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  fetchFiles: (folderId: string, params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) => Promise<void>;
  deleteFile: (folderId: string, fileId: string) => Promise<void>;
  renameFile: (folderId: string, fileId: string, name: string) => Promise<void>;
  uploadFile: (folderId: string, file: File) => Promise<MediaFile>;
}

export function useMediaFiles(): UseMediaFilesResult {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async (
    folderId: string,
    params?: { page?: number; pageSize?: number; search?: string },
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const response: MediaFilesResponse = await fetchFilesApi(folderId, params);
      setFiles(response.items);
      setTotalItems(response.meta.totalItems);
      setPage(response.meta.page);
      setPageSize(response.meta.pageSize);
      setTotalPages(response.meta.totalPages);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch files';
      setError(message);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteFile = useCallback(async (folderId: string, fileId: string) => {
    setError(null);
    try {
      await deleteFileApi(folderId, fileId);
      await fetchFiles(folderId, { page, pageSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete file';
      setError(message);
      throw err;
    }
  }, [fetchFiles, page, pageSize]);

  const renameFile = useCallback(async (folderId: string, fileId: string, name: string) => {
    setError(null);
    try {
      await renameFileApi(folderId, fileId, name);
      await fetchFiles(folderId, { page, pageSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename file';
      setError(message);
      throw err;
    }
  }, [fetchFiles, page, pageSize]);

  const uploadFile = useCallback(async (folderId: string, file: File): Promise<MediaFile> => {
    setError(null);
    try {
      const storageObject = await simpleStorageUpload(file);
      const mediaFile = await linkMediaFile(folderId, storageObject.id);
      await fetchFiles(folderId, { page, pageSize });
      return mediaFile;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload file';
      setError(message);
      throw err;
    }
  }, [fetchFiles, page, pageSize]);

  return {
    files,
    totalItems,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    fetchFiles,
    deleteFile,
    renameFile,
    uploadFile,
  };
}
