/**
 * Vault's mount of the platform AI config (E8.2, issue #88).
 *
 * `GET /api/ai/config` answers "is AI switched on, and which providers" to any
 * signed-in user. Three things read that one answer: the `ai` settings feature
 * (the AI models and AI usage cards in `config/adminSections.tsx` exist only
 * while it is on, through `config/settingsFeatures.ts`), `RequireAiEnabled` on
 * their routes, and the packaged AI pages (the AI page refreshes it after the
 * switch is saved).
 *
 * The package's `AiConfigProvider` fetches the moment it mounts, and it sits
 * above the router, so on `/login` it would ask while nobody is signed in and
 * get a 401. This binding is the same context with one difference: it does not
 * fetch until the session is authenticated, and answers "off" after sign-out.
 * While the session is authenticated and the first answer has not landed it
 * reports `isLoading: true`, so a deep link to `/admin/settings/ai/models` waits
 * instead of `RequireAiEnabled` redirecting on a stale "off". Same shape as
 * KVox's `AiConfigBinding.tsx`.
 *
 * The card-scan gate reads the same answer: vault-web's `useAiStatus` takes it
 * through the platform's `useAiConfig` (so no second request is made) and applies
 * `isCardScanAvailable` (AI on, key policy `byok_with_org_fallback`, the `openai`
 * provider on with its deployment key), combined with the viewer's `ai:use`.
 */

import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useAuth } from '@marinoscar/platform-web/identity/headless';
import { AI_CONFIG_DISABLED, AiConfigContext, useAiConfigQuery } from '@marinoscar/platform-web/ai/headless';
import type { UseAiConfigReturn } from '@marinoscar/platform-web/ai/headless';

import { vaultPlatformApi } from './platformHost';

const SIGNED_OUT: UseAiConfigReturn = {
  config: AI_CONFIG_DISABLED,
  isLoading: false,
  error: null,
  refresh: async () => {},
};

/** Mounts the platform `AiConfigContext`, fetching only once signed in. */
export function VaultAiConfigProvider({ children }: { children: ReactNode }): ReactElement {
  const { isAuthenticated } = useAuth();
  const query = useAiConfigQuery({ skip: !isAuthenticated, api: vaultPlatformApi });

  const settled = query.config !== AI_CONFIG_DISABLED || query.error !== null;
  const value = useMemo<UseAiConfigReturn>(
    () => (isAuthenticated ? { ...query, isLoading: query.isLoading || !settled } : SIGNED_OUT),
    [isAuthenticated, query, settled],
  );

  return <AiConfigContext.Provider value={value}>{children}</AiConfigContext.Provider>;
}
