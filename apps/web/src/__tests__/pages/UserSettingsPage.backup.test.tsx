import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockUser } from '../utils/test-utils';
import UserSettingsPage from '../../pages/UserSettingsPage';

vi.mock('../../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn(),
}));
vi.mock('../../hooks/usePersonalAccessTokens', () => ({
  usePersonalAccessTokens: vi.fn(() => ({
    tokens: [],
    isLoading: false,
    error: null,
    createToken: vi.fn(),
    revokeToken: vi.fn(),
    refresh: vi.fn(),
  })),
}));

import { useUserSettings } from '../../hooks/useUserSettings';

describe('UserSettingsPage - Back up my data card', () => {
  beforeEach(() => {
    vi.mocked(useUserSettings).mockReturnValue({
      settings: {
        theme: 'system',
        profile: { displayName: undefined, useProviderImage: true, customImageUrl: undefined },
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      isLoading: false,
      error: null,
      isSaving: false,
      updateSettings: vi.fn(),
      updateTheme: vi.fn().mockResolvedValue(undefined),
      updateProfile: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
    });
  });

  it('shows the card to a user with secrets:read', () => {
    render(<UserSettingsPage />, {
      wrapperOptions: {
        user: { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] },
      },
    });

    expect(screen.getByText('Back up my data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download backup/i })).toBeInTheDocument();
  });

  it('hides the card from a user without secrets:read', () => {
    render(<UserSettingsPage />, { wrapperOptions: { user: mockUser } });

    expect(screen.queryByText('Back up my data')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download backup/i })).not.toBeInTheDocument();
  });

  it('does not treat secrets:read_any alone as secrets:read', () => {
    render(<UserSettingsPage />, {
      wrapperOptions: {
        user: { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read_any'] },
      },
    });

    expect(screen.queryByText('Back up my data')).not.toBeInTheDocument();
  });
});
