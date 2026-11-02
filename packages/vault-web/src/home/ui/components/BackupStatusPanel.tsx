import type { ReactNode } from 'react';
import { Box, Button, Divider, Skeleton, Typography } from '@mui/material';
import {
  CheckCircleOutlineOutlined as SucceededIcon,
  ErrorOutlineOutlined as FailedIcon,
  Sync as RunningIcon,
  CloudOffOutlined as NoneIcon,
  ScheduleOutlined as OverdueIcon,
  Backup as BackupIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import type { DashboardResource } from '../../../core/headless/useDashboardResource.js';
import type { BackupRun, BackupRunsResponse, BackupSchedule } from '../../../core/headless/types.js';
import { formatBytes } from '../../../backups/headless/backupSchedule.js';
import { formatRelativeTime } from '../../../core/headless/relativeTime.js';
import { DashboardPanel, PanelError } from './DashboardPanel.js';
import { HOME_LINKS } from '../../headless/homeLinks.js';

/** The system backup source: the newest run and the schedule, fetched together. */
export interface SystemBackupStatus {
  latest: BackupRun | null;
  schedule: BackupSchedule;
}

/**
 * A schedule whose next run is this far in the past has not started when it
 * should have (the runner checks every minute), so the backups are stale.
 */
export const BACKUP_OVERDUE_GRACE_MS = 60 * 60 * 1000;

export function isScheduleOverdue(schedule: BackupSchedule, now: Date): boolean {
  if (!schedule.enabled || !schedule.nextRunAt) return false;
  const next = new Date(schedule.nextRunAt).getTime();
  return !Number.isNaN(next) && now.getTime() - next > BACKUP_OVERDUE_GRACE_MS;
}

type Tone = 'success' | 'error' | 'primary' | 'warning' | 'neutral';

interface RunPresentation {
  tone: Tone;
  icon: ReactNode;
  label: string;
}

function presentRun(run: BackupRun | null): RunPresentation {
  if (!run) return { tone: 'neutral', icon: <NoneIcon fontSize="small" />, label: 'No backup yet' };
  switch (run.status) {
    case 'succeeded':
      return { tone: 'success', icon: <SucceededIcon fontSize="small" />, label: 'Last backup succeeded' };
    case 'failed':
      return { tone: 'error', icon: <FailedIcon fontSize="small" />, label: 'Last backup failed' };
    case 'running':
    default:
      return { tone: 'primary', icon: <RunningIcon fontSize="small" />, label: 'Backup running' };
  }
}

const TONE_COLOR: Record<Tone, string> = {
  success: 'success.main',
  error: 'error.main',
  primary: 'primary.main',
  warning: 'warning.main',
  neutral: 'text.secondary',
};

function runDetail(run: BackupRun, now: Date): string {
  const when = formatRelativeTime(run.finishedAt ?? run.startedAt, now);
  const parts = [run.status === 'running' ? `started ${when}` : when];
  if (run.status === 'succeeded' && run.sizeBytes !== null) parts.push(formatBytes(run.sizeBytes));
  if (run.status === 'succeeded') parts.push(`${run.secretCount} secret${run.secretCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** One status line: an icon and a label (never colour alone), plus a detail. */
function StatusLine({ tone, icon, label, detail }: RunPresentation & { detail?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
      <Box sx={{ display: 'flex', color: TONE_COLOR[tone], mt: '1px', flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {detail && (
          <Typography variant="caption" component="div" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {detail}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function BlockSkeleton() {
  return (
    <Box aria-busy="true" sx={{ display: 'flex', gap: 1.25, py: 0.5 }}>
      <Skeleton variant="circular" width={20} height={20} />
      <Box sx={{ flexGrow: 1 }}>
        <Skeleton width="60%" height={20} />
        <Skeleton width="40%" height={16} />
      </Box>
    </Box>
  );
}

function BlockLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="overline"
      component="h3"
      sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.6, mb: 0.75, letterSpacing: '0.06em' }}
    >
      {children}
    </Typography>
  );
}

interface BackupStatusPanelProps {
  /** The user's saved backups (`GET /api/backups/me?pageSize=1`); null when not permitted. */
  mine: DashboardResource<BackupRunsResponse> | null;
  /** Admin only (`system_settings:read`); null hides the block. */
  system: DashboardResource<SystemBackupStatus> | null;
  phoneOrder?: number;
  now?: Date;
}

/**
 * The newest backup of the user and, for administrators, the newest
 * scheduled run with the schedule's health. A failed or overdue system backup
 * says so in words, with a link to the backup settings.
 */
export function BackupStatusPanel({ mine, system, phoneOrder, now = new Date() }: BackupStatusPanelProps) {
  if (!mine && !system) return null;

  return (
    <DashboardPanel title="Backups" phoneOrder={phoneOrder} testId="home-backups">
      {mine && (
        <Box data-testid="home-backups-mine">
          <BlockLabel>Your backups</BlockLabel>
          {mine.status === 'loading' && <BlockSkeleton />}
          {mine.status === 'error' && (
            <PanelError message={mine.error ?? 'Could not load your backups.'} onRetry={mine.reload} />
          )}
          {mine.status === 'ready' && (() => {
            const latest = mine.data?.items[0] ?? null;
            const presentation = presentRun(latest);
            return (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: { xs: 'stretch', sm: 'center' },
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: 1.5,
                }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <StatusLine
                    {...presentation}
                    label={latest ? presentation.label : 'You have not saved a backup yet'}
                    detail={
                      latest
                        ? runDetail(latest, now)
                        : 'Keep an encrypted copy of your secrets in storage.'
                    }
                  />
                </Box>
                <Button
                  component={RouterLink}
                  to={HOME_LINKS.myBackups}
                  variant="outlined"
                  size="small"
                  startIcon={<BackupIcon />}
                  sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' }, ml: { xs: '30px', sm: 0 } }}
                >
                  Back up now
                </Button>
              </Box>
            );
          })()}
        </Box>
      )}

      {mine && system && <Divider sx={{ my: 2 }} />}

      {system && (
        <Box data-testid="home-backups-system">
          <BlockLabel>System backups</BlockLabel>
          {system.status === 'loading' && <BlockSkeleton />}
          {system.status === 'error' && (
            <PanelError message={system.error ?? 'Could not load the system backups.'} onRetry={system.reload} />
          )}
          {system.status === 'ready' && system.data && (
            <SystemBlock status={system.data} now={now} />
          )}
        </Box>
      )}
    </DashboardPanel>
  );
}

function SystemBlock({ status, now }: { status: SystemBackupStatus; now: Date }) {
  const { latest, schedule } = status;
  const overdue = isScheduleOverdue(schedule, now);
  const failed = latest?.status === 'failed';
  const presentation = presentRun(latest);

  let scheduleLine: string;
  if (!schedule.enabled) {
    scheduleLine = 'Schedule off';
  } else if (schedule.nextRunAt && !overdue) {
    scheduleLine = `Scheduled · next run ${formatRelativeTime(schedule.nextRunAt, now)}`;
  } else {
    scheduleLine = 'Scheduled';
  }

  const lastRunDetail = latest
    ? [runDetail(latest, now), failed && latest.error ? latest.error : null].filter(Boolean).join(' · ')
    : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <StatusLine
        {...presentation}
        detail={
          <>
            {lastRunDetail && <Box component="span" sx={{ display: 'block' }}>{lastRunDetail}</Box>}
            {!overdue && <Box component="span" sx={{ display: 'block' }}>{scheduleLine}</Box>}
          </>
        }
      />
      {overdue && (
        <StatusLine
          tone="warning"
          icon={<OverdueIcon fontSize="small" />}
          label="Scheduled backup overdue"
          detail={`The run due ${formatRelativeTime(schedule.nextRunAt, now)} has not started.`}
        />
      )}
      {(failed || overdue || !schedule.enabled) && (
        <Box>
          {/* Aligned with the status text: icon (20px) + gap (10px) - the button's own padding. */}
          <Button component={RouterLink} to={HOME_LINKS.systemBackups} size="small" sx={{ ml: '25px', mt: -0.5 }}>
            Open backup settings
          </Button>
        </Box>
      )}
    </Box>
  );
}
