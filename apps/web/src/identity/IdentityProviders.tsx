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
 *   - `DataTablePreferencesProvider` keeps the packaged tables' layouts in
 *     this browser until `/user-settings` carries them (E4,
 *     `platform/dataTablePreferences.ts`).
 *
 * Mount it once, inside the router (the provider navigates).
 */

import type { ReactElement, ReactNode } from 'react';
import { AuthProvider, IdentityWebAdaptersProvider } from '@marinoscar/platform-web/identity/headless';
import { DataTablePreferencesProvider } from '@marinoscar/platform-web/datatable/headless';

import { api } from '../services/api';
import { dataTablePreferencesPort } from '../platform/dataTablePreferences';
import { vaultIdentityAdapters } from './identityAdapters';

export function IdentityProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <AuthProvider client={api}>
      <IdentityWebAdaptersProvider adapters={vaultIdentityAdapters}>
        <DataTablePreferencesProvider port={dataTablePreferencesPort}>{children}</DataTablePreferencesProvider>
      </IdentityWebAdaptersProvider>
    </AuthProvider>
  );
}
