import { useState, type FormEvent } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Alert,
  CircularProgress,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DownloadIcon from '@mui/icons-material/Download';
import { downloadSecretsBackup } from '../../services/api';
import { saveBlobAsFile } from '../../utils/saveBlob';
import {
  BACKUP_PASSWORD_MAX_LENGTH,
  BACKUP_PASSWORD_WARNING,
  shouldWarnBackupPassword,
  suggestBackupPassword,
  validateBackupPassword,
} from '../../utils/backupPassword';
import {
  defaultBackupContents,
  toUserBackupRequest,
  validateBackupContents,
  type BackupContentSelection,
} from '../../utils/backupContents';
import { BackupContentsGroup } from './BackupContentsGroup';

export const BACKUP_SUCCESS_MESSAGE =
  'Backup downloaded. Write your password down — without it the file cannot be opened. There is no recovery.';

/**
 * "Back up my data" card: downloads an AES-256 encrypted zip of what the
 * current user owns (secrets by default, optionally their media library). Rendering is gated by `secrets:read` at the call
 * site (UserSettingsPage).
 */
export function DataBackup() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [contents, setContents] = useState<BackupContentSelection>(defaultBackupContents);
  const [submitted, setSubmitted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const validationError = validateBackupPassword(password, confirm);
  const showValidation = submitted && validationError !== null;
  const passwordError =
    showValidation && validationError !== 'Passwords do not match' ? validationError : null;
  const mismatch = password !== confirm && (confirm.length > 0 || submitted);
  const confirmError = mismatch && !passwordError ? 'Passwords do not match' : null;
  const showWarning = shouldWarnBackupPassword(password);
  const contentsError = validateBackupContents(contents);

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
    if (validationError || contentsError) return;

    setDownloading(true);
    try {
      const result = await downloadSecretsBackup({
        password,
        ...toUserBackupRequest(contents),
      });
      saveBlobAsFile(result.blob, result.filename);
      setPassword('');
      setConfirm('');
      setShowPassword(false);
      setSubmitted(false);
      setSuccess(BACKUP_SUCCESS_MESSAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setDownloading(false);
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

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Back up my data
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Download a password-protected copy of your secrets and, if you choose, your media
          library.
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          The file is an encrypted zip. To open it, use 7-Zip on Windows or Keka on Mac.
        </Alert>

        <Box component="form" noValidate onSubmit={handleSubmit}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 2,
              mb: 1,
            }}
          >
            <TextField
              label="Password"
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
              disabled={downloading}
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
              disabled={downloading}
              inputProps={{ maxLength: BACKUP_PASSWORD_MAX_LENGTH }}
            />
          </Box>

          <Button
            variant="text"
            size="small"
            startIcon={<AutoAwesomeIcon />}
            onClick={handleSuggest}
            disabled={downloading}
            sx={{ mb: 1 }}
          >
            Suggest one for me
          </Button>

          {showWarning && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {BACKUP_PASSWORD_WARNING}
            </Alert>
          )}

          <Box sx={{ mb: 2 }}>
            <BackupContentsGroup
              value={contents}
              onChange={(next) => {
                setContents(next);
                setSuccess(null);
              }}
              disabled={downloading}
            />
          </Box>

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
            startIcon={
              downloading ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />
            }
            disabled={downloading || contentsError !== null}
            aria-busy={downloading}
          >
            {downloading ? 'Preparing backup…' : 'Download backup'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
