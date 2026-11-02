import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackupRun, BackupRunsResponse } from '../types';

/** How often a backup history is refreshed while a run is in progress. */
export const BACKUP_POLL_INTERVAL_MS = 5000;

export interface UseBackupRunHistoryOptions {
  /** Called once each time the last running backup settles (succeeds or fails). */
  onRunSettled?: () => void;
  /** Message shown when the list cannot be loaded and the error has none. */
  errorFallback?: string;
  initialRowsPerPage?: number;
}

export interface BackupRunHistory {
  runs: BackupRun[];
  total: number;
  page: number;
  rowsPerPage: number;
  loading: boolean;
  error: string | null;
  /** True while any listed run is still running; the list polls meanwhile. */
  hasRunning: boolean;
  setPage: (page: number) => void;
  /** Change the page size and go back to the first page. */
  setRowsPerPage: (rows: number) => void;
  reload: () => Promise<void>;
  /** Show the newest runs: go to the first page, or reload when already there. */
  showNewest: () => Promise<void>;
}

/**
 * A paginated backup run list (the admin history or the user's saved
 * backups) that re-fetches every `BACKUP_POLL_INTERVAL_MS` while a run is
 * in progress and stops once nothing is running or the component unmounts.
 * `fetchRuns` must be stable (a module-level API function).
 */
export function useBackupRunHistory(
  fetchRuns: (params: { page: number; pageSize: number }) => Promise<BackupRunsResponse>,
  options: UseBackupRunHistoryOptions = {},
): BackupRunHistory {
  const { errorFallback = 'Failed to load backup history', initialRowsPerPage = 10 } = options;

  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPageState] = useState(initialRowsPerPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onRunSettled = useRef(options.onRunSettled);
  onRunSettled.current = options.onRunSettled;

  const reload = useCallback(async () => {
    try {
      const res = await fetchRuns({ page: page + 1, pageSize: rowsPerPage });
      if (!mountedRef.current) return;
      setRuns(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error && err.message ? err.message : errorFallback);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchRuns, page, rowsPerPage, errorFallback]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const hasRunning = runs.some((r) => r.status === 'running');

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !hasRunning) onRunSettled.current?.();
    wasRunning.current = hasRunning;
    if (!hasRunning) return undefined;
    const timer = setInterval(() => void reload(), BACKUP_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, reload]);

  const setRowsPerPage = useCallback((rows: number) => {
    setRowsPerPageState(rows);
    setPage(0);
  }, []);

  const showNewest = useCallback(async () => {
    if (page !== 0) setPage(0);
    else await reload();
  }, [page, reload]);

  return {
    runs,
    total,
    page,
    rowsPerPage,
    loading,
    error,
    hasRunning,
    setPage,
    setRowsPerPage,
    reload,
    showNewest,
  };
}
