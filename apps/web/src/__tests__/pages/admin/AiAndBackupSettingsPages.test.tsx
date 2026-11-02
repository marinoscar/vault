import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { render, mockAdminUser, mockUser } from '../../utils/test-utils';
import AiSettingsPage from '../../../pages/admin/AiSettingsPage';
import BackupSettingsPage from '../../../pages/admin/BackupSettingsPage';

// Both panels load and save their own data; the page tests check the wiring
// that moved out of the old SystemSettingsPage tabs (gate, read-only prop).
vi.mock('../../../components/admin/ScheduledBackups', () => ({
  ScheduledBackups: () => <div data-testid="scheduled-backups">Scheduled backups panel</div>,
}));
// The packaged AiConfigPage is the platform's (its own tests cover it); here it is
// a stub that proves Vault hands it the card-scanning-model section as a slot.
vi.mock('@marinoscar/platform-web/ai/ui/config-page', () => ({
  default: ({ slots }: { slots?: { AfterContent?: () => unknown } }) => {
    const After = slots?.AfterContent as ComponentType | undefined;
    return (
      <div data-testid="packaged-ai-config-page">
        <h1>AI</h1>
        {After ? <After /> : null}
      </div>
    );
  },
}));
vi.mock('../../../components/settings/CardScanModelSection', () => ({
  CardScanModelSection: () => <div data-testid="card-scan-model-section" />,
}));

const readOnlyAdmin = { ...mockAdminUser, permissions: ['system_settings:read'] };

describe('AI card page (/admin/settings/ai, the packaged AiConfigPage, E8.2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the packaged AI page with Vault\'s card scanning model section in its AfterContent slot', () => {
    render(<AiSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(screen.getByTestId('packaged-ai-config-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'AI' })).toBeInTheDocument();
    expect(screen.getByTestId('card-scan-model-section')).toBeInTheDocument();
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
