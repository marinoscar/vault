import { useState } from 'react';
import {
  TextField,
  Typography,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  ErrorOutline as ErrorOutlineIcon,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { FieldDefinition } from '../../types';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import {
  formatCardNumberForCopy,
  formatSecurityCodeForCopy,
  formatExpiryMonthForCopy,
  formatExpiryYearShortForCopy,
} from '../../utils/cardFormat';

interface DynamicSecretFieldsProps {
  fields: FieldDefinition[];
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  readOnly?: boolean;
  errors?: Record<string, string>;
}

interface SensitiveDisplayProps {
  value: string;
  fieldName?: string;
}

interface CopyButtonProps {
  value: string;
  /**
   * Field name from the secret type definition. Card fields are reformatted on
   * copy so the value pastes cleanly into a checkout form.
   */
  fieldName?: string;
}

/**
 * Card fields whose stored value is reformatted before it reaches the
 * clipboard. Everything else copies verbatim.
 */
const CARD_COPY_FORMATTERS: Record<string, (value: unknown) => string> = {
  number: formatCardNumberForCopy,
  cvv: formatSecurityCodeForCopy,
  security_code_2: formatSecurityCodeForCopy,
  exp_month: formatExpiryMonthForCopy,
  exp_year: formatExpiryYearShortForCopy,
};

function formatForCopy(value: string, fieldName?: string): string {
  const formatter = fieldName ? CARD_COPY_FORMATTERS[fieldName] : undefined;
  if (!formatter) {
    return value;
  }
  const formatted = formatter(value);
  // Formatters return '' for values they cannot parse. Copying the stored value
  // is more useful than copying nothing, so fall back rather than no-op.
  return formatted === '' ? value : formatted;
}

function CopyButton({ value, fieldName }: CopyButtonProps) {
  const { copy, copied, failed } = useCopyToClipboard();

  const handleCopy = () => {
    // Deliberately reads `value` rather than any revealed/displayed text, so a
    // sensitive field can be copied without ever being shown on screen.
    void copy(formatForCopy(value, fieldName));
  };

  const title = copied ? 'Copied' : failed ? 'Copy failed' : 'Copy';

  return (
    <>
      <Tooltip title={title}>
        <IconButton size="small" onClick={handleCopy} aria-label="Copy to clipboard">
          {copied ? (
            <CheckIcon fontSize="small" color="success" />
          ) : failed ? (
            <ErrorOutlineIcon fontSize="small" color="error" />
          ) : (
            <CopyIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
      {/* Announce the outcome to assistive tech, which cannot see the icon swap. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {failed ? 'Copy failed. Clipboard is unavailable.' : ''}
      </Box>
    </>
  );
}

function SensitiveDisplay({ value, fieldName }: SensitiveDisplayProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {revealed ? (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {value}
        </Typography>
      ) : (
        <Chip
          label="••••••••"
          size="small"
          onClick={() => setRevealed(true)}
          sx={{ cursor: 'pointer', fontFamily: 'monospace' }}
        />
      )}
      {revealed && (
        <IconButton size="small" onClick={() => setRevealed(false)}>
          <VisibilityOffIcon fontSize="small" />
        </IconButton>
      )}
      <CopyButton value={value} fieldName={fieldName} />
    </Box>
  );
}

export function DynamicSecretFields({
  fields,
  data,
  onChange,
  readOnly = false,
  errors = {},
}: DynamicSecretFieldsProps) {
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  const toggleVisibility = (fieldName: string) => {
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) {
        next.delete(fieldName);
      } else {
        next.add(fieldName);
      }
      return next;
    });
  };

  const handleChange = (fieldName: string, value: unknown) => {
    onChange({ ...data, [fieldName]: value });
  };

  if (readOnly) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field) => {
          const rawValue = data[field.name];
          const value = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
          return (
            <Box key={field.name}>
              <Typography variant="caption" color="text.secondary" display="block">
                {field.label}
                {field.required && ' *'}
              </Typography>
              {value === '' ? (
                <Typography variant="body2" color="text.disabled">
                  —
                </Typography>
              ) : field.sensitive ? (
                <SensitiveDisplay value={value} fieldName={field.name} />
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {value}
                  </Typography>
                  <CopyButton value={value} fieldName={field.name} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {fields.map((field) => {
        const rawValue = data[field.name];
        const value = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
        const hasError = Boolean(errors[field.name]);

        if (field.type === 'string' && field.sensitive) {
          const isVisible = visibleFields.has(field.name);
          return (
            <TextField
              key={field.name}
              label={field.label}
              fullWidth
              required={field.required}
              type={isVisible ? 'text' : 'password'}
              value={value}
              onChange={(e) => handleChange(field.name, e.target.value)}
              error={hasError}
              helperText={errors[field.name]}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      edge="end"
                      onClick={() => toggleVisibility(field.name)}
                      size="small"
                      aria-label={isVisible ? 'Hide field' : 'Show field'}
                    >
                      {isVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          );
        }

        if (field.type === 'string') {
          const isMultiline = field.name === 'notes' || field.name === 'content';
          return (
            <TextField
              key={field.name}
              label={field.label}
              fullWidth
              required={field.required}
              multiline={isMultiline}
              minRows={isMultiline ? 3 : undefined}
              value={value}
              onChange={(e) => handleChange(field.name, e.target.value)}
              error={hasError}
              helperText={errors[field.name]}
            />
          );
        }

        if (field.type === 'number') {
          return (
            <TextField
              key={field.name}
              label={field.label}
              fullWidth
              required={field.required}
              type="number"
              value={value}
              onChange={(e) => handleChange(field.name, e.target.value)}
              error={hasError}
              helperText={errors[field.name]}
            />
          );
        }

        if (field.type === 'date') {
          return (
            <TextField
              key={field.name}
              label={field.label}
              fullWidth
              required={field.required}
              type="date"
              value={value}
              onChange={(e) => handleChange(field.name, e.target.value)}
              error={hasError}
              helperText={errors[field.name]}
              InputLabelProps={{ shrink: true }}
            />
          );
        }

        if (field.type === 'select') {
          const options = Array.isArray(field.options) ? field.options : [];
          const hasOptions = options.length > 0;
          // Keep a stored value that is no longer in `options` selectable/visible
          // so editing an unrelated field cannot silently drop it.
          const orphanValue = value !== '' && !options.includes(value) ? value : null;

          return (
            <TextField
              key={field.name}
              select
              label={field.label}
              fullWidth
              required={field.required}
              disabled={!hasOptions && orphanValue === null}
              value={value}
              onChange={(e) => handleChange(field.name, e.target.value)}
              error={hasError}
              helperText={
                errors[field.name] ?? (hasOptions ? undefined : 'No options are configured for this field')
              }
              InputLabelProps={{ shrink: true }}
              SelectProps={{ displayEmpty: true }}
            >
              {!field.required && (
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
              )}
              {orphanValue !== null && (
                <MenuItem key={orphanValue} value={orphanValue}>
                  {orphanValue}
                </MenuItem>
              )}
              {options.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          );
        }

        return null;
      })}
    </Box>
  );
}
