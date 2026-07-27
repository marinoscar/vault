import { useEffect, useRef, useState } from 'react';
import {
  Box,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  IconButton,
  Typography,
  Chip,
  Button,
  Paper,
  Alert,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import type { FieldDefinition } from '../../types';
import { FieldOptionsEditor } from './FieldOptionsEditor';
import {
  validateFieldDefinitions,
  validateFieldOptions,
} from './fieldOptionsValidation';

interface FieldDefinitionBuilderProps {
  fields: FieldDefinition[];
  onChange: (fields: FieldDefinition[]) => void;
  /**
   * Called whenever the validity of the field definitions changes, so a parent
   * can disable its save action. Parents that do not use it are still safe:
   * the builder blocks submission of its enclosing form while invalid.
   */
  onValidityChange?: (isValid: boolean) => void;
}

const FIELD_TYPES: { value: FieldDefinition['type']; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select (list)' },
];

function labelToName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function uniqueName(base: string, existingNames: string[], selfIndex: number): string {
  const others = existingNames.filter((_, i) => i !== selfIndex);
  if (!others.includes(base)) return base;
  let counter = 2;
  while (others.includes(`${base}_${counter}`)) {
    counter++;
  }
  return `${base}_${counter}`;
}

export function FieldDefinitionBuilder({
  fields,
  onChange,
  onValidityChange,
}: FieldDefinitionBuilderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const validationError = validateFieldDefinitions(fields);

  // The builder is embedded in forms it does not own (create page, edit page,
  // dialog) whose submit handlers post `fields` straight to the API. Guard the
  // enclosing form here so an invalid option list can never be submitted,
  // regardless of whether the parent opted into `onValidityChange`.
  const validationErrorRef = useRef(validationError);
  validationErrorRef.current = validationError;

  useEffect(() => {
    const form = rootRef.current?.closest('form');
    if (!form) return;

    const guard = (event: Event) => {
      const message = validationErrorRef.current;
      if (!message) return;
      event.preventDefault();
      event.stopPropagation();
      setBlockedMessage(message);
    };

    form.addEventListener('submit', guard, true);
    return () => form.removeEventListener('submit', guard, true);
  }, []);

  // Reported through a ref so parents can pass an inline callback without the
  // effect re-firing on every render.
  const isValid = validationError === null;
  const onValidityChangeRef = useRef(onValidityChange);
  onValidityChangeRef.current = onValidityChange;

  useEffect(() => {
    onValidityChangeRef.current?.(isValid);
  }, [isValid]);

  useEffect(() => {
    if (isValid) setBlockedMessage(null);
  }, [isValid]);

  const handleLabelChange = (index: number, label: string) => {
    const existingNames = fields.map((f) => f.name);
    const rawName = labelToName(label);
    const name = rawName ? uniqueName(rawName, existingNames, index) : '';

    const updated = fields.map((f, i) =>
      i === index ? { ...f, label, name } : f,
    );
    onChange(updated);
  };

  const handleFieldChange = <K extends keyof FieldDefinition>(
    index: number,
    key: K,
    value: FieldDefinition[K],
  ) => {
    const updated = fields.map((f, i) => {
      if (i !== index) return f;
      const next = { ...f, [key]: value };
      if (key === 'type') {
        // `options` only means anything for select fields; drop it when the type
        // is changed to something else so we never send a stale list to the API.
        if (value !== 'select') {
          delete next.options;
        } else if (!next.options) {
          // Start select fields with an empty list so the options editor has
          // something to render; it is invalid until the admin adds a value.
          next.options = [];
        }
      }
      return next;
    });
    onChange(updated);
  };

  const handleOptionsChange = (index: number, options: string[]) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, options } : f)));
  };

  const handleAddField = () => {
    const newField: FieldDefinition = {
      name: '',
      label: '',
      type: 'string',
      required: false,
      sensitive: false,
    };
    onChange([...fields, newField]);
  };

  const handleDeleteField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  return (
    <Box ref={rootRef}>
      <Typography variant="subtitle2" gutterBottom>
        Fields
      </Typography>

      {blockedMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {blockedMessage}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => {
          const optionsValidation = validateFieldOptions(field);
          return (
            <Paper key={index} variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* Label */}
                <TextField
                  label="Label"
                  size="small"
                  value={field.label}
                  onChange={(e) => handleLabelChange(index, e.target.value)}
                  sx={{ flex: '1 1 160px' }}
                  required
                />

                {/* Type */}
                <TextField
                  select
                  label="Type"
                  size="small"
                  value={field.type}
                  onChange={(e) =>
                    handleFieldChange(index, 'type', e.target.value as FieldDefinition['type'])
                  }
                  sx={{ flex: '0 0 140px' }}
                >
                  {FIELD_TYPES.map((t) => (
                    <MenuItem key={t.value} value={t.value}>
                      {t.label}
                    </MenuItem>
                  ))}
                </TextField>

                {/* Required */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.required}
                      onChange={(e) => handleFieldChange(index, 'required', e.target.checked)}
                      size="small"
                    />
                  }
                  label="Required"
                  sx={{ flex: '0 0 auto' }}
                />

                {/* Sensitive */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.sensitive}
                      onChange={(e) => handleFieldChange(index, 'sensitive', e.target.checked)}
                      size="small"
                    />
                  }
                  label="Sensitive"
                  sx={{ flex: '0 0 auto' }}
                />

                {/* Delete */}
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleDeleteField(index)}
                  disabled={fields.length <= 1}
                  aria-label="Remove field"
                  sx={{ mt: 0.5 }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>

              {/* Options (select fields only) */}
              {field.type === 'select' && (
                <FieldOptionsEditor
                  fieldLabel={field.label}
                  options={field.options ?? []}
                  validation={optionsValidation}
                  onChange={(options) => handleOptionsChange(index, options)}
                />
              )}

              {/* Auto-generated name chip */}
              {field.name && (
                <Box sx={{ mt: 1 }}>
                  <Chip
                    label={`name: ${field.name}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                  />
                </Box>
              )}
            </Paper>
          );
        })}
      </Box>

      <Button
        startIcon={<AddIcon />}
        onClick={handleAddField}
        size="small"
        sx={{ mt: 2 }}
      >
        Add Field
      </Button>
    </Box>
  );
}
