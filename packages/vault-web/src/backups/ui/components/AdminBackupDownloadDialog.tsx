import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Stack,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { downloadAdminBackup } from '../../../core/headless/api.js';
import { saveBlobAsFile } from '../../../core/headless/saveBlob.js';
import { validateBackupPassword } from '../../headless/backupPassword.js';
import {
  toBackupContentFlags,
  validateBackupContents,
  type BackupContentSelection,
} from '../../headless/backupContents.js';
import { BackupContentsGroup } from './BackupContentsGroup.js';
import {
  BackupPasswordFields,
  type BackupPasswordValue,
} from './BackupPasswordFields.js';

export const ADMIN_BACKUP_DOWNLOADED_MESSAGE =
  'Backup downloaded. Nothing was stored. Keep the password safe: without it the file cannot be opened.';

export const USE_SCHEDULED_PASSWORD_LABEL = 'Use the scheduled backup password';

export interface AdminBackupDownloadDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the zip was handed to the browser, with a message to show. */
  onDownloaded: (message: string) => void;
  /** Offer "Use the scheduled backup password" (one is stored). */
  passwordConfigured: boolean;
  /** Starting selection (the schedule's contents). */
  initialContents: BackupContentSelection;
}

/**
 * "Download a backup now": choose contents (including System
 * configuration), enter a password or use the stored schedule password, and
 * the zip streams to the browser. Nothing is stored on the server. Mount it
 * with a new `key` each time it opens so it starts clean.
 */
export function AdminBackupDownloadDialog({
  open,
  onClose,
  onDownloaded,
  passwordConfigured,
  initialContents,
}: AdminBackupDownloadDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [contents, setContents] = useState<BackupContentSelection>(initialContents);
  const [passwordValue, setPasswordValue] = useState<BackupPasswordValue>({
    password: '',
    confirm: '',
  });
  const [useScheduled, setUseScheduled] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingScheduled = passwordConfigured && useScheduled;
  const passwordError = usingScheduled
    ? null
    : validateBackupPassword(passwordValue.password, passwordValue.confirm);
  const contentsError = validateBackupContents(contents);

  const close = () => {
    if (!downloading) onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (passwordError || contentsError) return;

    setDownloading(true);
    try {
      const flags = toBackupContentFlags(contents);
      const result = await downloadAdminBackup(
        usingScheduled
          ? { useScheduledPassword: true, ...flags }
          : { password: passwordValue.password, ...flags },
      );
      saveBlobAsFile(result.blob, result.filename);
      setPasswordValue({ password: '', confirm: '' });
      onDownloaded(ADMIN_BACKUP_DOWNLOADED_MESSAGE);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to create the backup');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      aria-labelledby="admin-backup-download-title"
    >
      <Box component="form" noValidate onSubmit={handleSubmit}>
        <DialogTitle id="admin-backup-download-title">Download a backup now</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Build a password-protected (AES-256) zip now and download it to this device. Nothing
            is stored on the server. Open it with 7-Zip on Windows or Keka on Mac.
          </DialogContentText>

          <Stack spacing={2}>
            <BackupContentsGroup
              value={contents}
              onChange={setContents}
              disabled={downloading}
              showSystem
              summaryTestId="admin-backup-download-contents-summary"
            />

            <Box>
              {passwordConfigured && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={useScheduled}
                      onChange={(_, checked) => setUseScheduled(checked)}
                      disabled={downloading}
                    />
                  }
                  label={USE_SCHEDULED_PASSWORD_LABEL}
                  sx={{ mb: 1 }}
                />
              )}
              {!usingScheduled && (
                <BackupPasswordFields
                  value={passwordValue}
                  onChange={setPasswordValue}
                  submitted={submitted}
                  disabled={downloading}
                />
              )}
            </Box>

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={downloading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            startIcon={
              downloading ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />
            }
            disabled={downloading || contentsError !== null}
            aria-busy={downloading}
          >
            {downloading ? 'Preparing backup…' : 'Download'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
