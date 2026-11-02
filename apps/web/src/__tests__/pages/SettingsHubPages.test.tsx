/**
 * The two settings hubs (E10.3, #94): bindings of the packaged SettingsHub.
 * Each card shows only to a viewer holding its permission; a click navigates
 * to the card's own route.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

import { render, mockAdminUser, mockUser } from '../utils/test-utils';
import type { MockUser } from '../utils/test-utils';
import { restoreViewport, setViewportWidth } from '../utils/viewport';
import UserSettingsHubPage from '../../pages/UserSettingsHubPage';
import AdminSettingsHubPage from '../../pages/admin/AdminSettingsHubPage';

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderHub(hub: 'user' | 'admin', user: MockUser) {
  const path = hub === 'user' ? '/settings' : '/admin/settings';
  const Hub = hub === 'user' ? UserSettingsHubPage : AdminSettingsHubPage;
  return render(
    <Routes>
      <Route path={path} element={<Hub />} />
      <Route path="*" element={<Location />} />
    </Routes>,
    { wrapperOptions: { route: path, user } },
  );
}

/** The card titles the hub's desktop grid draws, in order (each card's title is an h6). */
function cardTitles(): string[] {
  return screen.queryAllByRole('heading', { level: 6 }).map((heading) => heading.textContent ?? '');
}

const withPerms = (base: MockUser, extra: string[]): MockUser => ({
  ...base,
  permissions: [...base.permissions, ...extra],
});

afterEach(() => restoreViewport());

describe('/settings (per-user hub)', () => {
  it('shows every card to a user holding the card permissions', () => {
    setViewportWidth(1440);
    renderHub('user', withPerms(mockUser, ['secrets:read', 'secret_types:read']));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(cardTitles()).toEqual(['Profile', 'Appearance', 'Access tokens', 'My backups', 'Secret types']);
  });

  it('hides My backups without secrets:read and Secret types without secret_types:read', () => {
    setViewportWidth(1440);
    renderHub('user', mockUser);

    expect(cardTitles()).toEqual(['Profile', 'Appearance', 'Access tokens']);
  });

  it('always shows Access tokens (ownership-scoped, no permission)', () => {
    setViewportWidth(1440);
    renderHub('user', { ...mockUser, permissions: [] });

    expect(cardTitles()).toEqual(['Access tokens']);
  });

  it('navigates to the card route', async () => {
    setViewportWidth(1440);
    const user = userEvent.setup();
    renderHub('user', withPerms(mockUser, ['secrets:read']));

    await user.click(screen.getByRole('heading', { level: 6, name: 'My backups' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/backups');
  });

  it('renders the drill-down list on a phone and drills into a card', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    renderHub('user', mockUser);

    // The list replaces the grid (chosen by mounting, never both).
    expect(cardTitles()).toEqual([]);
    await user.click(screen.getByText('Appearance'));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/appearance');
  });
});

describe('/admin/settings (Console hub)', () => {
  it('shows every admin card to an admin, grouped', () => {
    setViewportWidth(1440);
    renderHub('admin', mockAdminUser);

    expect(screen.getByRole('heading', { name: 'Console' })).toBeInTheDocument();
    expect(cardTitles()).toEqual(['General', 'Users & allowlist', 'AI', 'Backups', 'Maintenance', 'Doctor', 'About']);
    expect(screen.getByText('Administration')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('shows only Users & allowlist to a users:read-only operator (Operations group dropped)', () => {
    setViewportWidth(1440);
    renderHub('admin', { ...mockUser, permissions: ['users:read'] });

    expect(cardTitles()).toEqual(['Users & allowlist']);
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
  });

  it('shows every system_settings:read card, but not Users, without users:read', () => {
    setViewportWidth(1440);
    renderHub('admin', { ...mockUser, permissions: ['system_settings:read'] });

    expect(cardTitles()).toEqual(['General', 'AI', 'Backups', 'Maintenance', 'Doctor', 'About']);
  });

  it('navigates to the Backups card route', async () => {
    setViewportWidth(1440);
    const user = userEvent.setup();
    renderHub('admin', mockAdminUser);

    await user.click(screen.getByRole('heading', { level: 6, name: 'Backups' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/settings/backups');
  });
});
