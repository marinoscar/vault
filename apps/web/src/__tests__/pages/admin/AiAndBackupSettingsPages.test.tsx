import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockAdminUser, mockUser } from '../../utils/test-utils';
import AiSettingsPage from '../../../pages/admin/AiSettingsPage';
import BackupSettingsPage from '../../../pages/admin/BackupSettingsPage';

// Both panels load and save their own data; the page tests check the wiring
// that moved out of the old SystemSettingsPage tabs (gate, read-only prop).
vi.mock('../../../components/admin/ScheduledBackups', () => ({
  ScheduledBackups: () => <div data-testid="scheduled-backups">Scheduled backups panel</div>,
}));
vi.mock('../../../components/settings/AiSettings', () => ({
  AiSettings: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="ai-settings" data-disabled={String(Boolean(disabled))}>
      AI panel
    </div>
  ),
}));

const readOnlyAdmin = { ...mockAdminUser, permissions: ['system_settings:read'] };

describe('AI card page (/admin/settings/ai, was the AI tab)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the AI panel, writable for system_settings:write', () => {
    render(<AiSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(screen.getByRole('heading', { level: 1, name: 'AI' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-settings')).toHaveAttribute('data-disabled', 'false');
  });

  it('disables the panel for a read-only admin and says so', () => {
    render(<AiSettingsPage />, { wrapperOptions: { user: readOnlyAdmin } });

    expect(screen.getByTestId('ai-settings')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('redirects without system_settings:read', () => {
    render(<AiSettingsPage />, { wrapperOptions: { user: mockUser } });

    expect(screen.queryByTestId('ai-settings')).not.toBeInTheDocument();
  });
});

describe('Backups card page (/admin/settings/backups, was the Backups tab)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders ScheduledBackups for an admin', () => {
    render(<BackupSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(screen.getByRole('heading', { level: 1, name: 'Backups' })).toBeInTheDocument();
    expect(screen.getByTestId('scheduled-backups')).toBeInTheDocument();
  });

  it('shows the backups panel to read-only users (it reads write access itself)', () => {
    render(<BackupSettingsPage />, { wrapperOptions: { user: readOnlyAdmin } });

    expect(screen.getByTestId('scheduled-backups')).toBeInTheDocument();
  });

  it('redirects without system_settings:read', () => {
    render(<BackupSettingsPage />, { wrapperOptions: { user: mockUser } });

    expect(screen.queryByTestId('scheduled-backups')).not.toBeInTheDocument();
  });
});
