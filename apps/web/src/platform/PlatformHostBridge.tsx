/**
 * The platform host (`PlatformHostProvider`) the packaged pages read: Vault's
 * client as the transport and Vault's session as the viewer (E10.3, issue
 * #94). The Doctor, About and Maintenance cards render packaged pages
 * (`@marinoscar/platform-web/doctor/ui`, `/host/ui`) that take everything from
 * this host.
 *
 * A STOP-GAP until E3.3 adopts the platform's identity UI, `AuthProvider` and
 * HTTP client (docs/platform-adoption/local-exceptions.md). It makes no
 * request of its own. `applyTheme` is the shell's `setMode`, so a packaged
 * page that changes the theme changes Vault's.
 */

import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import type { PlatformWebHost } from '@marinoscar/platform-web/core';
import { useOptionalShellTheme } from '@marinoscar/platform-web/shell/headless';
import type { ShellThemeMode } from '@marinoscar/platform-web/shell/headless';

import { useAuth } from '../contexts/AuthContext';
import { vaultPlatformApi } from './platformApi';

// PLATFORM-ADOPTION-SHIM(E3.3): Vault's session and client as the platform host.
export function PlatformHostBridge({ children }: { children: ReactNode }): ReactElement {
  const { user, refreshUser } = useAuth();
  const setMode = useOptionalShellTheme()?.setMode;

  const host = useMemo<PlatformWebHost>(() => {
    const permissions = new Set(user?.permissions ?? []);
    return {
      api: vaultPlatformApi,
      viewer: {
        userId: user?.id ?? null,
        email: user?.email ?? null,
        hasPermission: (permission: string) => permissions.has(permission),
        // Vault declares no deployment features to the platform yet (E8 adds `ai`).
        isFeatureEnabled: () => false,
        refresh: refreshUser,
      },
      ...(setMode ? { applyTheme: (theme: string) => setMode(theme as ShellThemeMode) } : {}),
    };
  }, [user, refreshUser, setMode]);

  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
