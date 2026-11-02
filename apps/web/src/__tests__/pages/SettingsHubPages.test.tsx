/**
 * The two settings hubs (E10.3, #94): bindings of the packaged SettingsHub.
 * Each card shows only to a viewer holding its permission; a click navigates
 * to the card's own route.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AiConfigContext } from '@marinoscar/platform-web/ai/headless';
import type { UseAiConfigReturn } from '@marinoscar/platform-web/ai/headless';

import { render, mockAdminUser, mockUser } from '../utils/test-utils';
import type { MockUser } from '../utils/test-utils';
import { restoreViewport, setViewportWidth } from '../utils/viewport';
import UserSettingsHubPage from '../../pages/UserSettingsHubPage';
import AdminSettingsHubPage from '../../pages/admin/AdminSettingsHubPage';

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

/** The shared AI config with AI switched on (what `VaultAiConfigProvider` answers). */
const AI_ON: UseAiConfigReturn = {
  config: { enabled: true, keyPolicy: 'byok_with_org_fallback', providers: [] },
  isLoading: false,
  error: null,
  refresh: async () => {},
};

function renderHub(hub: 'user' | 'admin', user: MockUser, { aiOn = false } = {}) {
  const path = hub === 'user' ? '/settings' : '/admin/settings';
  const Hub = hub === 'user' ? UserSettingsHubPage : AdminSettingsHubPage;
  const withAi = (node: ReactElement): ReactElement =>
    aiOn ? <AiConfigContext.Provider value={AI_ON}>{node}</AiConfigContext.Provider> : node;
  return render(
    withAi(
      <Routes>
        <Route path={path} element={<Hub />} />
        <Route path="*" element={<Location />} />
      </Routes>,
    ),
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
    expect(cardTitles()).toEqual([
      'Profile',
      'Appearance',
      'Access Tokens',
      'My backups',
      'Secret types',
      'Notifications',
    ]);
  });

  it('hides My backups without secrets:read and Secret types without secret_types:read', () => {
    setViewportWidth(1440);
    renderHub('user', mockUser);

    expect(cardTitles()).toEqual(['Profile', 'Appearance', 'Access Tokens', 'Notifications']);
  });

  it('always shows Access Tokens (ownership-scoped, no permission)', () => {
    setViewportWidth(1440);
    renderHub('user', { ...mockUser, permissions: [] });

    expect(cardTitles()).toEqual(['Access Tokens']);
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
    renderHub('admin', withPerms(mockAdminUser, ['push:read', 'broadcasts:read', 'db_backup:read']));

    expect(screen.getByRole('heading', { name: 'Console' })).toBeInTheDocument();
    expect(cardTitles()).toEqual([
      'General',
      'Users & Allowlist',
      'AI',
      'Backups',
      'Maintenance',
      'Doctor',
      'About',
      'Database Backup',
      'Email',
      'Web Push',
      'Broadcasts',
    ]);
    expect(screen.getByText('Administration')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('Messaging')).toBeInTheDocument();
  });

  it('hides Web Push without push:read and Broadcasts without broadcasts:read', () => {
    setViewportWidth(1440);
    renderHub('admin', withPerms(mockAdminUser, ['push:read']));

    expect(cardTitles()).toContain('Web Push');
    expect(cardTitles()).not.toContain('Broadcasts');
  });

  it('shows only Users & Allowlist to a users:read-only operator (Operations group dropped)', () => {
    setViewportWidth(1440);
    renderHub('admin', { ...mockUser, permissions: ['users:read'] });

    expect(cardTitles()).toEqual(['Users & Allowlist']);
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
  });

  it('shows every system_settings:read card, but not Users, without users:read', () => {
    setViewportWidth(1440);
    renderHub('admin', { ...mockUser, permissions: ['system_settings:read'] });

    // AI needs ai_config:read since E8.2 (the platform AI admin controller).
    expect(cardTitles()).toEqual(['General', 'Backups', 'Maintenance', 'Doctor', 'About', 'Email']);
    // db_backup:read is a pair of its own (admin only): system_settings:read alone does not show Database Backup.
  });

  it('shows AI models and AI usage only while AI is on, and the AI card always (E8.2)', () => {
    setViewportWidth(1440);
    const admin = withPerms(mockAdminUser, ['push:read', 'broadcasts:read', 'db_backup:read']);
    const { unmount } = renderHub('admin', admin);
    expect(cardTitles()).toContain('AI');
    expect(cardTitles()).not.toContain('AI models');
    expect(cardTitles()).not.toContain('AI usage');
    unmount();

    renderHub('admin', admin, { aiOn: true });
    expect(cardTitles()).toEqual([
      'General',
      'Users & Allowlist',
      'AI',
      'Backups',
      'AI models',
      'AI usage',
      'Maintenance',
      'Doctor',
      'About',
      'Database Backup',
      'Email',
      'Web Push',
      'Broadcasts',
    ]);
  });

  it('shows only the AI cards to an ai_config:read-only operator', () => {
    setViewportWidth(1440);
    renderHub('admin', { ...mockUser, permissions: ['ai_config:read'] }, { aiOn: true });

    expect(cardTitles()).toEqual(['AI', 'AI models', 'AI usage']);
  });

  it('navigates to the Backups card route', async () => {
    setViewportWidth(1440);
    const user = userEvent.setup();
    renderHub('admin', mockAdminUser);

    await user.click(screen.getByRole('heading', { level: 6, name: 'Backups' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/settings/backups');
  });
});
