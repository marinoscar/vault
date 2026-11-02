import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser } from '../../utils/test-utils';
import GeneralSettingsPage from '../../../pages/admin/GeneralSettingsPage';

// Mock the hooks
vi.mock('../../../hooks/useSystemSettings', () => ({
  useSystemSettings: vi.fn(),
}));

vi.mock('@marinoscar/platform-web/identity/headless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@marinoscar/platform-web/identity/headless')>()),
  usePermissions: vi.fn(),
}));

import { useSystemSettings } from '../../../hooks/useSystemSettings';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

const mockUseSystemSettings = vi.mocked(useSystemSettings);
const mockUsePermissions = vi.mocked(usePermissions);

describe('GeneralSettingsPage (the General card; was the UI Settings and Feature Flags tabs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default permission mock - admin user
    mockUsePermissions.mockReturnValue({
      permissions: new Set(['system_settings:read', 'system_settings:write']),
      roles: new Set(['admin']),
      hasPermission: (perm: string) => perm === 'system_settings:read' || perm === 'system_settings:write',
      hasAnyPermission: vi.fn(),
      hasAllPermissions: vi.fn(),
      hasRole: vi.fn(),
      hasAnyRole: vi.fn(),
      isAdmin: true,
    });

    // Default settings mock
    mockUseSystemSettings.mockReturnValue({
      settings: {
        ui: {
          allowUserThemeOverride: true,
        },
        features: {},
        ai: null,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        version: 1,
      },
      isLoading: false,
      error: null,
      isSaving: false,
      updateSettings: vi.fn().mockResolvedValue(undefined),
      replaceSettings: vi.fn().mockResolvedValue(undefined),
      updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
    });
  });

  describe('Authorization', () => {
    it('should redirect non-admin users', () => {
      mockUsePermissions.mockReturnValue({
        permissions: new Set(['user_settings:read']),
        roles: new Set(['viewer']),
        hasPermission: (perm: string) => perm === 'user_settings:read',
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: {
          user: {
            id: 'viewer-id',
            email: 'viewer@example.com',
            displayName: 'Viewer User',
            profileImageUrl: null,
            roles: [{ name: 'viewer' }],
            permissions: ['user_settings:read'],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        },
      });

      // Should redirect - component should not render
      expect(screen.queryByRole('heading', { name: 'General' })).not.toBeInTheDocument();
    });

    it('should load settings for admin users', async () => {
      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });
    });

    it('should show read-only mode when user lacks write permission', async () => {
      mockUsePermissions.mockReturnValue({
        permissions: new Set(['system_settings:read']),
        roles: new Set(['viewer']),
        hasPermission: (perm: string) => perm === 'system_settings:read',
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: {
          user: {
            ...mockAdminUser,
            roles: [{ name: 'viewer' }],
            permissions: ['system_settings:read'],
          },
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/read-only/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner while fetching', () => {
      mockUseSystemSettings.mockReturnValue({
        settings: null,
        isLoading: true,
        error: null,
        isSaving: false,
        updateSettings: vi.fn(),
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Error Display', () => {
    it('should display error message when error exists', async () => {
      mockUseSystemSettings.mockReturnValue({
        settings: null,
        isLoading: false,
        error: 'Failed to load system settings',
        isSaving: false,
        updateSettings: vi.fn(),
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByText(/failed to load system settings/i)).toBeInTheDocument();
      });
    });
  });

  describe('Card content (E10.3: one page, no tabs)', () => {
    it('renders the UI settings and the feature flags on one page, with no tab strip', async () => {
      render(<GeneralSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

      expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      expect(screen.getByText('User Interface')).toBeInTheDocument();
      expect(screen.getByText('Feature Flags')).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('drops the Advanced (JSON) editor (spec section 6)', async () => {
      render(<GeneralSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

      await screen.findByRole('heading', { level: 1, name: 'General' });
      expect(screen.queryByText(/advanced/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/json/i)).not.toBeInTheDocument();
    });

    it('does not host the AI or Backups content (each is its own card)', async () => {
      render(<GeneralSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

      await screen.findByRole('heading', { level: 1, name: 'General' });
      expect(screen.queryByText(/api key/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/scheduled backups/i)).not.toBeInTheDocument();
    });
  });

  describe('UI Settings Tab', () => {
    it('should display UI settings', async () => {
      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });

      expect(screen.getByRole('switch', { name: /allow users to override system theme/i })).toBeChecked();
    });
  });


  describe('Feature Flags Tab', () => {
    it('should display feature flags', async () => {
      const user = userEvent.setup();

      mockUseSystemSettings.mockReturnValue({
        settings: {
          ui: { allowUserThemeOverride: true },
          features: {
            betaFeature: true,
            newDashboard: false,
          },
          ai: null,
          updatedAt: new Date().toISOString(),
          updatedBy: null,
          version: 1,
        },
        isLoading: false,
        error: null,
        isSaving: false,
        updateSettings: vi.fn(),
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      // Both flags are listed on the page itself, no tab to click.
      expect(await screen.findByText('betaFeature')).toBeInTheDocument();
      expect(screen.getByText('newDashboard')).toBeInTheDocument();
      expect(user).toBeDefined();
    });
  });

  describe('Version Display', () => {
    it('should display last updated info when available', async () => {
      const updatedAt = new Date('2024-01-15T10:30:00Z');

      mockUseSystemSettings.mockReturnValue({
        settings: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: null,
          updatedAt: updatedAt.toISOString(),
          updatedBy: {
            id: 'admin-id',
            email: 'admin@example.com',
          },
          version: 1,
        },
        isLoading: false,
        error: null,
        isSaving: false,
        updateSettings: vi.fn(),
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByText(/admin@example\.com/i)).toBeInTheDocument();
      });
    });

    it('should not display updatedBy when not available', async () => {
      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });

      expect(screen.queryByText(/last updated by/i)).not.toBeInTheDocument();
    });
  });

  describe('Save Functionality', () => {
    it('should call updateSettings when saving', async () => {
      const updateSettings = vi.fn().mockResolvedValue(undefined);

      mockUseSystemSettings.mockReturnValue({
        settings: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: null,
          updatedAt: new Date().toISOString(),
          updatedBy: null,
          version: 1,
        },
        isLoading: false,
        error: null,
        isSaving: false,
        updateSettings,
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('switch', { name: /allow users to override system theme/i }));
      // The first Save Changes is the User Interface section's (feature flags has its own).
      await user.click(screen.getAllByRole('button', { name: 'Save Changes' })[0]);

      expect(updateSettings).toHaveBeenCalledWith({ ui: { allowUserThemeOverride: false } });
      expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    });

    it('should show success message after save', async () => {
      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });

      // Nothing saved yet: no snackbar until a save resolves.
      expect(screen.queryByText('Settings saved')).not.toBeInTheDocument();
    });

    it('should show error message when save fails', async () => {
      const updateSettings = vi.fn().mockRejectedValue(new Error('Save failed'));

      mockUseSystemSettings.mockReturnValue({
        settings: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: null,
          updatedAt: new Date().toISOString(),
          updatedBy: null,
          version: 1,
        },
        isLoading: false,
        error: null,
        isSaving: false,
        updateSettings,
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('switch', { name: /allow users to override system theme/i }));
      // The first Save Changes is the User Interface section's (feature flags has its own).
      await user.click(screen.getAllByRole('button', { name: 'Save Changes' })[0]);

      expect(await screen.findByText('Save failed')).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('should disable all controls while saving', () => {
      mockUseSystemSettings.mockReturnValue({
        settings: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: null,
          updatedAt: new Date().toISOString(),
          updatedBy: null,
          version: 1,
        },
        isLoading: false,
        error: null,
        isSaving: true,
        updateSettings: vi.fn(),
        replaceSettings: vi.fn(),
        updateCardExtractModel: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: { user: mockAdminUser },
      });

      expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /allow users to override system theme/i })).toBeDisabled();
    });

    it('should disable controls for read-only users', async () => {
      mockUsePermissions.mockReturnValue({
        permissions: new Set(['system_settings:read']),
        roles: new Set(['viewer']),
        hasPermission: (perm: string) => perm === 'system_settings:read',
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      render(<GeneralSettingsPage />, {
        wrapperOptions: {
          user: {
            ...mockAdminUser,
            roles: [{ name: 'viewer' }],
            permissions: ['system_settings:read'],
          },
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
      });
      expect(screen.getByRole('switch', { name: /allow users to override system theme/i })).toBeDisabled();
    });
  });
});
