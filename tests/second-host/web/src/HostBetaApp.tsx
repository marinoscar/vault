// =============================================================================
// Host Beta's web side: its own brand and navigation around the Vault slices (issue #194)
// =============================================================================
//
// The host mounts the `vault-web` slices it wants (secrets, cards, agent, settings) on the routes
// they own (EMBEDDING.md, "Web slices"), under ITS brand (its own shell theme, not Vault's
// `/brand`) and ITS navigation (its own destinations, not Vault's `/navigation`), next to its own
// page. The package gets its transport and the product name once, from `configureHostBetaWeb`.
// =============================================================================

import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';
import { Link as RouterLink, Route, Routes } from 'react-router-dom';
import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material';
import NotesIcon from '@mui/icons-material/StickyNote2Outlined';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import CardIcon from '@mui/icons-material/CreditCardOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { PlatformHostProvider, createPlatformApiClient, type PlatformHttpClient, type PlatformWebHost } from '@marinoscar/platform-web/core';
import { AuthContext, useAuth, usePermissions, type AuthContextValue } from '@marinoscar/platform-web/identity/headless';
import { createShellTheme, isDestinationVisible, type ShellDestination } from '@marinoscar/platform-web/shell/headless';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';
import { configureVaultWeb, getVaultHttp } from '@marinoscar/vault-web/core/headless';
import { CreateSecretPage, SecretDetailPage, SecretsPage } from '@marinoscar/vault-web/secrets/ui';
import { CardsPage } from '@marinoscar/vault-web/cards/ui';
import { AgentAccessSettingsPage } from '@marinoscar/vault-web/agent/ui';
import { ProfileSettingsPage } from '@marinoscar/vault-web/settings/ui';

import identity from '../../packages/shared/identity.json';

/** Hands the Vault slices the host's one HTTP client and its product name. Call once, before the first render. */
export function configureHostBetaWeb(http: PlatformHttpClient, apiBaseUrl = '/api'): void {
  configureVaultWeb({ http, apiBaseUrl, productName: identity.productName });
}

/** Host Beta's brand: its own colour on the platform shell's base theme. */
export const HOST_BETA_THEMES = {
  light: createShellTheme('light', { palette: { primary: { main: identity.themeColor } } }),
  dark: createShellTheme('dark', { palette: { primary: { main: identity.themeColor } } }),
};

/**
 * Host Beta's navigation: its own page first, then the Vault slices it mounts. The gates are the
 * permission strings the API enforces (`secrets:read` for secrets and cards, the host's own
 * `beta_notes:read`).
 */
export const HOST_BETA_DESTINATIONS: readonly ShellDestination[] = [
  { key: 'notes', label: 'Notes', compactLabel: 'Notes', Icon: NotesIcon, path: '/beta/notes', permission: 'beta_notes:read' },
  { key: 'secrets', label: 'Secrets', compactLabel: 'Secrets', Icon: KeyIcon, path: '/secrets', permission: 'secrets:read' },
  { key: 'cards', label: 'Cards', compactLabel: 'Cards', Icon: CardIcon, path: '/cards', permission: 'secrets:read' },
  { key: 'settings', label: 'Settings', compactLabel: 'Settings', Icon: SettingsIcon, path: '/settings/profile' },
];

/** The host's own page. */
function BetaNotesPage(): ReactElement {
  return (
    <Typography variant="h5" component="h1">
      {identity.productName} notes
    </Typography>
  );
}

function HostBetaNavigation(): ReactElement {
  const { hasPermission } = usePermissions();
  return (
    <AppBar position="static" color="primary">
      <Toolbar component="nav" aria-label={`${identity.productName} navigation`}>
        <Typography variant="h6" component="span" sx={{ mr: 2 }}>
          {identity.productName}
        </Typography>
        {HOST_BETA_DESTINATIONS.filter((d) => isDestinationVisible(d, hasPermission)).map((d) => (
          <Button key={d.key} color="inherit" component={RouterLink} to={d.path}>
            {d.label}
          </Button>
        ))}
      </Toolbar>
    </AppBar>
  );
}

/** The routes: the host's page and the Vault slices on the paths they own. */
export function HostBetaRoutes(): ReactElement {
  return (
    <>
      <HostBetaNavigation />
      <Box component="main" sx={{ p: 2 }}>
        <Routes>
          <Route path="/beta/notes" element={<BetaNotesPage />} />
          <Route path="/secrets" element={<SecretsPage />} />
          <Route path="/secrets/new" element={<CreateSecretPage />} />
          <Route path="/secrets/:id" element={<SecretDetailPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/settings/agent-access" element={<AgentAccessSettingsPage />} />
          <Route path="/settings/profile" element={<ProfileSettingsPage />} />
        </Routes>
      </Box>
    </>
  );
}

function HostPlatform({ children }: { children: ReactNode }): ReactElement {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const host = useMemo<PlatformWebHost>(
    () => ({
      api: createPlatformApiClient(getVaultHttp()),
      viewer: { userId: user?.id ?? null, email: user?.email ?? null, hasPermission, isFeatureEnabled: () => false, refresh: refreshUser },
    }),
    [user?.id, user?.email, hasPermission, refreshUser],
  );
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

/**
 * The providers around the routes: the host's themes, the identity context (a real host mounts the
 * platform's `AuthProvider`; the smoke test passes a fixed session) and the platform host.
 */
export function HostBetaProviders({ auth, children }: { auth: AuthContextValue; children: ReactNode }): ReactElement {
  return (
    <ShellRoot themes={HOST_BETA_THEMES} storageKey="hostbeta-theme">
      <AuthContext.Provider value={auth}>
        <HostPlatform>{children}</HostPlatform>
      </AuthContext.Provider>
    </ShellRoot>
  );
}
