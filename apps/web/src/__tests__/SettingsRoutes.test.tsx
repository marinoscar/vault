/**
 * The settings routes through the real App (E10.3, #94): old URLs redirect to
 * their cards, a card route refuses a viewer without the card's permission,
 * and the packaged Doctor, About, Maintenance, Email, Web Push, Broadcasts,
 * Notifications and AI pages reach the API through Vault's client (platform/platformHost.tsx),
 * bearer token included.
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
  it('redirects /admin/users to the Users & Allowlist card', async () => {
    signInAs(ADMIN_PERMISSIONS);
    renderAt('/admin/users');

    expect(await screen.findByRole('heading', { level: 1, name: 'Users & Allowlist' }, SLOW)).toBeInTheDocument();
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

  // E7.2: the platform email and notifications pages, each behind its card's permission.
  it.each([
    ['/admin/settings/email', '/api/email-settings', ['system_settings:read']],
    ['/admin/settings/push', '/api/admin/push-config', ['push:read']],
    ['/admin/settings/broadcasts', '/api/admin/broadcasts', ['broadcasts:read']],
    ['/settings/notifications', '/api/notifications/events', ['user_settings:read']],
    // E8.2: the packaged AI page (the AI card; reachable while AI is off).
    ['/admin/settings/ai', '/api/admin/ai/config', ['ai_config:read']],
    // E6.1 web follow-up: the packaged StorageConfigPage (the Storage card).
    ['/admin/settings/storage', '/api/admin/storage-config', ['storage_config:read']],
  ])('%s renders the packaged page, which calls %s through Vault\'s client', async (route, apiPath, permissions) => {
    signInAs(permissions);
    const seen: (string | null)[] = [];
    server.use(
      http.get(`*${apiPath}`, ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ message: 'Not available in this test' }, { status: 503 });
      }),
    );
    renderAt(route);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0), SLOW);
    expect(seen[0]).toMatch(/^Bearer /);
    expect(probe).toBe(route);
  });

  it.each([
    ['/admin/settings/email', '/'],
    ['/admin/settings/push', '/'],
    ['/admin/settings/broadcasts', '/'],
    ['/admin/settings/ai', '/'],
    ['/admin/settings/ai/models', '/'],
    ['/admin/settings/ai/usage', '/'],
    ['/admin/settings/storage', '/'],
  ])('sends a viewer without the card permission from %s to %s', async (route, target) => {
    signInAs(['user_settings:read', 'user_settings:write']);
    renderAt(route);

    await waitFor(() => expect(probe).toBe(target), SLOW);
  });

  it('sends a user without user_settings:read from Notifications back to the hub', async () => {
    signInAs(['secrets:read']);
    renderAt('/settings/notifications');

    await waitFor(() => expect(probe).toBe('/settings'), SLOW);
  });

  it('sends an ai_config:read holder from AI models to / while AI is off (RequireAiEnabled)', async () => {
    signInAs(['ai_config:read']);
    renderAt('/admin/settings/ai/models');

    await waitFor(() => expect(probe).toBe('/'), SLOW);
  });

  it('renders the packaged AI models page while AI is on, calling /api/admin/ai/models with the bearer', async () => {
    signInAs(['ai_config:read']);
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/ai/config', () =>
        HttpResponse.json({ data: { enabled: true, keyPolicy: 'byok_with_org_fallback', providers: [] } }),
      ),
      http.get('*/api/admin/ai/models', ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
      }),
    );
    renderAt('/admin/settings/ai/models');

    await waitFor(() => expect(seen.length).toBeGreaterThan(0), SLOW);
    expect(seen[0]).toMatch(/^Bearer /);
    expect(probe).toBe('/admin/settings/ai/models');
  });

  it('sends a system_settings:read holder without storage_config:read away from Storage', async () => {
    signInAs(['system_settings:read']);
    renderAt('/admin/settings/storage');

    await waitFor(() => expect(probe).toBe('/'), SLOW);
  });

  it('renders the Storage page for storage_config:read, loading the configuration with the bearer', async () => {
    signInAs(['storage_config:read']);
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/admin/storage-config', ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return HttpResponse.json({ message: 'Not available in this test' }, { status: 503 });
      }),
    );
    renderAt('/admin/settings/storage');

    await waitFor(() => expect(seen.length).toBeGreaterThan(0), SLOW);
    expect(seen.every((h) => /^Bearer /.test(h ?? ''))).toBe(true);
    expect(probe).toBe('/admin/settings/storage');
  });

  it('lets a holder of storage_config:read alone into the Console hub (any-of gate)', async () => {
    signInAs(['storage_config:read']);
    renderAt('/admin/settings');

    expect(await screen.findByRole('heading', { name: 'Console' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Storage', undefined, SLOW)).toBeInTheDocument();
  });

  it('lets a holder of push:read alone into the Console hub (any-of gate)', async () => {
    signInAs(['push:read']);
    renderAt('/admin/settings');

    expect(await screen.findByRole('heading', { name: 'Console' }, SLOW)).toBeInTheDocument();
    expect(probe).toBe('/admin/settings');
  });
});
