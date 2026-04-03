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
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import type { FieldDefinition } from '../../types';

interface FieldDefinitionBuilderProps {
  fields: FieldDefinition[];
  onChange: (fields: FieldDefinition[]) => void;
}

const FIELD_TYPES: { value: FieldDefinition['type']; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
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

export function FieldDefinitionBuilder({ fields, onChange }: FieldDefinitionBuilderProps) {
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
    const updated = fields.map((f, i) => (i === index ? { ...f, [key]: value } : f));
    onChange(updated);
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
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Fields
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => (
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
                sx={{ flex: '0 0 120px' }}
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
        ))}
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
