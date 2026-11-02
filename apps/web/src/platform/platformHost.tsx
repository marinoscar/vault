/**
 * Vault's binding of the platform host (E3.3, issue #78).
 *
 * Every `@marinoscar/platform-web` page and headless hook takes its transport,
 * the viewer and the theme setter from ONE `PlatformHostProvider`. This file
 * is that host; it replaced the E10.3 stop-gaps `PlatformHostBridge` and
 * `platformApi.ts` (Vault's own client adapted by hand).
 *
 *   - `api`: `vaultPlatformApi`, the packaged `createPlatformApiClient` over
 *     Vault's one `PlatformHttpClient` (`services/api.ts`): the same bearer
 *     token, refresh-and-retry and `{ data }` unwrapping as every Vault call.
 *     Built ONCE at module scope: packaged hooks key on its identity.
 *   - `viewer`: the signed-in user from the packaged `AuthProvider`;
 *     `hasPermission` is `usePermissions`'s, the predicate every route guard
 *     uses. `isFeatureEnabled` answers the one deployment feature Vault
 *     declares, `ai` (E8.2), from the AI config `VaultAiConfigProvider`
 *     (`platform/aiConfig.tsx`) mounts above this host; anything else is off.
 *   - `applyTheme`: the shell's `setMode` (held by `ShellRoot` in `App.tsx`),
 *     so a packaged page that changes the theme changes Vault's.
 *
 * Mount `VaultPlatformHostProvider` once, inside the auth provider and `ShellRoot`.
 */

import { useCallback, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { PlatformHostProvider, createPlatformApiClient } from '@marinoscar/platform-web/core';
import type { PlatformViewer, PlatformWebHost } from '@marinoscar/platform-web/core';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useOptionalShellTheme } from '@marinoscar/platform-web/shell/headless';
import { useAiFeatures } from '@marinoscar/platform-web/ai/headless';
import type { ShellThemeMode } from '@marinoscar/platform-web/shell/headless';

import { api } from '../services/api';

/** The packaged `PlatformApiClient` over Vault's client. A module constant. */
export const vaultPlatformApi = createPlatformApiClient(api);

/** Vault's {@link PlatformWebHost}, memoised. Runs inside the auth provider. */
export function useVaultPlatformHost(): PlatformWebHost {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const setMode = useOptionalShellTheme()?.setMode;
  const aiEnabled = useAiFeatures().ai;
  const isFeatureEnabled = useCallback((feature: string) => feature === 'ai' && aiEnabled, [aiEnabled]);

  const applyTheme = useCallback(
    (theme: string) => {
      setMode?.(theme as ShellThemeMode);
    },
    [setMode],
  );

  const userId = user?.id ?? null;
  const email = user?.email ?? null;

  const viewer = useMemo<PlatformViewer>(
    () => ({ userId, email, hasPermission, isFeatureEnabled, refresh: refreshUser }),
    [userId, email, hasPermission, isFeatureEnabled, refreshUser],
  );

  return useMemo<PlatformWebHost>(
    () => ({ api: vaultPlatformApi, viewer, ...(setMode ? { applyTheme } : {}) }),
    [viewer, setMode, applyTheme],
  );
}

/** Mounts the packaged `PlatformHostProvider` with {@link useVaultPlatformHost}. */
export function VaultPlatformHostProvider({ children }: { children: ReactNode }): ReactElement {
  const host = useVaultPlatformHost();
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
