import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePermissions } from '../../hooks/usePermissions';
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
  BackupRunStatus,
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
  formatBytes,
  formatDateTime,
  getBrowserTimeZone,
  getTimeZoneOptions,
  normalizeScheduleFields,
  startUrlDownload,
  validateScheduleFields,
} from '../../utils/backupSchedule';

/** How often the history is refreshed while a run is in progress. */
export const BACKUP_POLL_INTERVAL_MS = 5000;

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
    includeAttachments: schedule.includeAttachments,
    includeVersions: schedule.includeVersions,
  };
}

const STATUS_CHIP: Record<BackupRunStatus, { label: string; color: 'info' | 'success' | 'error' }> =
  {
    running: { label: 'Running', color: 'info' },
    succeeded: { label: 'Succeeded', color: 'success' },
    failed: { label: 'Failed', color: 'error' },
  };

function RunStatusChip({ run }: { run: BackupRun }) {
  const { label, color } = STATUS_CHIP[run.status] ?? STATUS_CHIP.failed;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <Chip
        size="small"
        label={label}
        color={color}
        icon={run.status === 'running' ? <CircularProgress size={12} color="inherit" /> : undefined}
      />
      {run.deletedAt && <Chip size="small" label="Deleted" variant="outlined" />}
      {run.warningCount > 0 && (
        <Chip
          size="small"
          variant="outlined"
          color="warning"
          label={`${run.warningCount} warning${run.warningCount === 1 ? '' : 's'}`}
        />
      )}
    </Stack>
  );
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
        <Typography variant="body2" color="text.secondary" paragraph>
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
              <Typography variant="body2" color="text.secondary" data-testid="backup-summary">
                {describeBackupSchedule(normalizeScheduleFields(draft))}
              </Typography>
              <Typography variant="body2" color="text.secondary">
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
                </FormControl>
              ) : (
                <TextField
                  label="Time"
                  type="time"
                  value={draft.timeOfDay}
                  onChange={(e) => update('timeOfDay', e.target.value)}
                  disabled={readOnly}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ step: 60 }}
                />
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
                inputProps={{ min: BACKUP_KEEP_MIN, max: BACKUP_KEEP_MAX, step: 1 }}
                helperText={`Older backups are deleted after a successful run (${BACKUP_KEEP_MIN}-${BACKUP_KEEP_MAX})`}
              />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={draft.includeAttachments}
                    onChange={(e) => update('includeAttachments', e.target.checked)}
                    disabled={readOnly}
                  />
                }
                label="Include attachments"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={draft.includeVersions}
                    onChange={(e) => update('includeVersions', e.target.checked)}
                    disabled={readOnly}
                  />
                }
                label="Include old versions"
              />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Backup password
              </Typography>
              {schedule.passwordConfigured ? (
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {passwordSetOn ? `Password set on ${passwordSetOn}` : 'Password set'}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" gutterBottom>
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
                      inputProps={{ maxLength: BACKUP_PASSWORD_MAX_LENGTH }}
                      InputProps={{ endAdornment: visibilityToggle }}
                    />
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
                      inputProps={{ maxLength: BACKUP_PASSWORD_MAX_LENGTH }}
                    />
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
// History
// =============================================================================

interface HistoryProps {
  runs: BackupRun[];
  total: number;
  page: number;
  rowsPerPage: number;
  loading: boolean;
  canWrite: boolean;
  busyId: string | null;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  onDownload: (run: BackupRun) => void;
  onDelete: (run: BackupRun) => void;
}

function BackupHistory({
  runs,
  total,
  page,
  rowsPerPage,
  loading,
  canWrite,
  busyId,
  onPageChange,
  onRowsPerPageChange,
  onDownload,
  onDelete,
}: HistoryProps) {
  if (loading && runs.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (runs.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        No backups yet.
      </Typography>
    );
  }

  return (
    <>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label="Backup history">
          <TableHead>
            <TableRow>
              <TableCell>Started</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Trigger</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Size</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                Users / Secrets / Attachments
              </TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(run.startedAt) ?? '—'}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  {run.trigger === 'manual' ? 'Manual' : 'Scheduled'}
                  {run.trigger === 'manual' && run.triggeredBy && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {run.triggeredBy.displayName || run.triggeredBy.email}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <RunStatusChip run={run} />
                  {run.error && (
                    <Typography
                      variant="caption"
                      color="error"
                      display="block"
                      sx={{ mt: 0.5, maxWidth: 280, wordBreak: 'break-word' }}
                    >
                      {run.error}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatBytes(run.sizeBytes)}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  {run.userCount} / {run.secretCount} / {run.attachmentCount}
                </TableCell>
                {canWrite && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Download">
                      <span>
                        <IconButton
                          aria-label="Download backup"
                          size="small"
                          onClick={() => onDownload(run)}
                          disabled={!run.downloadable || busyId === run.id}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <span>
                        <IconButton
                          aria-label="Delete backup"
                          size="small"
                          onClick={() => onDelete(run)}
                          disabled={
                            run.status === 'running' || !!run.deletedAt || busyId === run.id
                          }
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, p) => onPageChange(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => onRowsPerPageChange(Number.parseInt(e.target.value, 10))}
        rowsPerPageOptions={[10, 20, 50]}
      />
    </>
  );
}

// =============================================================================
// Tab root
// =============================================================================

/**
 * "Backups" tab of /admin/settings: the scheduled-backup configuration,
 * "Run backup now" and the run history. Reading needs system_settings:read
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

  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRun | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const loadRuns = useCallback(async () => {
    try {
      const res = await getBackupRuns({ page: page + 1, pageSize: rowsPerPage });
      setRuns(res.items);
      setTotal(res.total);
      setRunsError(null);
    } catch (err) {
      setRunsError(errorMessage(err, 'Failed to load backup history'));
    } finally {
      setRunsLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    void loadSchedule(true);
  }, [loadSchedule]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const hasRunning = runs.some((r) => r.status === 'running');

  // Poll while a run is in progress; when it settles, refresh the schedule's
  // last/next run times without discarding unsaved form edits.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !hasRunning) void loadSchedule(false);
    wasRunning.current = hasRunning;
    if (!hasRunning) return undefined;
    const timer = setInterval(() => void loadRuns(), BACKUP_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, loadRuns, loadSchedule]);

  const handleRunNow = async () => {
    setStarting(true);
    setActionError(null);
    setActionInfo(null);
    try {
      await runBackupNow();
      setActionInfo('Backup started.');
      if (page !== 0) setPage(0);
      else await loadRuns();
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
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Tooltip title="Refresh">
                <IconButton aria-label="Refresh history" onClick={() => void loadRuns()}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
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
                  {hasRunning ? 'Backup running…' : 'Run backup now'}
                </Button>
              )}
            </Stack>
          </Box>

          {canWrite && runDisabledReason && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
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
          {runsError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {runsError}
            </Alert>
          )}

          <BackupHistory
            runs={runs}
            total={total}
            page={page}
            rowsPerPage={rowsPerPage}
            loading={runsLoading}
            canWrite={canWrite}
            busyId={busyId}
            onPageChange={setPage}
            onRowsPerPageChange={(rows) => {
              setRowsPerPage(rows);
              setPage(0);
            }}
            onDownload={(run) => void handleDownload(run)}
            onDelete={setDeleteTarget}
          />
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>Delete this backup?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The backup from {formatDateTime(deleteTarget?.startedAt) ?? 'this run'} will be
            removed from storage. This cannot be undone. The entry stays in the history.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleConfirmDelete()}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
