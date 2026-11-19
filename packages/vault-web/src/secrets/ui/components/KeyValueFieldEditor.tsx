import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  DeleteOutlined as RemoveIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import type { KeyValueEntry } from '../../../core/headless/types.js';
import { deriveEntryKey, type KeyValueSuggestion } from '../../headless/keyValue.js';

export interface KeyValueFieldEditorProps {
  /** The entries being edited. */
  value: KeyValueEntry[];
  onChange: (value: KeyValueEntry[]) => void;
  /** Entries offered as "Add: <label>" chips; one already present is not offered. */
  suggestions?: KeyValueSuggestion[];
  disabled?: boolean;
  /** A message for the whole field (shown under the rows). */
  error?: string;
  /** The field's label, shown as the heading. */
  label?: string;
  required?: boolean;
}

/**
 * Editor of a `keyvalue` field: one row per entry with its label, its value
 * (a password-style input with show/hide when the entry is sensitive), a
 * sensitive switch and a remove button. "Add detail" adds an empty row whose
 * key follows its label (snake_case, deduplicated with `_2`, `_3`, ...); a
 * suggestion chip adds a row with the suggested key, label and sensitive flag.
 * Rows stack below `sm` through responsive `sx`, without reading a breakpoint.
 */
export function KeyValueFieldEditor({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  error,
  label,
  required,
}: KeyValueFieldEditorProps) {
  // Rows added with "Add detail" keep their key in step with their label;
  // loaded and suggested rows keep the key they came with. Kept by index and
  // updated on add and remove; reset when the list is replaced from outside.
  const autoKeyed = useRef<boolean[]>([]);
  if (autoKeyed.current.length !== value.length) {
    autoKeyed.current = value.map(() => false);
  }
  const [visible, setVisible] = useState<Set<number>>(new Set());

  const taken = (except: number) => value.filter((_, i) => i !== except).map((row) => row.key);

  const update = (index: number, patch: Partial<KeyValueEntry>) => {
    const next = value.map((row, i) => {
      if (i !== index) return row;
      const updated = { ...row, ...patch };
      if (patch.label !== undefined && autoKeyed.current[i]) {
        updated.key = deriveEntryKey(patch.label, taken(i));
      }
      return updated;
    });
    onChange(next);
  };

  const add = (entry: KeyValueEntry, auto: boolean) => {
    autoKeyed.current = [...autoKeyed.current, auto];
    onChange([...value, entry]);
  };

  const remove = (index: number) => {
    autoKeyed.current = autoKeyed.current.filter((_, i) => i !== index);
    setVisible(new Set());
    onChange(value.filter((_, i) => i !== index));
  };

  const toggleVisible = (index: number) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const presentKeys = new Set(value.map((row) => row.key));
  const offered = suggestions.filter((s) => !presentKeys.has(s.key));

  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      {label && (
        <Typography
          component="legend"
          variant="subtitle2"
          sx={{ color: error ? 'error.main' : 'text.secondary', mb: 1, p: 0 }}
        >
          {label}
          {required && ' *'}
        </Typography>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {value.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No details yet.
          </Typography>
        )}
        {value.map((row, index) => {
          const name = row.label.trim() !== '' ? row.label.trim() : `detail ${index + 1}`;
          const shown = visible.has(index);
          return (
            <Box
              key={index}
              data-testid={`keyvalue-row-${index}`}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'flex-start' },
                gap: 1,
                p: { xs: 1.5, sm: 0 },
                border: { xs: 1, sm: 0 },
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <TextField
                label="Label"
                size="small"
                value={row.label}
                disabled={disabled}
                onChange={(e) => update(index, { label: e.target.value })}
                sx={{ flex: { sm: '1 1 30%' } }}
                slotProps={{ htmlInput: { 'aria-label': `Label of ${name}`, maxLength: 100 } }}
              />
              <TextField
                label="Value"
                size="small"
                value={row.value}
                disabled={disabled}
                type={row.sensitive && !shown ? 'password' : 'text'}
                onChange={(e) => update(index, { value: e.target.value })}
                sx={{ flex: { sm: '1 1 45%' } }}
                slotProps={{
                  htmlInput: { 'aria-label': `Value of ${name}`, maxLength: 2000 },
                  input: row.sensitive
                    ? {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              edge="end"
                              size="small"
                              disabled={disabled}
                              onClick={() => toggleVisible(index)}
                              aria-label={`${shown ? 'Hide' : 'Show'} ${name}`}
                            >
                              {shown ? <VisibilityOffIcon /> : <VisibilityIcon />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }
                    : undefined,
                }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexShrink: 0 }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Switch
                      size="small"
                      checked={row.sensitive}
                      disabled={disabled}
                      onChange={(e) => update(index, { sensitive: e.target.checked })}
                      slotProps={{ input: { 'aria-label': `${name} is sensitive` } }}
                    />
                  }
                  label="Sensitive"
                />
                <Tooltip title="Remove">
                  <span>
                    <IconButton
                      size="small"
                      disabled={disabled}
                      onClick={() => remove(index)}
                      aria-label={`Remove ${name}`}
                    >
                      <RemoveIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </Box>
          );
        })}
      </Box>

      {error && (
        <FormHelperText error sx={{ mx: 0 }}>
          {error}
        </FormHelperText>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={disabled}
          onClick={() => add({ key: '', label: '', value: '', sensitive: false }, true)}
        >
          Add detail
        </Button>
        {offered.map((suggestion) => (
          <Chip
            key={suggestion.key}
            size="small"
            variant="outlined"
            icon={<AddIcon />}
            label={`Add: ${suggestion.label}`}
            disabled={disabled}
            onClick={() =>
              add(
                {
                  key: suggestion.key,
                  label: suggestion.label,
                  value: '',
                  sensitive: suggestion.sensitive,
                },
                false,
              )
            }
          />
        ))}
      </Box>
    </Box>
  );
}
