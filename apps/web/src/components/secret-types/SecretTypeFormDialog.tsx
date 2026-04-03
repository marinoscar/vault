import { useState, useEffect, FormEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Box,
  MenuItem,
  FormControlLabel,
  Switch,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import { FieldDefinitionBuilder } from './FieldDefinitionBuilder';
import { SecretTypeIcon, availableIcons } from '../secrets/SecretTypeIcon';
import type { SecretType, FieldDefinition } from '../../types';

interface SecretTypeFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    icon?: string;
    fields: FieldDefinition[];
    allowAttachments: boolean;
  }) => Promise<void>;
  editType?: SecretType;
}

const DEFAULT_FIELDS: FieldDefinition[] = [
  { name: 'value', label: 'Value', type: 'string', required: true, sensitive: true },
];

export function SecretTypeFormDialog({
  open,
  onClose,
  onSave,
  editType,
}: SecretTypeFormDialogProps) {
  const isEditMode = Boolean(editType);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [allowAttachments, setAllowAttachments] = useState(false);
  const [fields, setFields] = useState<FieldDefinition[]>(DEFAULT_FIELDS);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open && editType) {
      setName(editType.name);
      setDescription(editType.description ?? '');
      setIcon(editType.icon ?? '');
      setAllowAttachments(editType.allowAttachments);
      setFields(editType.fields.length > 0 ? editType.fields : DEFAULT_FIELDS);
      setFormError(null);
    } else if (open && !editType) {
      setName('');
      setDescription('');
      setIcon('');
      setAllowAttachments(false);
      setFields(DEFAULT_FIELDS);
      setFormError(null);
    }
  }, [open, editType]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }

    if (fields.length === 0) {
      setFormError('At least one field is required');
      return;
    }

    // Validate that all fields have labels and auto-generated names
    const invalidField = fields.find((f) => !f.label.trim() || !f.name.trim());
    if (invalidField) {
      setFormError('All fields must have a label');
      return;
    }

    // Check for duplicate names
    const names = fields.map((f) => f.name);
    const hasDuplicates = names.length !== new Set(names).size;
    if (hasDuplicates) {
      setFormError('Field names must be unique');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon || undefined,
        fields,
        allowAttachments,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save secret type');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEditMode ? 'Edit Secret Type' : 'New Secret Type'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {formError && (
              <Alert severity="error">{formError}</Alert>
            )}

            <TextField
              label="Name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />

            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
            />

            <TextField
              select
              label="Icon"
              fullWidth
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              disabled={isSubmitting}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {availableIcons.map((iconName) => (
                <MenuItem key={iconName} value={iconName}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <SecretTypeIcon icon={iconName} fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={iconName} />
                </MenuItem>
              ))}
            </TextField>

            <FormControlLabel
              control={
                <Switch
                  checked={allowAttachments}
                  onChange={(e) => setAllowAttachments(e.target.checked)}
                  disabled={isSubmitting}
                />
              }
              label="Allow Attachments"
            />

            <Divider />

            <FieldDefinitionBuilder fields={fields} onChange={setFields} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Type'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
