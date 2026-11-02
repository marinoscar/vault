/**
 * Bridges Vault's own session (`contexts/AuthContext`) into the platform's
 * identity context, which the shell's surfaces read (`ShellUserMenu`'s
 * `useAuth`, every surface's `usePermissions`).
 *
 * A STOP-GAP until E3.3 adopts the platform's identity UI and `AuthProvider`
 * (docs/platform-adoption/local-exceptions.md): Vault keeps signing in, holding
 * the token and calling `/api/auth/me` exactly as before; this component only
 * re-publishes that state in the platform's shape. It makes no request.
 */

import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AuthContext as PlatformAuthContext } from '@marinoscar/platform-web/identity/headless';
import type { AuthContextValue as PlatformAuthContextValue } from '@marinoscar/platform-web/identity/headless';

import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

function noOrgSwitch(): Promise<void> {
  // Vault is single-organization until E3; nothing offers a switcher.
  return Promise.reject(new Error('Organization switching is not available'));
}

// PLATFORM-ADOPTION-SHIM(E3.3): Vault's session re-published to the platform identity context.
export function PlatformAuthBridge({ children }: { children: ReactNode }): ReactElement {
  const { user, isLoading, isAuthenticated, providers, login, logout, refreshUser } = useAuth();

  const value = useMemo<PlatformAuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated,
      providers,
      sessionExpired: false,
      login: (provider: string) => login(provider),
      logout,
      refreshUser,
      setAccessToken: (token: string | null) => api.setAccessToken(token),
      activeOrg: null,
      memberships: [],
      switchOrg: noOrgSwitch,
      mode: 'server',
    }),
    [user, isLoading, isAuthenticated, providers, login, logout, refreshUser],
  );

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}
