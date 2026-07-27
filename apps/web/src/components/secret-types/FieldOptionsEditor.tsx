import {
  Box,
  Button,
  FormHelperText,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import {
  MAX_OPTIONS,
  MAX_OPTION_LENGTH,
  type FieldOptionsValidation,
} from './fieldOptionsValidation';

interface FieldOptionsEditorProps {
  /** Label of the field these options belong to; used for accessible names. */
  fieldLabel: string;
  options: string[];
  validation: FieldOptionsValidation;
  onChange: (options: string[]) => void;
}

/**
 * Sub-editor for the `options` list of a `select` field. Order is meaningful —
 * it is the order `DynamicSecretFields` renders the choices in — so options can
 * be reordered as well as added, edited and removed.
 */
export function FieldOptionsEditor({
  fieldLabel,
  options,
  validation,
  onChange,
}: FieldOptionsEditorProps) {
  const owner = fieldLabel.trim() || 'new field';

  const replaceAt = (index: number, value: string) => {
    onChange(options.map((o, i) => (i === index ? value : o)));
  };

  const handleAdd = () => onChange([...options, '']);

  const handleRemove = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  const handleMove = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        Options
      </Typography>

      <Box
        role="group"
        aria-label={`Options for ${owner}`}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 0.5 }}
      >
        {options.map((option, index) => {
          const error = validation.optionErrors[index] ?? null;
          return (
            <Box
              key={index}
              sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}
            >
              <TextField
                size="small"
                value={option}
                onChange={(e) => replaceAt(index, e.target.value)}
                // Trim on blur so a stray trailing space cannot masquerade as a
                // distinct value once the list reaches the API.
                onBlur={() => {
                  const trimmed = option.trim();
                  if (trimmed !== option) replaceAt(index, trimmed);
                }}
                error={Boolean(error)}
                helperText={error ?? undefined}
                placeholder="Value"
                inputProps={{
                  'aria-label': `Option ${index + 1} for ${owner}`,
                  maxLength: MAX_OPTION_LENGTH,
                }}
                sx={{ flex: '1 1 220px', maxWidth: 360 }}
              />

              <IconButton
                size="small"
                onClick={() => handleMove(index, -1)}
                disabled={index === 0}
                aria-label={`Move option ${index + 1} up`}
                sx={{ mt: 0.5 }}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>

              <IconButton
                size="small"
                onClick={() => handleMove(index, 1)}
                disabled={index === options.length - 1}
                aria-label={`Move option ${index + 1} down`}
                sx={{ mt: 0.5 }}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>

              <IconButton
                size="small"
                color="error"
                onClick={() => handleRemove(index)}
                aria-label={`Remove option ${index + 1}`}
                sx={{ mt: 0.5 }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      {validation.listError && (
        <FormHelperText error sx={{ mt: 1 }}>
          {validation.listError}
        </FormHelperText>
      )}

      <Button
        startIcon={<AddIcon />}
        onClick={handleAdd}
        size="small"
        disabled={options.length >= MAX_OPTIONS}
        aria-label={`Add option to ${owner}`}
        sx={{ mt: 1 }}
      >
        Add Option
      </Button>
    </Box>
  );
}
