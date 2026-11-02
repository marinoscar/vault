import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { ScheduledBackups } from '../../../components/admin/ScheduledBackups';
import type { BackupRun, BackupSchedule } from '../../../types';

vi.mock('../../../services/api', () => ({
  getBackupSchedule: vi.fn(),
  updateBackupSchedule: vi.fn(),
  runBackupNow: vi.fn(),
  getBackupRuns: vi.fn(),
  getBackupDownloadUrl: vi.fn(),
  deleteBackupRun: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { getBackupRuns, getBackupSchedule } from '../../../services/api';
import { usePermissions } from '../../../hooks/usePermissions';

const mockGetSchedule = vi.mocked(getBackupSchedule);
const mockGetRuns = vi.mocked(getBackupRuns);
const mockUsePermissions = vi.mocked(usePermissions);

const schedule: BackupSchedule = {
  enabled: true,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'America/Chicago',
  keepCount: 7,
  includeAttachments: true,
  includeVersions: false,
  passwordConfigured: true,
  passwordUpdatedAt: '2026-10-01T12:00:00.000Z',
  nextRunAt: '2026-11-03T09:00:00.000Z',
  lastRunAt: null,
  storageConfigured: true,
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const run: BackupRun = {
  id: 'run-1',
  status: 'succeeded',
  trigger: 'manual',
  triggeredBy: { id: 'u1', email: 'admin@example.test', displayName: 'Person A' },
  sizeBytes: 2048,
  userCount: 2,
  secretCount: 5,
  attachmentCount: 1,
  warningCount: 0,
  error: null,
  startedAt: '2026-11-01T09:00:00.000Z',
  finishedAt: '2026-11-01T09:00:05.000Z',
  deletedAt: null,
  downloadable: true,
};

function permissions(perms: string[]) {
  return {
    permissions: new Set(perms),
    roles: new Set(['admin']),
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin: true,
  };
}

describe('ScheduledBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSchedule.mockResolvedValue(schedule);
    mockGetRuns.mockResolvedValue({ items: [run], total: 1, page: 1, pageSize: 10, totalPages: 1 });
    mockUsePermissions.mockReturnValue(
      permissions(['system_settings:read', 'system_settings:write']),
    );
  });

  it('renders the schedule summary, password state and history', async () => {
    render(<ScheduledBackups />);

    expect(await screen.findByText('Backup schedule')).toBeInTheDocument();
    expect(screen.getByTestId('backup-summary')).toHaveTextContent(
      'Every day at 03:00 (America/Chicago) · keeps 7',
    );
    expect(screen.getByText(/Password set on/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'If you lose this password, these backups cannot be opened. There is no recovery.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run backup now/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /save schedule/i })).toBeInTheDocument();
    expect(await screen.findByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('is read-only without system_settings:write', async () => {
    mockUsePermissions.mockReturnValue(permissions(['system_settings:read']));
    render(<ScheduledBackups />);

    expect(await screen.findByText('Backup schedule')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run backup now/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /include attachments/i })).toBeDisabled();
  });
});
