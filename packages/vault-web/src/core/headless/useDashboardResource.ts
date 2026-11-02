import { useCallback, useEffect, useRef, useState } from 'react';

export type DashboardResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DashboardResource<T> {
  /** `idle` while disabled (the user lacks the permission), so nothing is fetched. */
  status: DashboardResourceStatus;
  data: T | null;
  error: string | null;
  /** Fetch again (the error state's "Try again"). */
  reload: () => void;
}

/**
 * One independently loaded dashboard source.
 *
 * Each Home panel owns one of these, so every source starts on mount in
 * parallel, a slow or failing source never holds back the others, and each
 * panel has its own loading, error and retry. A disabled resource issues no
 * request at all: the API would answer 403, and hiding the panel is the UI's
 * half of the same gate.
 *
 * `fetcher` must be stable (a module-level function or a `useCallback`).
 * Responses that arrive after a newer request (or after unmount) are dropped.
 */
export function useDashboardResource<T>(
  fetcher: () => Promise<T>,
  enabled: boolean,
  errorFallback = 'Something went wrong',
): DashboardResource<T> {
  const [state, setState] = useState<Omit<DashboardResource<T>, 'reload'>>(() => ({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
  }));
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));
    try {
      const data = await fetcher();
      if (id === requestId.current) setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (id !== requestId.current) return;
      const message = err instanceof Error && err.message ? err.message : errorFallback;
      setState({ status: 'error', data: null, error: message });
    }
  }, [fetcher, errorFallback]);

  useEffect(() => {
    if (!enabled) {
      requestId.current++;
      setState({ status: 'idle', data: null, error: null });
      return;
    }
    void load();
    return () => {
      // Invalidate in-flight responses on unmount or when the source changes.
      requestId.current++;
    };
  }, [enabled, load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { ...state, reload };
}
