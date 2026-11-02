import { useEffect, useState, type FormEvent } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Alert,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Tooltip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  deleteMyBackup,
  downloadSecretsBackup,
  getMyBackupDownloadUrl,
  getMyBackups,
  getMyBackupsConfig,
  saveMyBackupToStorage,
} from '../../services/api';
import type { BackupRun, MyBackupsConfig } from '../../types';
import { saveBlobAsFile } from '../../utils/saveBlob';
import { StorageSettingsLink } from '../common/StorageSettingsLink';
import { validateBackupPassword } from '../../utils/backupPassword';
import {
  defaultBackupContents,
  toUserBackupRequest,
  validateBackupContents,
  type BackupContentSelection,
} from '../../utils/backupContents';
import { startUrlDownload } from '../../utils/backupSchedule';
import { useBackupRunHistory } from '../../hooks/useBackupRunHistory';
import { BackupContentsGroup } from './BackupContentsGroup';
import { BackupPasswordFields, type BackupPasswordValue } from './BackupPasswordFields';
import { BackupRunsTable, DeleteBackupDialog } from './BackupRunsTable';

export const BACKUP_SUCCESS_MESSAGE =
  'Backup downloaded. Write your password down — without it the file cannot be opened. There is no recovery.';

export const BACKUP_SAVE_STARTED_MESSAGE =
  'Backup started. It will appear in My saved backups below.';

export const BACKUP_STORAGE_NOT_CONFIGURED_HELPER =
  "Saving to storage isn't set up. Ask an administrator, or download the backup instead.";

/** Matches the API's USER_BACKUP_KEEP_COUNT, used until the config has loaded. */
export const DEFAULT_USER_BACKUP_KEEP_COUNT = 10;

export type BackupDestination = 'download' | 'storage';

const EMPTY_PASSWORD: BackupPasswordValue = { password: '', confirm: '' };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * "Back up my data" card: an AES-256 encrypted zip of what the current user
 * owns (secrets by default, optionally their media library), either
 * downloaded to this device or saved to the storage account, plus the list
 * of the user's saved backups. Rendering is gated by `secrets:read` at the
 * call site (`pages/settings/MyBackupsPage.tsx`, the My backups card).
 */
