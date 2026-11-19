import { createPlatformApiClient } from '@marinoscar/platform-web/core';
import { useAiConfig } from '@marinoscar/platform-web/ai/headless';
import type { AiPublicConfig } from '@marinoscar/platform-web/ai/headless';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

import { useCallback, useEffect, useState } from 'react';
import type { ScanTargets } from '@marinoscar/vault-contract/secrets';

import { api } from './http.js';
import { getScanTargets } from './api.js';
import { isDocumentScanAvailable, isScanAvailable } from './cardScanAvailability.js';

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
   * scanning is available (`isScanAvailable(config, 'card_extract', targets)`: AI
   * on, the card model able to read images on an enabled provider whose call can
   * be paid) and the viewer holds `ai:use` (the extract route needs it; a Viewer
   * does not hold it, so the scan entry points stay hidden).
   */
  cardExtractEnabled: boolean;
  /**
   * True only when document scanning (Passport and ID Document, ADR-0004) is
   * usable by this viewer: the same rule for `document_extract` (its own model,
   * or the card model when none is chosen, #213), and `ai:use`.
   */
  documentScanEnabled: boolean;
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
 * Scan availability is derived on the client with the server's rule
 * (`isScanAvailable` of `@marinoscar/vault-contract/secrets`) over that config and
 * `GET /api/secrets/scan/targets` (the model each scan feature runs on, #213),
 * which is asked only when the viewer holds `ai:use` and AI is on.
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
  const { config, isLoading, error, refresh: refreshConfig } = useAiConfig({ api: vaultAiApi });

  const wantTargets = canUseAi && !isLoading && error === null && config.enabled === true;
  const [targets, setTargets] = useState<ScanTargets | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsTick, setTargetsTick] = useState(0);

  useEffect(() => {
    if (!wantTargets) {
      setTargets(null);
      setTargetsLoading(false);
      return;
    }
    let cancelled = false;
    setTargetsLoading(true);
    getScanTargets()
      .then((next) => {
        if (!cancelled) setTargets(next);
      })
      .catch(() => {
        // Fails closed: no targets, no scan.
        if (!cancelled) setTargets(null);
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wantTargets, targetsTick]);

  const refresh = useCallback(async () => {
    await refreshConfig();
    setTargetsTick((tick) => tick + 1);
  }, [refreshConfig]);

  // `null` targets (not asked, in flight, failed) is "no" for both features.
  const ready = canUseAi && error === null && targets !== null;

  return {
    config,
    isLoading: isLoading || targetsLoading,
    error,
    cardExtractEnabled: ready && isScanAvailable(config, 'card_extract', targets),
    documentScanEnabled: ready && isDocumentScanAvailable(config, targets),
    canUseAi,
    refresh,
  };
}
