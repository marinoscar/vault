import { useCallback, useEffect, useState } from 'react';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

import { getAiStatus } from './api.js';
import type { AiStatus } from './types.js';

interface UseAiStatusResult {
  status: AiStatus | null;
  isLoading: boolean;
  /** Set when the status call itself failed, not when AI is merely disabled. */
  error: string | null;
  /**
   * True only when card extraction is actually usable BY THIS VIEWER: AI is on,
   * `card_extract` is available, and the viewer holds `ai:use` (the extract route
   * needs it; a Viewer does not hold it, so the scan entry points stay hidden).
   */
  cardExtractEnabled: boolean;
  /** The viewer holds `ai:use` (independent of whether AI is switched on). */
  canUseAi: boolean;
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
 * another tab, and the status call is two booleans. `GET /api/ai/status` is the
 * compatibility alias of the platform's `GET /api/ai/config` (E8.1), same wire.
 *
 * The UI presents, the API authorizes: hiding the scan option from a caller
 * without `ai:use` saves them a 403, it is not the gate.
 */
export function useAiStatus(): UseAiStatusResult {
  const { hasPermission } = usePermissions();
  const canUseAi = hasPermission('ai:use');
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
    void load();
  }, [load]);

  return {
    status,
    isLoading,
    error,
    cardExtractEnabled: canUseAi && status?.enabled === true && status.features.cardExtract === true,
    canUseAi,
    refresh: load,
  };
}
