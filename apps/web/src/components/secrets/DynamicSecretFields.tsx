import { useState } from 'react';
import {
  TextField,
  Typography,
  Box,
  Chip,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import type { FieldDefinition } from '../../types';

interface DynamicSecretFieldsProps {
  fields: FieldDefinition[];
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  readOnly?: boolean;
  errors?: Record<string, string>;
}

interface SensitiveDisplayProps {
  value: string;
}

function SensitiveDisplay({ value }: SensitiveDisplayProps) {
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
                <SensitiveDisplay value={value} />
              ) : (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {value}
                </Typography>
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

        return null;
      })}
    </Box>
  );
}