export function DataBackup() {
  const [passwordValue, setPasswordValue] = useState<BackupPasswordValue>(EMPTY_PASSWORD);
  /** Bumped to remount the password fields (hidden again) after a reset. */
  const [passwordKey, setPasswordKey] = useState(0);
  const [contents, setContents] = useState<BackupContentSelection>(defaultBackupContents);
  const [destination, setDestination] = useState<BackupDestination>('download');
  const [submitted, setSubmitted] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // A failed config request means storage is not offered; downloading still works.
  const [config, setConfig] = useState<MyBackupsConfig | null>(null);
  useEffect(() => {
    let active = true;
    getMyBackupsConfig()
      .then((c) => active && setConfig(c))
      .catch(() =>
        active &&
        setConfig({ storageConfigured: false, keepCount: DEFAULT_USER_BACKUP_KEEP_COUNT }),
      );
    return () => {
      active = false;
    };
  }, []);
  const storageConfigured = config?.storageConfigured === true;
  const keepCount = config?.keepCount ?? DEFAULT_USER_BACKUP_KEEP_COUNT;

  const history = useBackupRunHistory(getMyBackups, {
    errorFallback: 'Failed to load your saved backups',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listInfo, setListInfo] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRun | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { password, confirm } = passwordValue;
  const validationError = validateBackupPassword(password, confirm);
  const contentsError = validateBackupContents(contents);
  const toStorage = destination === 'storage';
  const saveBlockedByRun = toStorage && history.hasRunning;

  const clearPassword = () => {
    setPasswordValue(EMPTY_PASSWORD);
    setPasswordKey((k) => k + 1);
    setSubmitted(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setSuccess(null);
    if (validationError || contentsError) return;
    if (toStorage && !storageConfigured) return;

    setWorking(true);
    const body = { password, ...toUserBackupRequest(contents) };
    try {
      if (toStorage) {
        await saveMyBackupToStorage(body);
        clearPassword();
        setSuccess(BACKUP_SAVE_STARTED_MESSAGE);
        await history.showNewest();
      } else {
        const result = await downloadSecretsBackup(body);
        saveBlobAsFile(result.blob, result.filename);
        clearPassword();
        setSuccess(BACKUP_SUCCESS_MESSAGE);
      }
    } catch (err) {
      setError(
        errorMessage(err, toStorage ? 'Failed to start the backup' : 'Failed to create backup'),
      );
      if (toStorage) await history.reload();
    } finally {
      setWorking(false);
    }
  };

  const handleDownloadSaved = async (run: BackupRun) => {
    setBusyId(run.id);
    setListError(null);
    try {
      const link = await getMyBackupDownloadUrl(run.id);
      startUrlDownload(link.url, link.fileName);
    } catch (err) {
      setListError(errorMessage(err, 'Failed to get the download link'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setListError(null);
    setListInfo(null);
    try {
      await deleteMyBackup(deleteTarget.id);
      setListInfo('Backup deleted.');
      setDeleteTarget(null);
      await history.reload();
    } catch (err) {
      setListError(errorMessage(err, 'Failed to delete the backup'));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const busyLabel = toStorage ? 'Starting backup…' : 'Preparing backup…';
  const idleLabel = toStorage ? 'Save backup' : 'Download backup';
  const idleIcon = toStorage ? <CloudUploadIcon /> : <DownloadIcon />;
  const showSavedBackups = storageConfigured || history.runs.length > 0;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Back up my data
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            marginBottom: "16px"
          }}>
          Make a password-protected copy of your secrets and, if you choose, your media library.
          Download it to this device or save it to the storage account.
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          The file is an encrypted zip. To open it, use 7-Zip on Windows or Keka on Mac.
        </Alert>

        <Box component="form" noValidate onSubmit={handleSubmit}>
          <BackupPasswordFields
            key={passwordKey}
            value={passwordValue}
            onChange={(next) => {
              setPasswordValue(next);
              setSuccess(null);
            }}
            submitted={submitted}
            disabled={working}
          />

          <Box sx={{ mb: 2 }}>
            <BackupContentsGroup
              value={contents}
              onChange={(next) => {
                setContents(next);
                setSuccess(null);
              }}
              disabled={working}
            />
          </Box>

          <FormControl component="fieldset" disabled={working} sx={{ display: 'flex', mb: 2 }}>
            <FormLabel component="legend" id="backup-destination-label">
              Where should the backup go?
            </FormLabel>
            <RadioGroup
              aria-labelledby="backup-destination-label"
              name="backup-destination"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value as BackupDestination);
                setSuccess(null);
                setError(null);
              }}
            >
              <FormControlLabel
                value="download"
                control={<Radio />}
                label="Download to this device"
              />
              <FormControlLabel
                value="storage"
                control={<Radio />}
                label="Save to the storage account"
                disabled={working || !storageConfigured}
              />
            </RadioGroup>
            {config && !storageConfigured && (
              <FormHelperText data-testid="backup-storage-helper">
                {BACKUP_STORAGE_NOT_CONFIGURED_HELPER} <StorageSettingsLink />
              </FormHelperText>
            )}
            {toStorage && (
              <FormHelperText>
                Your password is used only to build the file and is never stored.
              </FormHelperText>
            )}
          </FormControl>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            startIcon={working ? <CircularProgress size={18} color="inherit" /> : idleIcon}
            disabled={working || contentsError !== null || saveBlockedByRun}
            aria-busy={working}
          >
            {working ? busyLabel : saveBlockedByRun ? 'Backup running…' : idleLabel}
          </Button>
        </Box>

        {showSavedBackups && (
          <Box component="section" aria-labelledby="my-saved-backups-heading" sx={{ mt: 3 }}>
            <Divider sx={{ mb: 2 }} />
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography variant="subtitle1" component="h3" id="my-saved-backups-heading">
                My saved backups
              </Typography>
              <Tooltip title="Refresh">
                <IconButton
                  aria-label="Refresh saved backups"
                  onClick={() => void history.reload()}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 1
              }}>
              Keeps your {keepCount} most recent saved backups
            </Typography>

            <Stack spacing={1} sx={{ mb: 1 }}>
              {listError && (
                <Alert severity="error" onClose={() => setListError(null)}>
                  {listError}
                </Alert>
              )}
              {listInfo && (
                <Alert severity="success" onClose={() => setListInfo(null)}>
                  {listInfo}
                </Alert>
              )}
              {history.error && <Alert severity="error">{history.error}</Alert>}
            </Stack>

            <BackupRunsTable
              runs={history.runs}
              total={history.total}
              page={history.page}
              rowsPerPage={history.rowsPerPage}
              loading={history.loading}
              showActions
              busyId={busyId}
              onPageChange={history.setPage}
              onRowsPerPageChange={history.setRowsPerPage}
              onDownload={(run) => void handleDownloadSaved(run)}
              onDelete={setDeleteTarget}
              ariaLabel="My saved backups"
              emptyText="No saved backups yet."
              downloadLabel="Download saved backup"
              deleteLabel="Delete saved backup"
            />
          </Box>
        )}

        <DeleteBackupDialog
          target={deleteTarget}
          deleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      </CardContent>
    </Card>
  );
}
