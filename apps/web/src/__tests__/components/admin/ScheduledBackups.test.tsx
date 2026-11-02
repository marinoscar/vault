import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import {
  BACKUP_HOURLY_HELPER_TEXT,
  BACKUP_POLL_INTERVAL_MS,
  ScheduledBackups,
} from '../../../components/admin/ScheduledBackups';
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

vi.mock('../../../utils/backupSchedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/backupSchedule')>()),
  startUrlDownload: vi.fn(),
}));

import {
  deleteBackupRun,
  getBackupDownloadUrl,
  getBackupRuns,
  getBackupSchedule,
  runBackupNow,
  updateBackupSchedule,
} from '../../../services/api';
import { startUrlDownload } from '../../../utils/backupSchedule';
import { usePermissions } from '../../../hooks/usePermissions';

const mockGetSchedule = vi.mocked(getBackupSchedule);
const mockGetRuns = vi.mocked(getBackupRuns);
const mockUsePermissions = vi.mocked(usePermissions);
const mockUpdate = vi.mocked(updateBackupSchedule);
const mockRunNow = vi.mocked(runBackupNow);
const mockDownloadUrl = vi.mocked(getBackupDownloadUrl);
const mockDelete = vi.mocked(deleteBackupRun);
const mockStartDownload = vi.mocked(startUrlDownload);

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

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  const runsPage = (items: BackupRun[]) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });

  async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
    await user.click(screen.getByRole('combobox', { name: label }));
    await user.click(await screen.findByRole('option', { name: option }));
  }

  async function renderLoaded() {
    const user = userEvent.setup();
    render(<ScheduledBackups />);
    await screen.findByText('Backup schedule');
    return user;
  }

  function lastPayload() {
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    return mockUpdate.mock.calls[0][0] as unknown as Record<string, unknown>;
  }

  describe('frequency-dependent fields', () => {
    it('shows only the time for daily', async () => {
      await renderLoaded();

      expect(screen.getByLabelText('Time')).toHaveValue('03:00');
      expect(screen.queryByRole('combobox', { name: 'Every' })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Day of the week' })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Day of the month' })).not.toBeInTheDocument();
      expect(screen.queryByText(BACKUP_HOURLY_HELPER_TEXT)).not.toBeInTheDocument();
    });

    it('shows the hours select, with the on-the-hour helper text, and no time for hourly', async () => {
      const user = await renderLoaded();

      await choose(user, 'Frequency', 'Every N hours');

      expect(screen.getByRole('combobox', { name: 'Every' })).toBeInTheDocument();
      expect(screen.getByText('Runs on the hour, counted from midnight')).toBeInTheDocument();
      expect(screen.queryByLabelText('Time')).not.toBeInTheDocument();
      expect(screen.getByTestId('backup-summary')).toHaveTextContent('Every hour · keeps 7');

      await choose(user, 'Every', '6 hours');
      expect(screen.getByTestId('backup-summary')).toHaveTextContent('Every 6 hours · keeps 7');
    });

    it('offers the allowed hour intervals only', async () => {
      const user = await renderLoaded();
      await choose(user, 'Frequency', 'Every N hours');

      await user.click(screen.getByRole('combobox', { name: 'Every' }));
      const options = (await screen.findAllByRole('option')).map((o) => o.textContent);

      expect(options).toEqual(['1 hour', '2 hours', '3 hours', '4 hours', '6 hours', '8 hours', '12 hours']);
    });

    it('shows the weekday select and the time for weekly', async () => {
      const user = await renderLoaded();

      await choose(user, 'Frequency', 'Weekly');
      await choose(user, 'Day of the week', 'Friday');

      expect(screen.getByLabelText('Time')).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Day of the month' })).not.toBeInTheDocument();
      expect(screen.getByTestId('backup-summary')).toHaveTextContent(
        'Every Friday at 03:00 (America/Chicago) · keeps 7',
      );
    });

    it('shows days 1-28 and the time for monthly', async () => {
      const user = await renderLoaded();

      await choose(user, 'Frequency', 'Monthly');
      await user.click(screen.getByRole('combobox', { name: 'Day of the month' }));
      const options = await screen.findAllByRole('option');
      expect(options).toHaveLength(28);
      expect(options[27]).toHaveTextContent('28');
      await user.click(options[14]);

      expect(screen.getByLabelText('Time')).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Day of the week' })).not.toBeInTheDocument();
      expect(screen.getByTestId('backup-summary')).toHaveTextContent('Monthly on day 15 at 03:00');
    });

    it('updates the summary when the time changes', async () => {
      await renderLoaded();

      fireEvent.change(screen.getByLabelText('Time'), { target: { value: '21:45' } });

      expect(screen.getByTestId('backup-summary')).toHaveTextContent('Every day at 21:45');
    });
  });

  describe('validation', () => {
    it('blocks saving a keep count below the minimum', async () => {
      const user = await renderLoaded();

      fireEvent.change(screen.getByLabelText('Keep the last N backups'), { target: { value: '0' } });
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(await screen.findByText('Keep between 1 and 365 backups')).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('blocks saving a keep count above the maximum or empty', async () => {
      const user = await renderLoaded();
      const keep = screen.getByLabelText('Keep the last N backups');

      fireEvent.change(keep, { target: { value: '366' } });
      await user.click(screen.getByRole('button', { name: /save schedule/i }));
      expect(await screen.findByText('Keep between 1 and 365 backups')).toBeInTheDocument();

      fireEvent.change(keep, { target: { value: '' } });
      await user.click(screen.getByRole('button', { name: /save schedule/i }));
      expect(screen.getByText('Keep between 1 and 365 backups')).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('blocks saving an empty time', async () => {
      const user = await renderLoaded();

      fireEvent.change(screen.getByLabelText('Time'), { target: { value: '' } });
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(await screen.findByText('Enter a time as HH:mm')).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('blocks saving a too-short new password', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /change password/i }));
      await user.type(screen.getByLabelText('New password'), 'abc');
      await user.type(screen.getByLabelText('Confirm password'), 'abc');
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('blocks saving when the password confirmation does not match', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /change password/i }));
      await user.type(screen.getByLabelText('New password'), 'blue tiger river');
      await user.type(screen.getByLabelText('Confirm password'), 'blue tiger');
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('shows a soft warning for a weak password without blocking', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /change password/i }));
      await user.type(screen.getByLabelText('New password'), 'short1');

      expect(screen.getByText(/Short passwords are easy to guess/)).toBeInTheDocument();
    });

    it('requires a password before enabling when none is set', async () => {
      mockGetSchedule.mockResolvedValue({
        ...schedule,
        passwordConfigured: false,
        passwordUpdatedAt: null,
      });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(
        await screen.findByText('Set a backup password before turning scheduled backups on.'),
      ).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    const saved: BackupSchedule = { ...schedule };

    beforeEach(() => {
      mockUpdate.mockResolvedValue(saved);
    });

    it('omits the password when it is unchanged', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(await screen.findByText('Backup schedule saved')).toBeInTheDocument();
      expect(lastPayload()).not.toHaveProperty('password');
    });

    it('sends the editable fields as-is for the loaded schedule', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload()).toEqual({
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
      });
    });

    it('sends null for fields the chosen frequency does not use', async () => {
      mockGetSchedule.mockResolvedValue({
        ...schedule,
        frequency: 'weekly',
        dayOfWeek: 3,
        // stale values left over from an earlier frequency
        intervalHours: 6,
        dayOfMonth: 12,
      });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /save schedule/i }));
      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload()).toMatchObject({
        frequency: 'weekly',
        dayOfWeek: 3,
        intervalHours: null,
        dayOfMonth: null,
      });
    });

    it('nulls the old fields after switching frequency', async () => {
      mockGetSchedule.mockResolvedValue({ ...schedule, frequency: 'weekly', dayOfWeek: 3 });
      const user = await renderLoaded();

      await choose(user, 'Frequency', 'Every N hours');
      await choose(user, 'Every', '4 hours');
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload()).toMatchObject({
        frequency: 'hourly',
        intervalHours: 4,
        dayOfWeek: null,
        dayOfMonth: null,
      });
    });

    it('sends the monthly day and nulls the others', async () => {
      const user = await renderLoaded();

      await choose(user, 'Frequency', 'Monthly');
      await choose(user, 'Day of the month', '10');
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload()).toMatchObject({
        frequency: 'monthly',
        dayOfMonth: 10,
        dayOfWeek: null,
        intervalHours: null,
      });
    });

    it('sends the password when it is changed', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /change password/i }));
      await user.type(screen.getByLabelText('New password'), 'blue tiger river');
      await user.type(screen.getByLabelText('Confirm password'), 'blue tiger river');
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload().password).toBe('blue tiger river');
    });

    it('omits the password after "Keep current password"', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /change password/i }));
      await user.type(screen.getByLabelText('New password'), 'blue tiger river');
      await user.click(screen.getByRole('button', { name: /keep current password/i }));
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload()).not.toHaveProperty('password');
    });

    it('sends the toggled options', async () => {
      const user = await renderLoaded();

      await user.click(screen.getByRole('checkbox', { name: /include attachments/i }));
      await user.click(screen.getByRole('checkbox', { name: /include old versions/i }));
      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(lastPayload()).toMatchObject({ includeAttachments: false, includeVersions: true });
    });

    it('shows the server error when saving fails', async () => {
      mockUpdate.mockRejectedValue(new Error('Object storage is unavailable'));
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(await screen.findByText('Object storage is unavailable')).toBeInTheDocument();
      expect(screen.queryByText('Backup schedule saved')).not.toBeInTheDocument();
    });
  });

  describe('storage not configured', () => {
    beforeEach(() => {
      mockGetSchedule.mockResolvedValue({ ...schedule, enabled: false, storageConfigured: false });
    });

    it('shows the warning and explains why run is disabled', async () => {
      await renderLoaded();

      expect(
        screen.getByText('Object storage is not configured. Scheduled backups cannot run until it is.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /run backup now/i })).toBeDisabled();
      expect(screen.getByText('Object storage is not configured.')).toBeInTheDocument();
    });

    it('does not let the schedule be turned on', async () => {
      await renderLoaded();

      expect(screen.getByRole('checkbox', { name: /scheduled backups enabled/i })).toBeDisabled();
    });

    it('does not show the warning when storage is configured', async () => {
      mockGetSchedule.mockResolvedValue(schedule);
      await renderLoaded();

      expect(screen.queryByText(/Object storage is not configured/)).not.toBeInTheDocument();
    });

    it('blocks saving an enabled schedule', async () => {
      mockGetSchedule.mockResolvedValue({ ...schedule, enabled: true, storageConfigured: false });
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /save schedule/i }));

      expect(
        await screen.findByText(
          'Object storage is not configured, so scheduled backups cannot be turned on.',
        ),
      ).toBeInTheDocument();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('run now', () => {
    it('is disabled with a reason until a password is saved', async () => {
      mockGetSchedule.mockResolvedValue({
        ...schedule,
        passwordConfigured: false,
        passwordUpdatedAt: null,
      });
      await renderLoaded();

      expect(screen.getByRole('button', { name: /run backup now/i })).toBeDisabled();
      expect(screen.getByText('Save a backup password first.')).toBeInTheDocument();
    });

    it('starts a backup and reloads the history', async () => {
      mockRunNow.mockResolvedValue({ ...run, id: 'run-2', status: 'running' });
      const user = await renderLoaded();
      await screen.findByText('Succeeded');
      mockGetRuns.mockResolvedValue(
        runsPage([{ ...run, id: 'run-2', status: 'running', finishedAt: null, sizeBytes: null }, run]),
      );

      await user.click(screen.getByRole('button', { name: /run backup now/i }));

      expect(mockRunNow).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Backup started.')).toBeInTheDocument();
      expect(await screen.findByText('Running')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /backup running/i })).toBeDisabled();
    });

    it('shows the server message when a run is already in progress (409)', async () => {
      mockRunNow.mockRejectedValue(new Error('A backup is already running'));
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /run backup now/i }));

      expect(await screen.findByText('A backup is already running')).toBeInTheDocument();
      expect(screen.queryByText('Backup started.')).not.toBeInTheDocument();
      // the history is reloaded so the running run becomes visible
      await waitFor(() => expect(mockGetRuns.mock.calls.length).toBeGreaterThan(1));
      expect(screen.getByRole('button', { name: /run backup now/i })).toBeEnabled();
    });

    it('falls back to a generic message for a non-Error rejection', async () => {
      mockRunNow.mockRejectedValue('boom');
      const user = await renderLoaded();

      await user.click(screen.getByRole('button', { name: /run backup now/i }));

      expect(await screen.findByText('Failed to start the backup')).toBeInTheDocument();
    });
  });

  describe('polling while a run is running', () => {
    const running: BackupRun = {
      ...run,
      id: 'run-2',
      status: 'running',
      finishedAt: null,
      sizeBytes: null,
    };

    async function flush() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }

    async function tick(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('re-fetches the history every interval and stops once the run settles', async () => {
      mockGetRuns.mockResolvedValue(runsPage([running]));
      render(<ScheduledBackups />);
      await flush();

      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(mockGetRuns).toHaveBeenCalledTimes(1);
      expect(mockGetSchedule).toHaveBeenCalledTimes(1);

      await tick(BACKUP_POLL_INTERVAL_MS);
      expect(mockGetRuns).toHaveBeenCalledTimes(2);
      await tick(BACKUP_POLL_INTERVAL_MS);
      expect(mockGetRuns).toHaveBeenCalledTimes(3);

      // the run finishes: the next poll sees it, polling stops, schedule is refreshed
      mockGetRuns.mockResolvedValue(runsPage([{ ...running, status: 'succeeded' }]));
      await tick(BACKUP_POLL_INTERVAL_MS);
      expect(mockGetRuns).toHaveBeenCalledTimes(4);
      expect(screen.queryByText('Running')).not.toBeInTheDocument();
      expect(screen.getByText('Succeeded')).toBeInTheDocument();
      expect(mockGetSchedule).toHaveBeenCalledTimes(2);

      await tick(BACKUP_POLL_INTERVAL_MS * 4);
      expect(mockGetRuns).toHaveBeenCalledTimes(4);
    });

    it('does not poll when nothing is running', async () => {
      render(<ScheduledBackups />);
      await flush();
      expect(mockGetRuns).toHaveBeenCalledTimes(1);

      await tick(BACKUP_POLL_INTERVAL_MS * 3);

      expect(mockGetRuns).toHaveBeenCalledTimes(1);
      expect(mockGetSchedule).toHaveBeenCalledTimes(1);
    });

    it('stops polling when unmounted', async () => {
      mockGetRuns.mockResolvedValue(runsPage([running]));
      const { unmount } = render(<ScheduledBackups />);
      await flush();
      expect(mockGetRuns).toHaveBeenCalledTimes(1);

      unmount();
      await tick(BACKUP_POLL_INTERVAL_MS * 3);

      expect(mockGetRuns).toHaveBeenCalledTimes(1);
    });

    it('keeps unsaved form edits when the schedule is refreshed after a run settles', async () => {
      mockGetRuns.mockResolvedValue(runsPage([running]));
      render(<ScheduledBackups />);
      await flush();
      fireEvent.change(screen.getByLabelText('Time'), { target: { value: '21:45' } });

      mockGetRuns.mockResolvedValue(runsPage([{ ...running, status: 'succeeded' }]));
      await tick(BACKUP_POLL_INTERVAL_MS);

      expect(mockGetSchedule).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('Time')).toHaveValue('21:45');
    });
  });

  describe('history actions', () => {
    it('downloads through the signed URL', async () => {
      mockDownloadUrl.mockResolvedValue({
        url: 'https://files.example.test/signed?sig=abc',
        expiresAt: '2026-11-02T10:00:00.000Z',
        fileName: 'vault-scheduled-2026-11-01.zip',
      });
      const user = await renderLoaded();
      await screen.findByText('Succeeded');

      await user.click(screen.getByRole('button', { name: 'Download backup' }));

      await waitFor(() => expect(mockStartDownload).toHaveBeenCalledTimes(1));
      expect(mockDownloadUrl).toHaveBeenCalledWith('run-1');
      expect(mockStartDownload).toHaveBeenCalledWith(
        'https://files.example.test/signed?sig=abc',
        'vault-scheduled-2026-11-01.zip',
      );
    });

    it('shows an error and does not download when the link request fails', async () => {
      mockDownloadUrl.mockRejectedValue(new Error('Backup file is gone'));
      const user = await renderLoaded();
      await screen.findByText('Succeeded');

      await user.click(screen.getByRole('button', { name: 'Download backup' }));

      expect(await screen.findByText('Backup file is gone')).toBeInTheDocument();
      expect(mockStartDownload).not.toHaveBeenCalled();
    });

    it('disables download for a run that is not downloadable', async () => {
      mockGetRuns.mockResolvedValue(
        runsPage([{ ...run, status: 'failed', downloadable: false, error: 'disk full' }]),
      );
      await renderLoaded();

      expect(await screen.findByText('disk full')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download backup' })).toBeDisabled();
    });

    it('asks for confirmation before deleting and does nothing on cancel', async () => {
      const user = await renderLoaded();
      await screen.findByText('Succeeded');

      await user.click(screen.getByRole('button', { name: 'Delete backup' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Delete this backup?')).toBeInTheDocument();
      expect(mockDelete).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('deletes after confirming and reloads the history', async () => {
      mockDelete.mockResolvedValue(undefined);
      const user = await renderLoaded();
      await screen.findByText('Succeeded');
      const loadsBefore = mockGetRuns.mock.calls.length;

      await user.click(screen.getByRole('button', { name: 'Delete backup' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('run-1'));
      expect(await screen.findByText('Backup deleted.')).toBeInTheDocument();
      expect(mockGetRuns.mock.calls.length).toBeGreaterThan(loadsBefore);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows an error when deleting fails', async () => {
      mockDelete.mockRejectedValue(new Error('Storage refused the delete'));
      const user = await renderLoaded();
      await screen.findByText('Succeeded');

      await user.click(screen.getByRole('button', { name: 'Delete backup' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(await screen.findByText('Storage refused the delete')).toBeInTheDocument();
      expect(screen.queryByText('Backup deleted.')).not.toBeInTheDocument();
    });

    it('cannot delete a running or already deleted backup', async () => {
      mockGetRuns.mockResolvedValue(
        runsPage([
          { ...run, id: 'a', status: 'running', downloadable: false },
          { ...run, id: 'b', deletedAt: '2026-11-02T00:00:00.000Z', downloadable: false },
        ]),
      );
      await renderLoaded();
      await screen.findByText('Running');

      const buttons = screen.getAllByRole('button', { name: 'Delete backup' });
      expect(buttons).toHaveLength(2);
      buttons.forEach((b) => expect(b).toBeDisabled());
      expect(screen.getByText('Deleted')).toBeInTheDocument();
    });

    it('shows the empty state when there are no backups', async () => {
      mockGetRuns.mockResolvedValue(runsPage([]));
      await renderLoaded();
      expect(await screen.findByText('No backups yet.')).toBeInTheDocument();
    });

    it('shows a warning chip with a plural count', async () => {
      mockGetRuns.mockResolvedValue(runsPage([{ ...run, warningCount: 2 }]));
      await renderLoaded();
      expect(await screen.findByText('2 warnings')).toBeInTheDocument();
    });

    it('shows an error when the history cannot be loaded', async () => {
      mockGetRuns.mockRejectedValue(new Error('History unavailable'));
      await renderLoaded();
      expect(await screen.findByText('History unavailable')).toBeInTheDocument();
    });
  });

  describe('loading the schedule', () => {
    it('shows an error with a retry that reloads', async () => {
      mockGetSchedule.mockRejectedValueOnce(new Error('Schedule unavailable'));
      const user = userEvent.setup();
      render(<ScheduledBackups />);

      expect(await screen.findByText('Schedule unavailable')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Backup schedule')).toBeInTheDocument();
      expect(mockGetSchedule).toHaveBeenCalledTimes(2);
    });
  });

  describe('read-only mode', () => {
    beforeEach(() => {
      mockUsePermissions.mockReturnValue(permissions(['system_settings:read']));
    });

    it('explains the restriction', async () => {
      await renderLoaded();
      expect(
        screen.getByText(
          'You can view backups but not change the schedule, run, download or delete them.',
        ),
      ).toBeInTheDocument();
    });

    it('disables every schedule control and hides the password editor', async () => {
      mockGetSchedule.mockResolvedValue({ ...schedule, frequency: 'weekly', dayOfWeek: 2 });
      await renderLoaded();

      expect(screen.getByRole('checkbox', { name: /scheduled backups enabled/i })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Frequency' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('combobox', { name: 'Day of the week' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByLabelText('Time')).toBeDisabled();
      expect(screen.getByLabelText('Keep the last N backups')).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /include old versions/i })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /change password/i })).not.toBeInTheDocument();
    });

    it('hides the history actions column but still lists the runs', async () => {
      await renderLoaded();

      expect(await screen.findByText('Succeeded')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download backup' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete backup' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    });

    it('does not show the write info banner to writers', async () => {
      mockUsePermissions.mockReturnValue(permissions(['system_settings:read', 'system_settings:write']));
      await renderLoaded();
      expect(screen.queryByText(/You can view backups but not change/)).not.toBeInTheDocument();
    });
  });
});
