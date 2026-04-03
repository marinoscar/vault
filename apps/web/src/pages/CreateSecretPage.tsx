import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Breadcrumbs,
  Link,
  Paper,
  TextField,
  Button,
  Box,
  Alert,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { DynamicSecretFields } from '../components/secrets/DynamicSecretFields';
import { SecretTypeIcon } from '../components/secrets/SecretTypeIcon';
import { useSecretTypes } from '../hooks/useSecretTypes';
import { createSecret } from '../services/api';
import type { FieldDefinition } from '../types';

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

export default function CreateSecretPage() {
  const navigate = useNavigate();
  const { types, fetchTypes } = useSecretTypes();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [fieldData, setFieldData] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  const selectedType = types.find((t) => t.id === selectedTypeId) ?? null;

  const handleTypeChange = (typeId: string) => {
    setSelectedTypeId(typeId);
    setFieldData({});
    setFieldErrors({});
  };

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
      const result = await createSecret({
        name: name.trim(),
        description: description.trim() || undefined,
        typeId: selectedTypeId,
        data: fieldData,
      });
      navigate(`/secrets/${result.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create secret');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Home
        </Link>
        <Link color="inherit" href="/secrets" onClick={(e) => { e.preventDefault(); navigate('/secrets'); }}>
          Secrets
        </Link>
        <Typography color="text.primary">New Secret</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        New Secret
      </Typography>

      <Paper sx={{ p: 3 }}>
        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

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
              disabled={isSubmitting}
            >
              {types.map((type) => (
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

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button
                onClick={() => navigate('/secrets')}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Secret'}
              </Button>
            </Box>
          </Box>
        </form>
      </Paper>
    </Container>
  );
}
