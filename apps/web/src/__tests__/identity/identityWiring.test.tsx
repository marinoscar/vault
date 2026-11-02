/**
 * The identity slice as Vault binds it (E3.3, #78): the packaged
 * `AuthProvider`, guards and pages from `@marinoscar/platform-web/identity`,
 * Vault's brand in the LoginPage slots, the identity cards spread into the
 * settings registries, and the table-layout store that stands in for
 * `/user-settings` until E4.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import {
  identityAdminSections,
  identityUserSettingsSections,
} from '@marinoscar/platform-web/identity/ui';

import { server } from '../mocks/server';
import { render } from '../utils/test-utils';
import App from '../../App';
import LoginPage, { LOGIN_SLOTS } from '../../identity/LoginPage';
import { vaultIdentityAdapters } from '../../identity/identityAdapters';
import { vaultPlatformApi } from '../../platform/platformHost';
import {
  DATA_TABLE_PREFERENCES_STORAGE_KEY,
  dataTablePreferencesPort,
} from '../../platform/dataTablePreferences';
import { ADMIN_SECTIONS } from '../../config/adminSections';
import { USER_SETTINGS_SECTIONS } from '../../config/userSettingsSections';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@marinoscar/vault-web/brand';

const SLOW = { timeout: 5000 };

let probe = '';
function LocationProbe() {
  probe = useLocation().pathname;
  return null;
}

function renderApp(path: string) {
  return rtlRender(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function signInAs(permissions: string[]) {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({
        data: {
          id: 'user-1',
          email: 'person.a@example.test',
          displayName: 'Person A',
          profileImageUrl: null,
          roles: [{ name: 'viewer' }],
          permissions,
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    ),
  );
}

describe('the branded login page', () => {
  it('renders the packaged flow with the Vault mark, heading and tagline', () => {
    render(<LoginPage />, { wrapperOptions: { authenticated: false } });

    expect(screen.getByTestId('login-logo')).toHaveAttribute('alt', '');
    expect(screen.getByRole('heading', { level: 1, name: `Sign in to ${PRODUCT_NAME}` })).toBeInTheDocument();
    expect(screen.getByTestId('login-tagline')).toHaveTextContent(PRODUCT_TAGLINE);
    // The package still draws the provider buttons and the footer.
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByText(/terms of service/i)).toBeInTheDocument();
  });

  it('keeps its slots a module constant (the package keys on identity)', () => {
    expect(Object.isFrozen(LOGIN_SLOTS)).toBe(true);
    expect(Object.keys(LOGIN_SLOTS).sort()).toEqual(['Logo', 'Title']);
  });
});

describe('route guards', () => {
  it('sends a signed-out visitor from a protected route to /login', async () => {
    server.use(http.post('*/api/auth/refresh', () => new HttpResponse(null, { status: 401 })));
    renderApp('/settings/tokens');

    expect(await screen.findByRole('heading', { name: `Sign in to ${PRODUCT_NAME}` }, SLOW)).toBeInTheDocument();
    expect(probe).toBe('/login');
  });

  it('sends a viewer without users:read away from the Users & Allowlist card', async () => {
    signInAs(['user_settings:read']);
    renderApp('/admin/settings/users');

    await waitFor(() => expect(probe).toBe('/'), SLOW);
  });

  it('renders the packaged Access Tokens page for any signed-in user (no permission)', async () => {
    signInAs([]);
    server.use(http.get('*/api/pat', () => HttpResponse.json({ data: [] })));
    renderApp('/settings/tokens');

    expect(await screen.findByRole('heading', { level: 1, name: 'Access Tokens' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText(/no personal access tokens yet/i, {}, SLOW)).toBeInTheDocument();
  });

  it('renders the packaged device activation page at /activate, full screen', async () => {
    signInAs([]);
    renderApp('/activate');

    expect(await screen.findByRole('textbox', {}, SLOW)).toBeInTheDocument();
    // Outside the shell: no app bar.
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });

  it('renders the packaged Users & Allowlist page with both tabs for users:read + allowlist:read', async () => {
    signInAs(['users:read', 'allowlist:read']);
    server.use(
      http.get('*/api/users', () =>
        HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 } }),
      ),
      http.get('*/api/allowlist', () =>
        HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 } }),
      ),
      http.get('*/api/roles', () => HttpResponse.json({ data: [] })),
    );
    renderApp('/admin/settings/users');

    expect(await screen.findByRole('heading', { level: 1, name: 'Users & Allowlist' }, SLOW)).toBeInTheDocument();
    const tabs = await screen.findByRole('tablist', {}, SLOW);
    expect(within(tabs).getByRole('tab', { name: 'Users' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Allowlist' })).toBeInTheDocument();
  });
});

