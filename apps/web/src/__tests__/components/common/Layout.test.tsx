import { afterEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../../mocks/server';

import { Layout } from '../../../components/common/Layout';
import { mockAdminUser, mockUser, render, screen } from '../../utils/test-utils';
import type { MockUser } from '../../utils/test-utils';
import { restoreViewport, setViewportWidth } from '../../utils/viewport';

/** A Vault user who can read secrets and media (every library destination). */
const libraryUser: MockUser = {
  ...mockUser,
  permissions: [...mockUser.permissions, 'secrets:read', 'media:read'],
};

const adminUser: MockUser = {
  ...mockAdminUser,
  permissions: [...mockAdminUser.permissions, 'secrets:read', 'media:read'],
};

function renderShell(route: string, user: MockUser = libraryUser) {
  return render(
    <Routes>
      <Route element={<Layout />}>
        <Route path="*" element={<p>Page body</p>} />
      </Route>
    </Routes>,
    { wrapperOptions: { route, user } },
  );
}

afterEach(() => {
  restoreViewport();
  window.localStorage.clear();
});

describe('Layout (platform shell binding)', () => {
  describe('desktop (1440px)', () => {
    it('renders the app bar with the Vault lockup, the rail and the page', () => {
      setViewportWidth(1440);
      renderShell('/');

      const banner = screen.getByRole('banner');
      expect(within(banner).getByText('Vault')).toBeInTheDocument();
      expect(banner.querySelector('img')).toHaveAttribute('src', expect.stringContaining('vault-mark'));
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveTextContent('Page body');
      // Exactly one navigation surface: no bottom bar at desktop width.
      expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
    });

    it('lists the four library destinations then pinned Settings, and hides Console from a non-admin', () => {
      setViewportWidth(1440);
      renderShell('/');

      const rail = screen.getByRole('navigation', { name: 'Main navigation' });
      const names = within(rail)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label'));
      expect(names).toEqual(['Home', 'Secrets', 'Cards', 'Media', 'Settings']);
    });

    it('shows the pinned Console to a user with system_settings:read', () => {
      setViewportWidth(1440);
      renderShell('/', adminUser);

      const rail = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(within(rail).getByRole('link', { name: 'Console' })).toHaveAttribute('href', '/admin/settings');
    });

    it('hides a destination the viewer lacks the permission for', () => {
      setViewportWidth(1440);
      renderShell('/', { ...mockUser, permissions: ['media:read'] });

      const rail = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(within(rail).queryByRole('link', { name: 'Secrets' })).not.toBeInTheDocument();
      expect(within(rail).queryByRole('link', { name: 'Cards' })).not.toBeInTheDocument();
      expect(within(rail).getByRole('link', { name: 'Media' })).toBeInTheDocument();
    });

    it('marks the owning destination of a nested route as the current page', () => {
      setViewportWidth(1440);
      renderShell('/secrets/abc/edit');

      const rail = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(within(rail).getByRole('link', { name: 'Secrets' })).toHaveAttribute('aria-current', 'page');
      expect(within(rail).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('lights up Settings on the secret types pages (under their card, and the old redirect path)', () => {
      setViewportWidth(1440);
      renderShell('/settings/secret-types/new');

      expect(
        within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Settings' }),
      ).toHaveAttribute('aria-current', 'page');
    });

    it('lights up Settings on the old /secret-types path too', () => {
      setViewportWidth(1440);
      renderShell('/secret-types/new');

      const rail = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(within(rail).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    });

    it('switches the rail to Console mode under /admin and lists every admin card in registry order', () => {
      setViewportWidth(1440);
      renderShell('/admin/settings/users', adminUser);

      const rail = screen.getByRole('navigation', { name: 'Console navigation' });
      expect(within(rail).getByRole('link', { name: 'Back to Vault' })).toHaveAttribute('href', '/');
      expect(within(rail).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/admin/settings/general');
      expect(within(rail).getByRole('link', { name: 'Users & Allowlist' })).toHaveAttribute('aria-current', 'page');
      for (const name of ['AI', 'Backups', 'Maintenance', 'Doctor', 'About']) {
        expect(within(rail).getByRole('link', { name })).toBeInTheDocument();
      }
    });

    it('collapses the rail and keeps the choice in the navigation user setting', async () => {
      const patches: unknown[] = [];
      server.use(
        http.get('*/api/user-settings', () =>
          HttpResponse.json({ data: { theme: 'system', profile: {}, version: 3 } }),
        ),
        http.patch('*/api/user-settings', async ({ request }) => {
          patches.push(await request.json());
          return HttpResponse.json({ data: { theme: 'system', profile: {}, navigation: { railCollapsed: true }, version: 4 } });
        }),
      );
      setViewportWidth(1440);
      renderShell('/');

      // The toggle is a no-op until the stored settings (their version) load,
      // so keep clicking until it takes; once collapsed the button is renamed.
      await waitFor(() => {
        const collapse = screen.queryByRole('button', { name: 'Collapse navigation' });
        if (collapse) fireEvent.click(collapse);
        expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
      });
      await waitFor(() => expect(patches).toEqual([{ navigation: { railCollapsed: true } }]));
      expect(window.localStorage.getItem('vault.shell.preferences')).toBeNull();
    });

    it('opens the user menu with Settings, Console and Sign out', async () => {
      setViewportWidth(1440);
      const user = userEvent.setup();
      renderShell('/', adminUser);

      // The packaged avatar button has no accessible name when it shows initials
      // (platform gap, reported as a seam request); find it by its popup.
      const avatar = screen.getByRole('banner').querySelector('button[aria-haspopup="true"]') as HTMLElement;
      await user.click(avatar);
      const menu = screen.getByRole('menu');
      expect(within(menu).getByText('admin@example.com')).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Console' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
      // Home is the brand's job, not a menu row.
      expect(within(menu).queryByRole('menuitem', { name: 'Home' })).not.toBeInTheDocument();
    });

    it('toggles the theme from the app bar', async () => {
      setViewportWidth(1440);
      const user = userEvent.setup();
      renderShell('/');

      await user.click(screen.getByRole('button', { name: 'toggle theme' }));
      expect(window.localStorage.getItem('theme_mode')).toBe('dark');
    });
  });

  describe('phone (390px)', () => {
    it('draws the bottom bar with exactly the four library tabs and no rail', () => {
      setViewportWidth(390);
      renderShell('/cards', adminUser);

      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
      const tabs = screen.getAllByRole('button').filter((b) => b.className.includes('MuiBottomNavigationAction'));
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Home', 'Secrets', 'Cards', 'Media']);
      expect(tabs[2]).toHaveClass('Mui-selected');
      // Settings and Console are modes: never on the bar, even for an admin.
      expect(tabs.map((tab) => tab.textContent)).not.toContain('Console');
    });

    it('drills into a Console card page with a back arrow and the card title', () => {
      setViewportWidth(390);
      renderShell('/admin/settings/backups', adminUser);

      const banner = screen.getByRole('banner');
      expect(within(banner).getByRole('button', { name: 'Back' })).toBeInTheDocument();
      expect(within(banner).getByText('Backups')).toBeInTheDocument();
    });

    it('drills into a per-user card page with a back arrow and the card title', () => {
      setViewportWidth(390);
      renderShell('/settings/appearance');

      const banner = screen.getByRole('banner');
      expect(within(banner).getByRole('button', { name: 'Back' })).toBeInTheDocument();
      expect(within(banner).getByText('Appearance')).toBeInTheDocument();
    });
  });
});
