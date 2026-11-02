/**
 * The per-user card pages that replaced the stacked UserSettingsPage (E10.3,
 * #94): Profile, Appearance, Access tokens and My backups. The behaviour each
 * section had on the stacked page moves here with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../../utils/test-utils';
import ProfileSettingsPage from '../../../pages/settings/ProfileSettingsPage';
import AppearanceSettingsPage from '../../../pages/settings/AppearanceSettingsPage';
import AccessTokensPage from '../../../pages/settings/AccessTokensPage';
import MyBackupsPage from '../../../pages/settings/MyBackupsPage';
import type { UserSettings } from '../../../types';

vi.mock('../../../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn(),
}));

vi.mock('../../../hooks/usePersonalAccessTokens', () => ({
  usePersonalAccessTokens: vi.fn(() => ({
    tokens: [],
    isLoading: false,
    error: null,
    fetchTokens: vi.fn(),
    createToken: vi.fn(),
    revokeToken: vi.fn(),
    refresh: vi.fn(),
  })),
}));

import { useUserSettings } from '../../../hooks/useUserSettings';

const mockUseUserSettings = vi.mocked(useUserSettings);

function settingsOf(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    theme: 'system',
    profile: { displayName: undefined, useProviderImage: true, customImageUrl: undefined },
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  } as UserSettings;
}

function mockHook(overrides: Partial<ReturnType<typeof useUserSettings>> = {}) {
  const value = {
    settings: settingsOf(),
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings: vi.fn(),
    updateTheme: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    ...overrides,
  };
  mockUseUserSettings.mockReturnValue(value);
  return value;
}

describe('Profile and Appearance card pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHook();
  });

  describe.each([
    ['Profile', ProfileSettingsPage],
    ['Appearance', AppearanceSettingsPage],
  ])('%s', (title, Page) => {
    it('shows a spinner while the settings load', () => {
      mockHook({ settings: null, isLoading: true });
      render(<Page />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('shows the load error', () => {
      mockHook({ settings: null, error: 'Failed to load settings' });
      render(<Page />);

      expect(screen.getByText(/failed to load settings/i)).toBeInTheDocument();
    });

    it('titles the page with the card title', () => {
      render(<Page />);

      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    });
  });

  describe('Appearance', () => {
    it('saves a theme change and confirms it', async () => {
      const { updateTheme } = mockHook({ settings: settingsOf({ theme: 'light' }) });
      const user = userEvent.setup();
      render(<AppearanceSettingsPage />);

      await user.click(screen.getByRole('button', { name: 'dark mode' }));

      expect(updateTheme).toHaveBeenCalledWith('dark');
      expect(await screen.findByText('Theme updated')).toBeInTheDocument();
    });

    it('shows the error when the theme update fails', async () => {
      mockHook({ updateTheme: vi.fn().mockRejectedValue(new Error('Update failed')) });
      const user = userEvent.setup();
      render(<AppearanceSettingsPage />);

      await user.click(screen.getByRole('button', { name: 'light mode' }));

      expect(await screen.findByText('Update failed')).toBeInTheDocument();
    });

    it('marks the stored theme as selected', () => {
      mockHook({ settings: settingsOf({ theme: 'dark' }) });
      render(<AppearanceSettingsPage />);

      expect(screen.getByRole('button', { name: 'dark mode' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('disables the toggle while saving', () => {
      mockHook({ isSaving: true });
      render(<AppearanceSettingsPage />);

      expect(screen.getByRole('button', { name: 'system preference' })).toBeDisabled();
    });

    it('holds only the theme (Profile is its own card)', () => {
      render(<AppearanceSettingsPage />);

      expect(screen.queryByLabelText('Display Name')).not.toBeInTheDocument();
    });
  });

  describe('Profile', () => {
    it('saves the display name and confirms it', async () => {
      const { updateProfile } = mockHook();
      const user = userEvent.setup();
      render(<ProfileSettingsPage />);

      await user.type(screen.getByLabelText('Display Name'), 'Person A');
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Person A' }));
      expect(await screen.findByText('Profile updated')).toBeInTheDocument();
    });

    it('passes the stored profile to the form', () => {
      mockHook({
        settings: settingsOf({
          profile: { displayName: 'Custom Name', useProviderImage: false, customImageUrl: undefined },
        }),
      });
      render(<ProfileSettingsPage />);

      expect(screen.getByLabelText('Display Name')).toHaveValue('Custom Name');
    });

    it('holds only the profile (Appearance is its own card)', () => {
      render(<ProfileSettingsPage />);

      expect(screen.queryByRole('button', { name: 'dark mode' })).not.toBeInTheDocument();
    });
  });
});

describe('Access tokens card page', () => {
  it('renders the personal access tokens section', () => {
    render(<AccessTokensPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Access tokens' })).toBeInTheDocument();
    expect(screen.getByText('Personal Access Tokens')).toBeInTheDocument();
  });
});

describe('My backups card page (was the Back up my data card)', () => {
  it('shows the backup section to a user with secrets:read', async () => {
    render(<MyBackupsPage />, {
      wrapperOptions: { user: { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] } },
    });

    expect(screen.getByRole('heading', { level: 1, name: 'My backups' })).toBeInTheDocument();
    expect(screen.getByText('Back up my data')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /download backup/i })).toBeInTheDocument());
  });

  it('hides it from a user without secrets:read', () => {
    render(<MyBackupsPage />, { wrapperOptions: { user: mockUser } });

    expect(screen.queryByText('Back up my data')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download backup/i })).not.toBeInTheDocument();
  });

  it('does not treat secrets:read_any alone as secrets:read', () => {
    render(<MyBackupsPage />, {
      wrapperOptions: { user: { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read_any'] } },
    });

    expect(screen.queryByText('Back up my data')).not.toBeInTheDocument();
  });
});
