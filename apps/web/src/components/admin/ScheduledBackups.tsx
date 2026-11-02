import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import {
  deleteBackupRun,
  getBackupDownloadUrl,
  getBackupRuns,
  getBackupSchedule,
  runBackupNow,
  updateBackupSchedule,
} from '../../services/api';
import type {
  BackupFrequency,
  BackupRun,
  BackupSchedule,
  BackupScheduleFields,
  UpdateBackupScheduleRequest,
} from '../../types';
import {
  BACKUP_PASSWORD_MAX_LENGTH,
  BACKUP_PASSWORD_WARNING,
  shouldWarnBackupPassword,
  suggestBackupPassword,
  validateBackupPassword,
} from '../../utils/backupPassword';
import {
  BACKUP_DAY_OF_MONTH_MAX,
  BACKUP_FREQUENCY_LABELS,
  BACKUP_INTERVAL_HOURS,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_PASSWORD_LOSS_WARNING,
  WEEKDAY_NAMES,
  describeBackupSchedule,
  formatDateTime,
  getBrowserTimeZone,
  getTimeZoneOptions,
  normalizeScheduleFields,
  scheduleContentSelection,
  startUrlDownload,
  validateScheduleFields,
  withScheduleContents,
} from '../../utils/backupSchedule';
import { rawBackupContentFlags } from '../../utils/backupContents';
import { useBackupRunHistory } from '../../hooks/useBackupRunHistory';
import { BackupContentsGroup } from '../settings/BackupContentsGroup';
import { BackupRunsTable, DeleteBackupDialog } from '../settings/BackupRunsTable';
import { AdminBackupDownloadDialog } from './AdminBackupDownloadDialog';

export { BACKUP_POLL_INTERVAL_MS } from '../../hooks/useBackupRunHistory';

/** Hourly runs are anchored to local midnight, not to the save time. */
export const BACKUP_HOURLY_HELPER_TEXT = 'Runs on the hour, counted from midnight';

export const BACKUP_SCHEDULE_SAVED_MESSAGE = 'Backup schedule saved';

const FREQUENCIES: BackupFrequency[] = ['hourly', 'daily', 'weekly', 'monthly'];
const DAYS_OF_MONTH = Array.from({ length: BACKUP_DAY_OF_MONTH_MAX }, (_, i) => i + 1);

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The editable part of a schedule response, as the form's draft. */
function toDraft(schedule: BackupSchedule): BackupScheduleFields {
  return {
    enabled: schedule.enabled,
    frequency: schedule.frequency,
    intervalHours: schedule.intervalHours,
    timeOfDay: schedule.timeOfDay,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    // A schedule that was never saved starts in the admin's own time zone.
    timezone: schedule.updatedAt === null ? getBrowserTimeZone() : schedule.timezone,
    keepCount: schedule.keepCount,
    // Older API responses may lack the newer flags; they take the defaults.
    ...rawBackupContentFlags(scheduleContentSelection(schedule)),
  };
}

// =============================================================================
// Schedule card
// =============================================================================

interface ScheduleCardProps {
  schedule: BackupSchedule;
  canWrite: boolean;
  onSaved: (schedule: BackupSchedule) => void;
}

