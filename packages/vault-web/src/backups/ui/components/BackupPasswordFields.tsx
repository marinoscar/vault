import { useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, TextField } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import {
  BACKUP_PASSWORD_MAX_LENGTH,
  BACKUP_PASSWORD_WARNING,
  shouldWarnBackupPassword,
  suggestBackupPassword,
  validateBackupPassword,
} from '../../headless/backupPassword.js';

export interface BackupPasswordValue {
  password: string;
  confirm: string;
}

export interface BackupPasswordFieldsProps {
  value: BackupPasswordValue;
  onChange: (next: BackupPasswordValue) => void;
  /** Show blocking validation (after the first submit). */
  submitted: boolean;
  disabled?: boolean;
}

/**
 * Password + confirmation for a backup zip, with show/hide, "Suggest one for
 * me" (a three-word phrase, revealed) and the soft weak-password warning.
 * The parent blocks submit with `validateBackupPassword`; remount it (a new
 * `key`) to hide the password again after a reset.
 */
export function BackupPasswordFields({
  value,
  onChange,
  submitted,
  disabled = false,
}: BackupPasswordFieldsProps) {
  const { password, confirm } = value;
  const [showPassword, setShowPassword] = useState(false);

  const validationError = validateBackupPassword(password, confirm);
  const passwordError =
    submitted && validationError !== null && validationError !== 'Passwords do not match'
      ? validationError
      : null;
  const mismatch = password !== confirm && (confirm.length > 0 || submitted);
  const confirmError = mismatch && !passwordError ? 'Passwords do not match' : null;

  const handleSuggest = () => {
    const suggestion = suggestBackupPassword();
    onChange({ password: suggestion, confirm: suggestion });
    setShowPassword(true);
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
    <>
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
          onChange={(e) => onChange({ password: e.target.value, confirm })}
          error={!!passwordError}
          helperText={passwordError ?? 'At least 6 characters'}
          autoComplete="new-password"
          fullWidth
          disabled={disabled}
          slotProps={{
            input: { endAdornment: visibilityToggle },
            htmlInput: { maxLength: BACKUP_PASSWORD_MAX_LENGTH }
          }} />
        <TextField
          label="Confirm password"
          type={showPassword ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => onChange({ password, confirm: e.target.value })}
          error={!!confirmError}
          helperText={confirmError ?? ' '}
          autoComplete="new-password"
          fullWidth
          disabled={disabled}
          slotProps={{
            htmlInput: { maxLength: BACKUP_PASSWORD_MAX_LENGTH }
          }}
        />
      </Box>

      <Button
        variant="text"
        size="small"
        startIcon={<AutoAwesomeIcon />}
        onClick={handleSuggest}
        disabled={disabled}
        sx={{ mb: 1 }}
      >
        Suggest one for me
      </Button>

      {shouldWarnBackupPassword(password) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {BACKUP_PASSWORD_WARNING}
        </Alert>
      )}
    </>
  );
}
