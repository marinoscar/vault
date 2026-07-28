import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';

import type { FieldDefinition } from '../../types';
import { CardFieldDiff } from './CardFieldDiff';

interface CardReviewFormProps {
  /** Field definitions from the Card secret type, rendered in order. */
  fields: FieldDefinition[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  /** Field names the model was unsure about. */
  lowConfidenceFields?: Set<string>;
  /** Warnings returned by the extraction, rendered above the form. */
  warnings?: string[];
  errors?: Record<string, string>;
  disabled?: boolean;
  /**
   * The outgoing version's values, turning this into a diff.
   *
   * Supplied only by the renewal flow. When present, each field gains a
   * before/after line showing what changes and what stays — the review step of
   * a renewal is a comparison against a card the user already holds, not a
   * first look at values. Absent for import, where there is nothing to compare
   * against and the form renders exactly as it always has.
   */
  currentValues?: Record<string, string>;
  /**
   * Field whose current value is deliberately never carried forward (the CVV).
   * Its diff line explains the absence instead of showing an empty comparison.
   */
  notCarriedForwardField?: string;
}

/**
 * The CVV is read from the photo like every other field, but it is the field
 * most worth checking by hand.
 *
 * It is required (`POST /api/secrets` rejects a card without one), it is three
 * or four characters with no checksum behind it — unlike the PAN, where Luhn
 * catches a misread — and the cost of a wrong one surfaces at a payment
 * terminal months later. So it gets its own helper text in both states: a
 * prompt to type it when the model found nothing, and a prompt to verify it
 * when the model did.
 */
const CVV_FIELD = 'cvv';

const CVV_EMPTY_HELPER =
  'Not read from the photo — type it from the card. Required.';
const CVV_READ_HELPER = 'Read from the photo — check it against the card.';
const LOW_CONFIDENCE_HELPER =
  'The photo was hard to read here. Check this against the card.';

/**
 * Editable review of the extracted card, plus the fields the extraction could
 * not supply.
 *
 * Every value is editable and nothing is trusted: the model's output is a
 * starting point the user confirms, which is also why this renders identically
 * when the extraction failed outright and all the values are empty.
 */
export function CardReviewForm({
  fields,
  values,
  onChange,
  lowConfidenceFields,
  warnings = [],
  errors = {},
  disabled = false,
  currentValues,
  notCarriedForwardField,
}: CardReviewFormProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggleReveal = (name: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <Box>
      {warnings.length > 0 && (
        <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
          <AlertTitle>Check these before saving</AlertTitle>
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            {warnings.map((warning) => (
              <li key={warning}>
                <Typography variant="body2">{warning}</Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}

      <Stack spacing={2}>
        {fields.map((field) => {
          const value = values[field.name] ?? '';
          const error = errors[field.name];
          const isLowConfidence = lowConfidenceFields?.has(field.name) ?? false;
          const isCvv = field.name === CVV_FIELD;

          // An empty CVV outranks the low-confidence hint: "type it from the
          // card" is actionable, "check this against the card" is not when
          // there is nothing in the box to check.
          const helperText =
            error ??
            (isCvv && !value
              ? CVV_EMPTY_HELPER
              : isLowConfidence
                ? LOW_CONFIDENCE_HELPER
                : isCvv
                  ? CVV_READ_HELPER
                  : undefined);

          // A low-confidence field is not an error — the value may well be
          // right — so it is tinted rather than marked invalid, which keeps the
          // red reserved for things that actually block saving.
          const warningSx =
            !error && isLowConfidence
              ? {
                  '& .MuiFormHelperText-root': { color: 'warning.main' },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main' },
                }
              : undefined;

          const label = (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              {field.label}
              {isLowConfidence && (
                <Chip
                  label="Check"
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ height: 18, fontSize: 11 }}
                />
              )}
            </Box>
          );

          // Built as a value rather than returned directly so the renewal diff
          // can be appended beneath it without duplicating all three branches.
          const input = (() => {
            if (field.type === 'select') {
              const options = Array.isArray(field.options) ? field.options : [];
              // Keep an extracted value that is not a configured option visible
              // rather than silently dropping it on first render.
              const orphan = value !== '' && !options.includes(value) ? value : null;

              return (
                <TextField
                  key={field.name}
                  select
                  fullWidth
                  label={label}
                  required={field.required}
                  value={value}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  error={Boolean(error)}
                  helperText={helperText}
                  disabled={disabled}
                  sx={warningSx}
                  InputLabelProps={{ shrink: true }}
                  SelectProps={{ displayEmpty: true }}
                >
                  {!field.required && (
                    <MenuItem value="">
                      <em>None</em>
                    </MenuItem>
                  )}
                  {orphan !== null && (
                    <MenuItem value={orphan}>{orphan}</MenuItem>
                  )}
                  {options.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              );
            }

            if (field.sensitive) {
              const isRevealed = revealed.has(field.name);
              return (
                <TextField
                  key={field.name}
                  fullWidth
                  label={label}
                  required={field.required}
                  type={isRevealed ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  error={Boolean(error)}
                  helperText={helperText}
                  disabled={disabled}
                  sx={warningSx}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => toggleReveal(field.name)}
                          aria-label={
                            isRevealed ? `Hide ${field.label}` : `Show ${field.label}`
                          }
                        >
                          {isRevealed ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              );
            }

            return (
              <TextField
                key={field.name}
                fullWidth
                label={label}
                required={field.required}
                multiline={field.name === 'notes'}
                minRows={field.name === 'notes' ? 2 : undefined}
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                error={Boolean(error)}
                helperText={helperText}
                disabled={disabled}
                sx={warningSx}
              />
            );
          })();

          // Import passes no `currentValues`, so its markup is unchanged: the
          // TextField is returned exactly as before, with the key on it.
          if (!currentValues) return input;

          return (
            <Box key={field.name}>
              {input}
              <CardFieldDiff
                field={field}
                current={currentValues[field.name] ?? ''}
                proposed={value}
                changed={
                  field.name === notCarriedForwardField
                    ? value.trim() !== ''
                    : value.trim() !== (currentValues[field.name] ?? '').trim()
                }
                notCarriedForward={field.name === notCarriedForwardField}
              />
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
