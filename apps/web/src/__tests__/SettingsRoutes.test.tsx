/**
 * The settings routes through the real App (E10.3, #94): old URLs redirect to
 * their cards, a card route refuses a viewer without the card's permission,
 * and the packaged Doctor, About and Maintenance pages reach the API through
 * Vault's client (PlatformHostBridge), bearer token included.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import App from '../App';

const ADMIN_PERMISSIONS = [
  'user_settings:read',
  'user_settings:write',
  'system_settings:read',
  'system_settings:write',
  'users:read',
  'secrets:read',
  'secret_types:read',
];

function signInAs(permissions: string[]) {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({
        data: {
          id: 'user-1',
          email: 'person.a@example.test',
          displayName: 'Person A',
          profileImageUrl: null,
          roles: [{ name: permissions.includes('system_settings:read') ? 'admin' : 'viewer' }],
          permissions,
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      }),
    ),
    http.get('*/api/secret-types', () => HttpResponse.json({ data: [] })),
    http.get('*/api/allowlist', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 10 } })),
  );
}

let probe = '';
function LocationProbe() {
  probe = useLocation().pathname;
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const SLOW = { timeout: 5000 };

describe('settings routes', () => {
  it('redirects /admin/users to the Users & allowlist card', async () => {
    signInAs(ADMIN_PERMISSIONS);
    renderAt('/admin/users');

    expect(await screen.findByRole('heading', { level: 1, name: 'Users & allowlist' }, SLOW)).toBeInTheDocument();
    expect(probe).toBe('/admin/settings/users');
  });

  it('redirects /secret-types to the Secret types card', async () => {
    signInAs(ADMIN_PERMISSIONS);
    renderAt('/secret-types');

    expect(await screen.findByRole('heading', { level: 1, name: 'Secret types' }, SLOW)).toBeInTheDocument();
    expect(probe).toBe('/settings/secret-types');
  });

  it('redirects /secret-types/:id/edit under the card, keeping the id', async () => {
    signInAs(ADMIN_PERMISSIONS);
    renderAt('/secret-types/type-7/edit');

    await waitFor(() => expect(probe).toBe('/settings/secret-types/type-7/edit'), SLOW);
  });

  it('sends a viewer without system_settings:read away from an admin card', async () => {
    signInAs(['user_settings:read', 'user_settings:write']);
    renderAt('/admin/settings/backups');

    await waitFor(() => expect(probe).toBe('/'), SLOW);
  });

  it('sends a user without secrets:read from My backups back to the hub', async () => {
    signInAs(['user_settings:read', 'user_settings:write']);
    renderAt('/settings/backups');

    await waitFor(() => expect(probe).toBe('/settings'), SLOW);
    expect(await screen.findByRole('heading', { name: 'Settings' }, SLOW)).toBeInTheDocument();
  });

  it.each([
    ['/admin/settings/about', '/api/admin/about', 'About'],
    ['/admin/settings/doctor', '/api/admin/doctor', 'Doctor'],
    ['/admin/settings/maintenance', '/api/admin/maintenance', 'Maintenance'],
  ])('%s renders the packaged page, which calls %s through Vault\'s client', async (route, apiPath, title) => {
    signInAs(ADMIN_PERMISSIONS);
    const seen: (string | null)[] = [];
    server.use(
      http.get(`*${apiPath}`, ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ message: 'Not available in this test' }, { status: 503 });
      }),
    );
    renderAt(route);

    expect(await screen.findByRole('heading', { level: 1, name: title }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(seen.length).toBeGreaterThan(0), SLOW);
    expect(seen[0]).toMatch(/^Bearer /);
  });
});
