import { useCallback, useEffect, useState } from 'react';

import { getAiStatus } from '../services/api';
import type { AiStatus } from '../types';

interface UseAiStatusResult {
  status: AiStatus | null;
  isLoading: boolean;
  /** Set when the status call itself failed, not when AI is merely disabled. */
  error: string | null;
  /** Convenience: true only when card extraction is actually usable. */
  cardExtractEnabled: boolean;
  refresh: () => Promise<void>;
}

/**
 * Whether AI-backed features are available to the current user.
 *
 * FAILS CLOSED. A network error, a 500, or a malformed body all resolve to
 * "not enabled". Gating an entry point on this hook must never open the gate
 * because the check itself broke — the alternative is offering a card scan that
 * can only end in an error the user cannot act on.
 *
 * The result is not cached across mounts: an admin can flip the feature on in
 * another tab, and the status call is two booleans.
 */
export function useAiStatus(): UseAiStatusResult {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getAiStatus();
      setStatus({
        enabled: result?.enabled === true,
        features: { cardExtract: result?.features?.cardExtract === true },
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not check AI availability',
      );
      setStatus({ enabled: false, features: { cardExtract: false } });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return {
    status,
    isLoading,
    error,
    cardExtractEnabled: status?.enabled === true && status.features.cardExtract === true,
    refresh: load,
  };
}