describe('the identity cards in the settings registries', () => {
  const adminCards = ADMIN_SECTIONS.flatMap((s) => s.cards);
  const userCards = USER_SETTINGS_SECTIONS.flatMap((s) => s.cards);

  it('spreads the packaged access card where Vault\'s Users card was, unchanged', () => {
    const [packaged] = identityAdminSections.access;
    expect(adminCards[1]).toBe(packaged);
    expect(packaged).toMatchObject({ path: '/admin/settings/users', permission: 'users:read' });
    expect(packaged.feature).toBeUndefined();
  });

  it('spreads the packaged Access Tokens card, ungated, where Vault\'s was', () => {
    const [packaged] = identityUserSettingsSections.security;
    expect(userCards[2]).toBe(packaged);
    expect(packaged.path).toBe('/settings/tokens');
    expect(packaged.permission).toBeUndefined();
  });

  it('does not spread the organization cards (Vault is single-organization)', () => {
    const paths = adminCards.map((c) => c.path);
    for (const card of identityAdminSections.organizations) expect(paths).not.toContain(card.path);
  });
});

describe('adapters and host', () => {
  it('hands the identity pages Vault\'s name, spinner, table and client', () => {
    expect(vaultIdentityAdapters.appName).toBe(PRODUCT_NAME);
    expect(vaultIdentityAdapters.Spinner).toBeDefined();
    expect(vaultIdentityAdapters.DataTable).toBeDefined();
    expect(vaultIdentityAdapters.api).toBeDefined();
  });

  it('sends packaged calls through Vault\'s client with the bearer token', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/pat', ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ data: [] });
      }),
    );
    const { api } = await import('../../services/api');
    api.setAccessToken('token-a');
    try {
      await vaultIdentityAdapters.api!.getPersonalAccessTokens();
      await vaultPlatformApi.get('/pat');
    } finally {
      api.setAccessToken(null);
    }
    expect(seen).toEqual(['Bearer token-a', 'Bearer token-a']);
  });
});

describe('table layout store (until /user-settings carries dataTables, E4)', () => {
  afterEach(() => window.localStorage.removeItem(DATA_TABLE_PREFERENCES_STORAGE_KEY));

  it('round-trips a layout per table and forgets it on null', async () => {
    await dataTablePreferencesPort.save('admin-users', { density: 'compact' } as never);
    await dataTablePreferencesPort.save('allowlist', { density: 'standard' } as never);
    expect(await dataTablePreferencesPort.load()).toEqual({
      'admin-users': { density: 'compact' },
      allowlist: { density: 'standard' },
    });

    await dataTablePreferencesPort.save('admin-users', null);
    expect(await dataTablePreferencesPort.load()).toEqual({ allowlist: { density: 'standard' } });
  });

  it('reads a corrupt or non-object store as empty', async () => {
    window.localStorage.setItem(DATA_TABLE_PREFERENCES_STORAGE_KEY, '{not json');
    expect(await dataTablePreferencesPort.load()).toEqual({});
    window.localStorage.setItem(DATA_TABLE_PREFERENCES_STORAGE_KEY, '[1,2]');
    expect(await dataTablePreferencesPort.load()).toEqual({});
  });
});
