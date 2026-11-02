import { useId } from 'react';
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Typography,
} from '@mui/material';
import {
  BACKUP_CONTENT_LABELS,
  areSecretOptionsDisabled,
  describeBackupContents,
  effectiveBackupContents,
  validateBackupContents,
  type BackupContentKey,
  type BackupContentSelection,
} from '../../utils/backupContents';

export interface BackupContentsGroupProps {
  value: BackupContentSelection;
  onChange: (next: BackupContentSelection) => void;
  disabled?: boolean;
  /** Offer "System configuration" (admin schedule only). */
  showSystem?: boolean;
  /** Test id of the summary line. */
  summaryTestId?: string;
}

/**
 * "What to back up" checkbox group: Secrets with nested (indented)
 * attachments / old versions, Media library and, for the admin schedule,
 * System configuration. Shows a summary line and the nothing-selected
 * message; the parent blocks submit with `validateBackupContents`.
 */
export function BackupContentsGroup({
  value,
  onChange,
  disabled = false,
  showSystem = false,
  summaryTestId = 'backup-contents-summary',
}: BackupContentsGroupProps) {
  const labelId = useId();
  const nestedDisabled = disabled || areSecretOptionsDisabled(value);
  const effective = effectiveBackupContents(value);
  const error = validateBackupContents(value);

  const toggle = (key: BackupContentKey) => (_: unknown, checked: boolean) =>
    onChange({ ...value, [key]: checked });

  const box = (key: BackupContentKey, checked: boolean, isDisabled: boolean) => (
    <Checkbox checked={checked} onChange={toggle(key)} disabled={isDisabled} />
  );

  return (
    <FormControl component="fieldset" error={!!error} disabled={disabled} sx={{ display: 'flex' }}>
      <FormLabel component="legend" id={labelId}>
        What to back up
      </FormLabel>
      <FormGroup aria-labelledby={labelId}>
        <FormControlLabel
          control={box('secrets', value.secrets, disabled)}
          label={BACKUP_CONTENT_LABELS.secrets}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', pl: { xs: 3, sm: 4 } }}>
          <FormControlLabel
            control={box('attachments', effective.attachments, nestedDisabled)}
            label={BACKUP_CONTENT_LABELS.attachments}
          />
          <FormControlLabel
            control={box('versions', effective.versions, nestedDisabled)}
            label={BACKUP_CONTENT_LABELS.versions}
          />
        </Box>
        <FormControlLabel
          control={box('media', value.media, disabled)}
          label={BACKUP_CONTENT_LABELS.media}
        />
        {showSystem && (
          <FormControlLabel
            control={box('system', value.system, disabled)}
            label={BACKUP_CONTENT_LABELS.system}
          />
        )}
      </FormGroup>
      {error ? (
        <FormHelperText>{error}</FormHelperText>
      ) : (
        <Typography variant="body2" color="text.secondary" data-testid={summaryTestId}>
          {describeBackupContents(value)}
        </Typography>
      )}
    </FormControl>
  );
}