function BackupScheduleCard({ schedule, canWrite, onSaved }: ScheduleCardProps) {
  const [draft, setDraft] = useState<BackupScheduleFields>(() => toDraft(schedule));
  const [editingPassword, setEditingPassword] = useState(!schedule.passwordConfigured);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const timeZones = useMemo(() => getTimeZoneOptions(draft.timezone), [draft.timezone]);
  const readOnly = !canWrite || saving;

  const update = <K extends keyof BackupScheduleFields>(key: K, value: BackupScheduleFields[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSuccess(null);
  };

  const changingPassword = editingPassword && (password.length > 0 || confirm.length > 0);
  const passwordValidation = changingPassword ? validateBackupPassword(password, confirm) : null;
  const passwordError =
    submitted && passwordValidation && passwordValidation !== 'Passwords do not match'
      ? passwordValidation
      : null;
  const mismatch = changingPassword && password !== confirm && (confirm.length > 0 || submitted);
  const confirmError = mismatch && !passwordError ? 'Passwords do not match' : null;
  const showWeakWarning = editingPassword && shouldWarnBackupPassword(password);

  const enableBlockedByStorage = !schedule.storageConfigured && !draft.enabled;

  const resetPasswordFields = (stored: boolean) => {
    setPassword('');
    setConfirm('');
    setShowPassword(false);
    setEditingPassword(!stored);
  };

  const handleSuggest = () => {
    const suggestion = suggestBackupPassword();
    setPassword(suggestion);
    setConfirm(suggestion);
    setShowPassword(true);
    setSuccess(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setSuccess(null);

    const fields = normalizeScheduleFields(draft);
    const fieldError = validateScheduleFields(fields);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    if (passwordValidation) return;
    if (fields.enabled && !schedule.passwordConfigured && !changingPassword) {
      setError('Set a backup password before turning scheduled backups on.');
      return;
    }
    if (fields.enabled && !schedule.storageConfigured) {
      setError('Object storage is not configured, so scheduled backups cannot be turned on.');
      return;
    }

    const body: UpdateBackupScheduleRequest = { ...fields };
    if (changingPassword) body.password = password;

    setSaving(true);
    try {
      const saved = await updateBackupSchedule(body);
      setDraft(toDraft(saved));
      resetPasswordFields(saved.passwordConfigured);
      setSubmitted(false);
      setSuccess(BACKUP_SCHEDULE_SAVED_MESSAGE);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the backup schedule'));
    } finally {
      setSaving(false);
    }
  };

  const visibilityToggle = (
    <InputAdornment position="end">
      <IconButton
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        onClick={() => setShowPassword((v) => !v)}
        edge="end"
      >
        {showPassword ? <VisibilityOff /> : <Visibility />}
      </IconButton>
    </InputAdornment>
  );

  const nextRun = formatDateTime(schedule.nextRunAt);
  const lastRun = formatDateTime(schedule.lastRunAt);
  const passwordSetOn = schedule.passwordUpdatedAt
    ? new Date(schedule.passwordUpdatedAt).toLocaleDateString()
    : null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Backup schedule
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            marginBottom: "16px"
          }}>
          Back up every user&apos;s vault data into object storage as one password-protected
          (AES-256) zip per run. Open a backup with 7-Zip on Windows or Keka on Mac.
        </Typography>

        {!schedule.storageConfigured && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Object storage is not configured. Scheduled backups cannot run until it is.
          </Alert>
        )}

        <Box component="form" noValidate onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.enabled}
                    onChange={(e) => update('enabled', e.target.checked)}
                    disabled={readOnly || enableBlockedByStorage}
                  />
                }
                label="Scheduled backups enabled"
              />
              <Typography variant="body2" data-testid="backup-summary" sx={{
                color: "text.secondary"
              }}>
                {describeBackupSchedule(normalizeScheduleFields(draft))}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {schedule.enabled && nextRun ? `Next run: ${nextRun}` : 'Next run: not scheduled'}
                {lastRun ? ` · Last run: ${lastRun}` : ''}
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2,
              }}
            >
              <FormControl fullWidth disabled={readOnly}>
                <InputLabel id="backup-frequency-label">Frequency</InputLabel>
                <Select
                  labelId="backup-frequency-label"
                  label="Frequency"
                  value={draft.frequency}
                  onChange={(e) => update('frequency', e.target.value as BackupFrequency)}
                >
                  {FREQUENCIES.map((f) => (
                    <MenuItem key={f} value={f}>
                      {BACKUP_FREQUENCY_LABELS[f]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {draft.frequency === 'hourly' ? (
                <FormControl fullWidth disabled={readOnly}>
                  <InputLabel id="backup-interval-label">Every</InputLabel>
                  <Select
                    labelId="backup-interval-label"
                    label="Every"
                    value={draft.intervalHours ?? 1}
                    onChange={(e) => update('intervalHours', Number(e.target.value))}
                  >
                    {BACKUP_INTERVAL_HOURS.map((h) => (
                      <MenuItem key={h} value={h}>
                        {h === 1 ? '1 hour' : `${h} hours`}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>{BACKUP_HOURLY_HELPER_TEXT}</FormHelperText>
                </FormControl>
              ) : (
                <TextField
                  label="Time"
                  type="time"
                  value={draft.timeOfDay}
                  onChange={(e) => update('timeOfDay', e.target.value)}
                  disabled={readOnly}
                  fullWidth
                  slotProps={{
                    htmlInput: { step: 60 },
                    inputLabel: { shrink: true }
                  }} />
              )}

              {draft.frequency === 'weekly' && (
                <FormControl fullWidth disabled={readOnly}>
                  <InputLabel id="backup-weekday-label">Day of the week</InputLabel>
                  <Select
                    labelId="backup-weekday-label"
                    label="Day of the week"
                    value={draft.dayOfWeek ?? 1}
                    onChange={(e) => update('dayOfWeek', Number(e.target.value))}
                  >
                    {WEEKDAY_NAMES.map((name, i) => (
                      <MenuItem key={name} value={i}>
                        {name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {draft.frequency === 'monthly' && (
                <FormControl fullWidth disabled={readOnly}>
                  <InputLabel id="backup-monthday-label">Day of the month</InputLabel>
                  <Select
                    labelId="backup-monthday-label"
                    label="Day of the month"
                    value={draft.dayOfMonth ?? 1}
                    onChange={(e) => update('dayOfMonth', Number(e.target.value))}
                  >
                    {DAYS_OF_MONTH.map((d) => (
                      <MenuItem key={d} value={d}>
                        {d}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <Autocomplete
                options={timeZones}
                value={draft.timezone}
                onChange={(_, value) => value && update('timezone', value)}
                disableClearable
                disabled={readOnly}
                renderInput={(params) => <TextField {...params} label="Time zone" />}
              />

              <TextField
                label="Keep the last N backups"
                type="number"
                value={Number.isNaN(draft.keepCount) ? '' : draft.keepCount}
                onChange={(e) => update('keepCount', Number.parseInt(e.target.value, 10))}
                disabled={readOnly}
                fullWidth
                helperText={`Older backups are deleted after a successful run (${BACKUP_KEEP_MIN}-${BACKUP_KEEP_MAX})`}
                slotProps={{
                  htmlInput: { min: BACKUP_KEEP_MIN, max: BACKUP_KEEP_MAX, step: 1 }
                }}
              />
            </Box>

            <BackupContentsGroup
              value={scheduleContentSelection(draft)}
              onChange={(next) => {
                setDraft((d) => withScheduleContents(d, next));
                setSuccess(null);
              }}
              disabled={readOnly}
              showSystem
              summaryTestId="backup-schedule-contents-summary"
            />

            <Divider />

            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Backup password
              </Typography>
              {schedule.passwordConfigured ? (
                <Typography variant="body2" gutterBottom sx={{
                  color: "text.secondary"
                }}>
                  {passwordSetOn ? `Password set on ${passwordSetOn}` : 'Password set'}
                </Typography>
              ) : (
                <Typography variant="body2" gutterBottom sx={{
                  color: "text.secondary"
                }}>
                  No password set yet. Backups cannot run without one.
                </Typography>
              )}

              <Alert severity="warning" sx={{ my: 1 }}>
                {BACKUP_PASSWORD_LOSS_WARNING}
              </Alert>

              {!editingPassword ? (
                canWrite && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setEditingPassword(true)}
                    disabled={saving}
                  >
                    Change password
                  </Button>
                )
              ) : (
                <>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      gap: 2,
                      mt: 1,
                      mb: 1,
                    }}
                  >
                    <TextField
                      label={schedule.passwordConfigured ? 'New password' : 'Password'}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setSuccess(null);
                      }}
                      error={!!passwordError}
                      helperText={passwordError ?? 'At least 6 characters'}
                      autoComplete="new-password"
                      fullWidth
                      disabled={readOnly}
                      slotProps={{
                        input: { endAdornment: visibilityToggle },
                        htmlInput: { maxLength: BACKUP_PASSWORD_MAX_LENGTH }
                      }} />
                    <TextField
                      label="Confirm password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      error={!!confirmError}
                      helperText={confirmError ?? ' '}
                      autoComplete="new-password"
                      fullWidth
                      disabled={readOnly}
                      slotProps={{
                        htmlInput: { maxLength: BACKUP_PASSWORD_MAX_LENGTH }
                      }}
                    />
                  </Box>
                  <Stack direction="row" spacing={1} useFlexGap sx={{
                    flexWrap: "wrap"
                  }}>
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<AutoAwesomeIcon />}
                      onClick={handleSuggest}
                      disabled={readOnly}
                    >
                      Suggest one for me
                    </Button>
                    {schedule.passwordConfigured && (
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => resetPasswordFields(true)}
                        disabled={saving}
                      >
                        Keep current password
                      </Button>
                    )}
                  </Stack>
                  {showWeakWarning && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {BACKUP_PASSWORD_WARNING}
                    </Alert>
                  )}
                </>
              )}
            </Box>

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success" onClose={() => setSuccess(null)}>
                {success}
              </Alert>
            )}

            {canWrite && (
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={
                    saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />
                  }
                  disabled={saving}
                  aria-busy={saving}
                >
                  {saving ? 'Saving…' : 'Save schedule'}
                </Button>
              </Box>
            )}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Tab root
// =============================================================================

/**
 * Backups card of the Console (/admin/settings/backups): the scheduled-backup configuration,
 * "Run backup now (save to storage)", "Download a backup now" (streamed,
 * nothing stored) and the run history (system backups only; users' saved
 * backups are never listed here). Reading needs system_settings:read
 * (enforced by the page); every change, run, download and delete needs
 * system_settings:write, matching the API.
 */
export function ScheduledBackups() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('system_settings:write');

  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  /** Bumped to remount the form with a freshly loaded schedule. */
  const [formKey, setFormKey] = useState(0);

  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRun | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  /** Bumped each time the download dialog opens so it starts clean. */
  const [downloadKey, setDownloadKey] = useState(0);

  const loadSchedule = useCallback(async (resetForm: boolean) => {
    try {
      const next = await getBackupSchedule();
      setSchedule(next);
      setScheduleError(null);
      if (resetForm) setFormKey((k) => k + 1);
    } catch (err) {
      setScheduleError(errorMessage(err, 'Failed to load the backup schedule'));
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedule(true);
  }, [loadSchedule]);

  // Polls while a run is in progress; when it settles, refresh the schedule's
  // last/next run times without discarding unsaved form edits.
  const history = useBackupRunHistory(getBackupRuns, {
    onRunSettled: () => void loadSchedule(false),
  });
  const { hasRunning, reload: loadRuns } = history;

  const handleRunNow = async () => {
    setStarting(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await runBackupNow();
      setActionInfo('Backup started.');
      await history.showNewest();
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to start the backup'));
      await loadRuns();
    } finally {
      setStarting(false);
    }
  };

  const handleDownload = async (run: BackupRun) => {
    setBusyId(run.id);
    setActionError(null);
    try {
      const link = await getBackupDownloadUrl(run.id);
      startUrlDownload(link.url, link.fileName);
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to get the download link'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteBackupRun(deleteTarget.id);
      setActionInfo('Backup deleted.');
      setDeleteTarget(null);
      await loadRuns();
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to delete the backup'));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (scheduleLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!schedule) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void loadSchedule(true)}>
            Retry
          </Button>
        }
      >
        {scheduleError ?? 'Failed to load the backup schedule'}
      </Alert>
    );
  }

  const runDisabledReason = !schedule.storageConfigured
    ? 'Object storage is not configured.'
    : !schedule.passwordConfigured
      ? 'Save a backup password first.'
      : null;

  return (
    <Stack spacing={3}>
      {!canWrite && (
        <Alert severity="info">
          You can view backups but not change the schedule, run, download or delete them.
        </Alert>
      )}

      <BackupScheduleCard
        key={formKey}
        schedule={schedule}
        canWrite={canWrite}
        onSaved={setSchedule}
      />

      <Card variant="outlined">
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { xs: 'stretch', sm: 'center' },
              justifyContent: 'space-between',
              gap: 2,
              mb: 2,
            }}
          >
            <Typography variant="h6">Backup history</Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{
                justifyContent: "flex-end",
                flexWrap: "wrap"
              }}>
              <Tooltip title="Refresh">
                <IconButton aria-label="Refresh history" onClick={() => void loadRuns()}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              {canWrite && (
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={() => {
                    setDownloadKey((k) => k + 1);
                    setDownloadOpen(true);
                  }}
                >
                  Download a backup now
                </Button>
              )}
              {canWrite && (
                <Button
                  variant="contained"
                  startIcon={
                    starting || hasRunning ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : (
                      <PlayArrowIcon />
                    )
                  }
                  onClick={() => void handleRunNow()}
                  disabled={starting || hasRunning || runDisabledReason !== null}
                  aria-busy={starting || hasRunning}
                >
                  {hasRunning ? 'Backup running…' : 'Run backup now (save to storage)'}
                </Button>
              )}
            </Stack>
          </Box>

          {canWrite && runDisabledReason && (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 2
              }}>
              {runDisabledReason}
            </Typography>
          )}
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}
          {actionInfo && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setActionInfo(null)}>
              {actionInfo}
            </Alert>
          )}
          {history.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {history.error}
            </Alert>
          )}

          <BackupRunsTable
            runs={history.runs}
            total={history.total}
            page={history.page}
            rowsPerPage={history.rowsPerPage}
            loading={history.loading}
            showActions={canWrite}
            busyId={busyId}
            onPageChange={history.setPage}
            onRowsPerPageChange={history.setRowsPerPage}
            onDownload={(run) => void handleDownload(run)}
            onDelete={setDeleteTarget}
            ariaLabel="Backup history"
            emptyText="No backups yet."
            showAdminColumns
          />
        </CardContent>
      </Card>

      <DeleteBackupDialog
        target={deleteTarget}
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />

      {canWrite && (
        <AdminBackupDownloadDialog
          key={downloadKey}
          open={downloadOpen}
          onClose={() => setDownloadOpen(false)}
          onDownloaded={(message) => {
            setActionError(null);
            setActionInfo(message);
          }}
          passwordConfigured={schedule.passwordConfigured}
          initialContents={scheduleContentSelection(schedule)}
        />
      )}
    </Stack>
  );
}
