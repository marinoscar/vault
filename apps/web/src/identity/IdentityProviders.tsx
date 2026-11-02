/**
 * Vault's binding of the identity slice's providers (E3.3, issue #78). One
 * component, so `App.tsx` and the tests mount the SAME wiring:
 *
 *   - `AuthProvider` (`@marinoscar/platform-web/identity/headless`) holds the
 *     session through Vault's one `PlatformHttpClient` (`client={api}`): one
 *     refresh from the HttpOnly cookie on boot, `GET /auth/me`, the sign-in
 *     redirect to `/api/auth/<provider>`, `POST /auth/logout`, the "session
 *     expired" signal. The access token lives only in that client. It replaced
 *     Vault's own `contexts/AuthContext` and the `PlatformAuthBridge` stop-gap.
 *   - `IdentityWebAdaptersProvider` hands the identity pages Vault's name,
 *     spinner, table and identity client (`identityAdapters.ts`). It sits
 *     inside the auth provider and outside the routes: the login page renders
 *     outside the signed-in shell.
 *
 * No `DataTablePreferencesProvider` here (#153): every `DataTable` takes the
 * platform's default port, which keeps its layout in the `dataTables`
 * namespace of `/api/user-settings` through the platform host's client
 * (`VaultPlatformHostProvider`, mounted inside this in `App.tsx`).
 *
 * Mount it once, inside the router (the provider navigates).
 */

import type { ReactElement, ReactNode } from 'react';
import { AuthProvider, IdentityWebAdaptersProvider } from '@marinoscar/platform-web/identity/headless';

import { api } from '../services/api';
import { vaultIdentityAdapters } from './identityAdapters';

export function IdentityProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <AuthProvider client={api}>
      <IdentityWebAdaptersProvider adapters={vaultIdentityAdapters}>
        {children}
      </IdentityWebAdaptersProvider>
    </AuthProvider>
  );
}
