/**
 * The OAuth server's web side as Vault mounts it (E14.2, #174): the public
 * error page, the signed-in consent page, the Connected apps card behind the
 * `oauthServer` feature, and the OAuth clients card behind `oauth_clients:read`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { OAuthServerStatusProvider, createOAuthServerApi } from '@marinoscar/platform-web/identity/headless';

import { server } from '../mocks/server';
import { render, mockUser } from '../utils/test-utils';
import { restoreViewport, setViewportWidth } from '../utils/viewport';
import App from '../../App';
import UserSettingsHubPage from '../../pages/UserSettingsHubPage';
import { vaultPlatformApi } from '../../platform/platformHost';
import { PRODUCT_NAME } from '@marinoscar/vault-web/brand';

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

afterEach(() => restoreViewport());

describe('/oauth/error', () => {
  it('renders for a signed-out visitor, without redirecting to /login', async () => {
    server.use(http.post('*/api/auth/refresh', () => new HttpResponse(null, { status: 401 })));
    renderApp('/oauth/error?code=server_disabled');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connecting apps is switched off' }, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Go to ${PRODUCT_NAME}` })).toBeInTheDocument();
    expect(probe).toBe('/oauth/error');
  });
});

describe('/oauth/consent', () => {
  it('sends a signed-out visitor to /login', async () => {
    server.use(http.post('*/api/auth/refresh', () => new HttpResponse(null, { status: 401 })));
    renderApp('/oauth/consent?request=req-1');

    expect(await screen.findByRole('heading', { name: `Sign in to ${PRODUCT_NAME}` }, SLOW)).toBeInTheDocument();
    expect(probe).toBe('/login');
  });

  it('renders full screen (no app bar) for a signed-in user', async () => {
    signInAs([]);
    server.use(
      http.get('*/api/oauth/requests/*', () => HttpResponse.json({ data: {} }, { status: 404 })),
    );
    renderApp('/oauth/consent?request=req-1');

    await waitFor(() => expect(probe).toBe('/oauth/consent'), SLOW);
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });
});

describe('the Connected apps card', () => {
  function renderUserHub(serverOn: boolean) {
    server.use(
      http.get('*/api/oauth/.well-known/authorization-server', () =>
        serverOn
          ? HttpResponse.json({ issuer: 'https://vault.example.test' })
          : new HttpResponse(null, { status: 404 }),
      ),
    );
    setViewportWidth(1440);
    return render(
      <OAuthServerStatusProvider api={createOAuthServerApi(vaultPlatformApi)}>
        <Routes>
          <Route path="/settings" element={<UserSettingsHubPage />} />
        </Routes>
      </OAuthServerStatusProvider>,
      { wrapperOptions: { route: '/settings', user: mockUser } },
    );
  }

  const titles = () => screen.queryAllByRole('heading', { level: 6 }).map((h) => h.textContent);

  it('is hidden while the OAuth server is off', async () => {
    renderUserHub(false);
    await screen.findByText('Access Tokens');
    await new Promise((r) => setTimeout(r, 100));
    expect(titles()).not.toContain('Connected apps');
  });

  it('shows once the OAuth server is on', async () => {
    renderUserHub(true);
    expect(await screen.findByRole('heading', { level: 6, name: 'Connected apps' }, SLOW)).toBeInTheDocument();
  });
});

describe('the OAuth clients card route', () => {
  it('sends a viewer without oauth_clients:read home', async () => {
    signInAs(['system_settings:read']);
    renderApp('/admin/settings/oauth-clients');

    await waitFor(() => expect(probe).toBe('/'), SLOW);
  });

  it('renders the packaged page for oauth_clients:read', async () => {
    signInAs(['oauth_clients:read']);
    server.use(
      http.get('*/api/admin/oauth/clients*', () =>
        HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 } }),
      ),
    );
    renderApp('/admin/settings/oauth-clients');

    await waitFor(() => expect(probe).toBe('/admin/settings/oauth-clients'), SLOW);
    expect(await screen.findByRole('heading', { level: 1, name: /oauth clients/i }, SLOW)).toBeInTheDocument();
  });
});
