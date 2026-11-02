import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import {
  BackupStatusPanel,
  isScheduleOverdue,
  type SystemBackupStatus,
} from '../../../components/home/BackupStatusPanel';
import type { DashboardResource } from '../../../hooks/useDashboardResource';
import type { BackupRunsResponse } from '../../../types';
import { HOUR, NOW, ago, makeRun, makeSchedule } from './homeFixtures';

function resource<T>(over: Partial<DashboardResource<T>>): DashboardResource<T> {
  return { status: 'ready', data: null, error: null, reload: vi.fn(), ...over };
}

const runs = (items = [makeRun()]): BackupRunsResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 1,
  totalPages: 1,
});

function renderPanel(props: Partial<Parameters<typeof BackupStatusPanel>[0]>) {
  return render(<BackupStatusPanel mine={null} system={null} now={NOW} {...props} />);
}

describe('BackupStatusPanel', () => {
  it('renders nothing when the user may see neither block', () => {
    const { container } = renderPanel({});
    expect(container.querySelector('[data-testid="home-backups"]')).toBeNull();
  });

  describe('Your backups', () => {
    it('shows a skeleton while loading', () => {
      renderPanel({ mine: resource<BackupRunsResponse>({ status: 'loading' }) });

      const mine = screen.getByTestId('home-backups-mine');
      expect(mine.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    it('shows the error with a retry', async () => {
      const reload = vi.fn();
      const user = userEvent.setup();
      renderPanel({ mine: resource<BackupRunsResponse>({ status: 'error', error: 'Boom', reload }) });

      expect(screen.getByRole('alert')).toHaveTextContent('Boom');
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('says when no backup was ever saved, and offers "Back up now"', () => {
      renderPanel({ mine: resource({ data: runs([]) }) });

      expect(screen.getByText('You have not saved a backup yet')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back up now' })).toHaveAttribute('href', '/settings');
    });

    it('shows the last run status, age, size and count', () => {
      renderPanel({ mine: resource({ data: runs() }) });

      const mine = screen.getByTestId('home-backups-mine');
      expect(within(mine).getByText('Last backup succeeded')).toBeInTheDocument();
      expect(within(mine).getByText('3h ago · 1.8 MB · 42 secrets')).toBeInTheDocument();
    });

    it.each([
      ['failed', 'Last backup failed'],
      ['running', 'Backup running'],
    ] as const)('labels a %s run in words', (status, label) => {
      renderPanel({ mine: resource({ data: runs([makeRun({ status, finishedAt: null })]) }) });

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('has no system block for a non-admin', () => {
      renderPanel({ mine: resource({ data: runs() }) });

      expect(screen.queryByText('System backups')).not.toBeInTheDocument();
    });
  });

  describe('System backups (admin)', () => {
    const system = (data: SystemBackupStatus) => resource<SystemBackupStatus>({ data });

    it('shows the latest scheduled run and the next run', () => {
      renderPanel({ system: system({ latest: makeRun({ trigger: 'schedule' }), schedule: makeSchedule() }) });

      const block = screen.getByTestId('home-backups-system');
      expect(within(block).getByText('Last backup succeeded')).toBeInTheDocument();
      expect(within(block).getByText('Scheduled · next run in 9h')).toBeInTheDocument();
      expect(within(block).queryByRole('link', { name: 'Open backup settings' })).not.toBeInTheDocument();
    });

    it('shows a failed run with its error and a link to the backup settings', () => {
      renderPanel({
        system: system({
          latest: makeRun({ status: 'failed', error: 'Storage upload failed', sizeBytes: null }),
          schedule: makeSchedule(),
        }),
      });

      const block = screen.getByTestId('home-backups-system');
      expect(within(block).getByText('Last backup failed')).toBeInTheDocument();
      expect(within(block).getByText(/Storage upload failed/)).toBeInTheDocument();
      expect(within(block).getByRole('link', { name: 'Open backup settings' })).toHaveAttribute(
        'href',
        '/admin/settings',
      );
    });

    it('flags an overdue schedule', () => {
      renderPanel({
        system: system({ latest: makeRun(), schedule: makeSchedule({ nextRunAt: ago(5 * HOUR) }) }),
      });

      expect(screen.getByText('Scheduled backup overdue')).toBeInTheDocument();
      expect(screen.getByText('The run due 5h ago has not started.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open backup settings' })).toBeInTheDocument();
    });

    it('says the schedule is off and when nothing ever ran', () => {
      renderPanel({ system: system({ latest: null, schedule: makeSchedule({ enabled: false, nextRunAt: null }) }) });

      expect(screen.getByText('No backup yet')).toBeInTheDocument();
      expect(screen.getByText('Schedule off')).toBeInTheDocument();
    });

    it('has its own loading and error states', () => {
      const { unmount } = renderPanel({
        mine: resource({ data: runs() }),
        system: resource<SystemBackupStatus>({ status: 'loading' }),
      });
      expect(screen.getByTestId('home-backups-system').querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByText('Last backup succeeded')).toBeInTheDocument();
      unmount();

      renderPanel({ system: resource<SystemBackupStatus>({ status: 'error', error: 'Forbidden' }) });
      expect(screen.getByRole('alert')).toHaveTextContent('Forbidden');
    });
  });
});

describe('isScheduleOverdue', () => {
  it('is false for a disabled schedule, a future run or a run within the grace hour', () => {
    expect(isScheduleOverdue(makeSchedule({ enabled: false, nextRunAt: ago(10 * HOUR) }), NOW)).toBe(false);
    expect(isScheduleOverdue(makeSchedule(), NOW)).toBe(false);
    expect(isScheduleOverdue(makeSchedule({ nextRunAt: ago(0.5 * HOUR) }), NOW)).toBe(false);
    expect(isScheduleOverdue(makeSchedule({ nextRunAt: null }), NOW)).toBe(false);
  });

  it('is true once the due run is more than an hour late', () => {
    expect(isScheduleOverdue(makeSchedule({ nextRunAt: ago(2 * HOUR) }), NOW)).toBe(true);
  });
});
