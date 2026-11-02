import { createPlatformApiClient } from '@marinoscar/platform-web/core';
import { useAiConfig } from '@marinoscar/platform-web/ai/headless';
import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

import { api } from './http.js';
import { isCardScanAvailable } from './cardScanAvailability.js';

/**
 * The package's own transport for `GET /api/ai/config` when no shared copy is
 * mounted. A module constant (the hook keys its fetch on the identity); `api` is
 * a lazy proxy, so nothing is read before `configureVaultWeb`.
 */
const vaultAiApi = createPlatformApiClient(api);

interface UseAiStatusResult {
  /**
   * The platform's public AI config (`GET /api/ai/config`). Never null: until the
   * first answer, and when it failed, it is the platform's "AI off" answer.
   */
  config: AiPublicConfig;
  isLoading: boolean;
  /** Set when the config call itself failed, not when AI is merely disabled. */
  error: string | null;
  /**
   * True only when card extraction is actually usable BY THIS VIEWER: card
   * scanning is available (`isCardScanAvailable`: AI on, the deployment's OpenAI
   * key serving everyone) and the viewer holds `ai:use` (the extract route needs
   * it; a Viewer does not hold it, so the scan entry points stay hidden).
   */
  cardExtractEnabled: boolean;
  /** The viewer holds `ai:use` (independent of whether AI is switched on). */
  canUseAi: boolean;
  refresh: () => Promise<void>;
}

/**
 * Whether AI-backed features are available to the current user.
 *
 * Reads the platform's `GET /api/ai/config` through `useAiConfig`
 * (`@marinoscar/platform-web/ai/headless`): the shell's shared copy when the host
 * mounts an `AiConfigContext` provider (apps/web's `VaultAiConfigProvider`), so no
 * second request is made; otherwise its own fetch through this package's client.
 * Card-scan availability is derived on the client with the server's rule
 * (`isCardScanAvailable`).
 *
 * FAILS CLOSED. A network error, a 500, or a malformed body all resolve to
 * "not enabled". Gating an entry point on this hook must never open the gate
 * because the check itself broke — the alternative is offering a card scan that
 * can only end in an error the user cannot act on.
 *
 * The UI presents, the API authorizes: hiding the scan option from a caller
 * without `ai:use` saves them a 403, it is not the gate.
 */
export function useAiStatus(): UseAiStatusResult {
  const { hasPermission } = usePermissions();
  const canUseAi = hasPermission('ai:use');
  const { config, isLoading, error, refresh } = useAiConfig({ api: vaultAiApi });

  return {
    config,
    isLoading,
    error,
    cardExtractEnabled: canUseAi && error === null && isCardScanAvailable(config),
    canUseAi,
    refresh,
  };
}
