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
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { DynamicSecretFields } from './DynamicSecretFields';
import { SecretTypeIcon } from './SecretTypeIcon';
import type { SecretType, SecretDetail, FieldDefinition } from '../../types';

interface SecretFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    typeId: string;
    data: Record<string, unknown>;
  }) => Promise<void>;
  secretTypes: SecretType[];
  editSecret?: SecretDetail;
}

function validateFields(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.required) {
      const val = data[field.name];
      if (val === undefined || val === null || String(val).trim() === '') {
        errors[field.name] = `${field.label} is required`;
      }
    }
  }
  return errors;
}

export function SecretFormDialog({
  open,
  onClose,
  onSave,
  secretTypes,
  editSecret,
}: SecretFormDialogProps) {
  const isEditMode = Boolean(editSecret);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [fieldData, setFieldData] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Populate form in edit mode
  useEffect(() => {
    if (open && editSecret) {
      setName(editSecret.name);
      setDescription(editSecret.description ?? '');
      setSelectedTypeId(editSecret.type.id);
      setFieldData(editSecret.data ?? {});
      setFieldErrors({});
      setFormError(null);
    } else if (open && !editSecret) {
      setName('');
      setDescription('');
      setSelectedTypeId('');
      setFieldData({});
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, editSecret]);

  // Reset field data when type changes in create mode
  const handleTypeChange = (typeId: string) => {
    setSelectedTypeId(typeId);
    setFieldData({});
    setFieldErrors({});
  };

  const selectedType = secretTypes.find((t) => t.id === selectedTypeId) ??
    (isEditMode && editSecret ? editSecret.type : null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }

    if (!selectedTypeId) {
      setFormError('Type is required');
      return;
    }

    if (selectedType) {
      const errors = validateFields(selectedType.fields, fieldData);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        typeId: selectedTypeId,
        data: fieldData,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save secret');
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
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEditMode ? 'Edit Secret' : 'New Secret'}</DialogTitle>
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
              label="Type"
              fullWidth
              required
              value={selectedTypeId}
              onChange={(e) => handleTypeChange(e.target.value)}
              disabled={isSubmitting || isEditMode}
            >
              {secretTypes.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <SecretTypeIcon icon={type.icon} fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={type.name} />
                </MenuItem>
              ))}
            </TextField>

            {selectedType && selectedType.fields.length > 0 && (
              <DynamicSecretFields
                fields={selectedType.fields}
                data={fieldData}
                onChange={setFieldData}
                errors={fieldErrors}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Secret'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
