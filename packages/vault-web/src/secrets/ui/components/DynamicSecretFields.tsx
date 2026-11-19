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
  ErrorOutlineOutlined as ErrorOutlineIcon,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { FieldDefinition } from '../../../core/headless/types.js';
import { useCopyToClipboard } from '../../../core/headless/useCopyToClipboard.js';
import { TOTP_FIELD_NAME, formatSecretValueForCopy } from '../../headless/secretFields.js';
import { toKeyValueEntries, type KeyValueSuggestion } from '../../headless/keyValue.js';
import { formatCountryValue } from '../../headless/country.js';
import { KeyValueFieldEditor } from './KeyValueFieldEditor.js';
import { CountryField } from './CountryField.js';

interface DynamicSecretFieldsProps {
  fields: FieldDefinition[];
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  readOnly?: boolean;
  errors?: Record<string, string>;
  /** "Add: <label>" suggestions of a `keyvalue` field, by field name. */
  keyValueSuggestions?: Record<string, KeyValueSuggestion[]>;
}

/** A multi-line input: `format: 'multiline'`, or the legacy `notes` and `content` names. */
function isMultilineField(field: FieldDefinition): boolean {
  return field.format === 'multiline' || field.name === 'notes' || field.name === 'content';
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

function CopyButton({ value, fieldName }: CopyButtonProps) {
  const { copy, copied, failed } = useCopyToClipboard();

  const handleCopy = () => {
    // Deliberately reads `value` rather than any revealed/displayed text, so a
    // sensitive field can be copied without ever being shown on screen.
    void copy(formatSecretValueForCopy(value, fieldName));
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
  keyValueSuggestions = {},
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
          if (field.type === 'keyvalue') {
            const entries = toKeyValueEntries(rawValue);
            return (
              <Box key={field.name}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {field.label}
                  {field.required && ' *'}
                </Typography>
                {entries.length === 0 ? (
                  <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                    —
                  </Typography>
                ) : (
                  <Box component="ul" aria-label={field.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {entries.map((entry, index) => (
                      <Box
                        component="li"
                        key={entry.key || index}
                        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, py: 0.5 }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {entry.label}
                        </Typography>
                        {entry.sensitive && <Chip label="Sensitive" size="small" variant="outlined" />}
                        {entry.value === '' ? (
                          <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                            —
                          </Typography>
                        ) : entry.sensitive ? (
                          <SensitiveDisplay value={entry.value} />
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                              {entry.value}
                            </Typography>
                            <CopyButton value={entry.value} />
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          }
          const value = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
          const display = field.format === 'country' ? formatCountryValue(value) : value;
          return (
            <Box key={field.name}>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: "block"
                }}>
                {field.label}
                {field.required && ' *'}
              </Typography>
              {value === '' ? (
                <Typography variant="body2" sx={{
                  color: "text.disabled"
                }}>
                  —
                </Typography>
              ) : field.sensitive ? (
                <SensitiveDisplay value={value} fieldName={field.name} />
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {display}
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
        const hasError = Boolean(errors[field.name]);

        if (field.type === 'keyvalue') {
          return (
            <KeyValueFieldEditor
              key={field.name}
              label={field.label}
              required={field.required}
              value={toKeyValueEntries(rawValue)}
              onChange={(entries) => handleChange(field.name, entries)}
              suggestions={keyValueSuggestions[field.name]}
              error={errors[field.name]}
            />
          );
        }

        const value = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';

        if (field.type === 'string' && field.format === 'country') {
          return (
            <CountryField
              key={field.name}
              label={field.label}
              required={field.required}
              value={value}
              onChange={(code) => handleChange(field.name, code)}
              error={hasError}
              helperText={errors[field.name]}
            />
          );
        }

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
              helperText={
                errors[field.name] ??
                (field.name === TOTP_FIELD_NAME ? 'Optional. The setup key or otpauth:// link from the site.' : undefined)
              }
              slotProps={{
                input: {
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
                }
              }}
            />
          );
        }

        if (field.type === 'string') {
          const isMultiline = isMultilineField(field);
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
              slotProps={{
                inputLabel: { shrink: true }
              }}
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
              slotProps={{
                select: { displayEmpty: true },
                inputLabel: { shrink: true }
              }}>
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
