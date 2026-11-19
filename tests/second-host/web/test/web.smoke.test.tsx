// =============================================================================
// Host Beta's web smoke test (issue #194)
// =============================================================================
//
// The built @marinoscar/vault-web slices under Host Beta's brand, navigation and product name: the
// secrets list renders the API's rows, the secret editor renders its form, and the profile card
// names the HOST, not Vault. The API is MSW; the API side is proven by api/test/api.smoke.spec.ts.
// =============================================================================

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { installLayoutStubs, setInitialContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import type { AuthContextValue } from '@marinoscar/platform-web/identity/headless';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { HOST_BETA_DESTINATIONS, HostBetaProviders, HostBetaRoutes } from '../src/HostBetaApp';
import { API, server } from './setup';

const TYPES = SYSTEM_SECRET_TYPES.map((type, i) => ({
  ...type,
  id: `00000000-0000-4000-8000-00000000000${i}`,
  description: type.description,
  isSystem: true,
  createdAt: '2030-01-01T00:00:00Z',
}));
const CREDENTIAL = TYPES.find((t) => t.name === 'Credential')!;

const ROWS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Shop login', description: null, type: CREDENTIAL, currentVersion: 3, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-02T00:00:00Z', agentAccess: 'fill', agentAccessChangedAt: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Org Beta wiki', description: null, type: CREDENTIAL, currentVersion: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', agentAccess: 'none', agentAccessChangedAt: null },
];

const USER = {
  id: 'person-a', email: 'person-a@host.example.test', displayName: 'Person A', profileImageUrl: null,
  roles: [{ name: 'beta_editor' }],
  permissions: ['beta_notes:read', 'secrets:read', 'secrets:write', 'secrets:delete', 'user_settings:read', 'user_settings:write'],
  isActive: true, createdAt: '2030-01-01T00:00:00Z',
};

const AUTH = {
  user: USER, isLoading: false, isAuthenticated: true, providers: [], sessionExpired: false,
  login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn(), setAccessToken: vi.fn(),
  activeOrg: null, memberships: [], switchOrg: vi.fn(), mode: 'server',
} as unknown as AuthContextValue;

function api() {
  server.use(
    http.get(`${API}/secret-types`, () => HttpResponse.json({ data: TYPES })),
    http.get(`${API}/secrets`, () =>
      HttpResponse.json({ data: { items: ROWS, meta: { page: 1, pageSize: 20, totalItems: ROWS.length, totalPages: 1 } } }),
    ),
    http.get(`${API}/user-settings`, () =>
      HttpResponse.json({ data: { theme: 'system', profile: { displayName: null, useProviderImage: true, customImageUrl: null }, updatedAt: '2030-01-01T00:00:00Z', version: 1 } }),
    ),
    http.get(`${API}/system-settings`, () => HttpResponse.json({ data: { ui: { allowUserThemeOverride: true }, features: {}, version: 1 } })),
    http.get(`${API}/agent-activity`, () => HttpResponse.json({ data: [], meta: { page: 1, pageSize: 25, total: 0 } })),
    http.get(`${API}/ai/config`, () => HttpResponse.json({ data: { enabled: false, providers: [], keyPolicy: 'byok_with_org_fallback' } })),
  );
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HostBetaProviders auth={AUTH}>
        <HostBetaRoutes />
      </HostBetaProviders>
    </MemoryRouter>,
  );
}

describe('Host Beta, web', () => {
  beforeAll(() => installLayoutStubs());

  it('draws ITS navigation, gated by the permissions the API enforces', async () => {
    api();
    renderAt('/beta/notes');
    const nav = screen.getByRole('navigation', { name: 'Host Beta navigation' });
    expect(within(nav).getByText('Host Beta')).toBeInTheDocument();
    for (const destination of HOST_BETA_DESTINATIONS) {
      expect(within(nav).getByRole('link', { name: destination.label })).toHaveAttribute('href', destination.path);
    }
    expect(screen.getByRole('heading', { name: 'Host Beta notes' })).toBeInTheDocument();
  });

  it('renders the Vault secrets list from the API', async () => {
    api();
    setInitialContainerWidth(1400);
    renderAt('/secrets');
    expect(await screen.findByText('Shop login')).toBeInTheDocument();
    expect(screen.getByText('Org Beta wiki')).toBeInTheDocument();
  });

  it('renders the Vault secret editor', async () => {
    api();
    renderAt('/secrets/new');
    expect(await screen.findByRole('textbox', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create|save/i })).toBeInTheDocument();
  });

  it('renders the Vault agent activity page (the agent slice)', async () => {
    api();
    renderAt('/settings/agent-activity');
    expect(await screen.findByText("No agent activity yet. Agents only see logins you allow on the secret's page.")).toBeInTheDocument();
  });

  it('names the host, not Vault, in the slices’ copy', async () => {
    api();
    renderAt('/settings/profile');
    expect(await screen.findByText('How you appear in Host Beta')).toBeInTheDocument();
    expect(screen.queryByText(/How you appear in Vault/)).not.toBeInTheDocument();
  });
});
