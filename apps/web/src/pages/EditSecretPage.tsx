import { useState, useEffect, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  CircularProgress,
  Chip,
} from '@mui/material';
import { DynamicSecretFields } from '../components/secrets/DynamicSecretFields';
import { SecretTypeIcon } from '../components/secrets/SecretTypeIcon';
import { getSecret, updateSecret } from '../services/api';
import type { SecretDetail, FieldDefinition } from '../types';

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

export default function EditSecretPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldData, setFieldData] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    getSecret(id)
      .then((result) => {
        setSecret(result);
        setName(result.name);
        setDescription(result.description ?? '');
        setFieldData(result.values ?? {});
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Failed to load secret');
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  const fields = secret?.type?.fields ?? [];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !secret) return;
    setFormError(null);

    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }

    if (fields.length > 0) {
      const errors = validateFields(fields, fieldData);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await updateSecret(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        data: fieldData,
      });
      navigate(`/secrets/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update secret');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Container maxWidth="md" sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!secret) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Alert severity="error">{formError || 'Secret not found'}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Home
        </Link>
        <Link color="inherit" href="/secrets" onClick={(e) => { e.preventDefault(); navigate('/secrets'); }}>
          Secrets
        </Link>
        <Link color="inherit" href={`/secrets/${id}`} onClick={(e) => { e.preventDefault(); navigate(`/secrets/${id}`); }}>
          {secret.name}
        </Link>
        <Typography color="text.primary">Edit</Typography>
      </Breadcrumbs>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h4">Edit Secret</Typography>
        {secret.type && (
          <Chip
            icon={<SecretTypeIcon icon={secret.type.icon} fontSize="small" />}
            label={secret.type.name}
            size="small"
            variant="outlined"
          />
        )}
      </Box>

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

            {fields.length > 0 && (
              <DynamicSecretFields
                fields={fields}
                data={fieldData}
                onChange={setFieldData}
                errors={fieldErrors}
              />
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button
                onClick={() => navigate(`/secrets/${id}`)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </Box>
          </Box>
        </form>
      </Paper>
    </Container>
  );
}
