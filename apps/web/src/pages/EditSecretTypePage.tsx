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
  MenuItem,
  ListItemIcon,
  ListItemText,
  FormControlLabel,
  Switch,
  Divider,
  CircularProgress,
} from '@mui/material';
import { FieldDefinitionBuilder } from '../components/secret-types/FieldDefinitionBuilder';
import { SecretTypeIcon, availableIcons } from '../components/secrets/SecretTypeIcon';
import { getSecretType, updateSecretType } from '../services/api';
import type { FieldDefinition } from '../types';

export default function EditSecretTypePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [typeName, setTypeName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [allowAttachments, setAllowAttachments] = useState(false);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    getSecretType(id)
      .then((result) => {
        setTypeName(result.name);
        setName(result.name);
        setDescription(result.description ?? '');
        setIcon(result.icon ?? '');
        setAllowAttachments(result.allowAttachments);
        setFields(result.fields.length > 0 ? result.fields : []);
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Failed to load secret type');
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setFormError(null);

    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (fields.length === 0) {
      setFormError('At least one field is required');
      return;
    }
    const invalidField = fields.find((f) => !f.label.trim() || !f.name.trim());
    if (invalidField) {
      setFormError('All fields must have a label');
      return;
    }
    const names = fields.map((f) => f.name);
    if (names.length !== new Set(names).size) {
      setFormError('Field names must be unique');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateSecretType(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon || undefined,
        fields,
        allowAttachments,
      });
      navigate('/secret-types');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update secret type');
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

  if (!typeName && formError) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Alert severity="error">{formError}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Home
        </Link>
        <Link color="inherit" href="/secret-types" onClick={(e) => { e.preventDefault(); navigate('/secret-types'); }}>
          Secret Types
        </Link>
        <Typography color="text.primary">Edit {typeName}</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Edit Secret Type
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

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button onClick={() => navigate('/secret-types')} disabled={isSubmitting}>
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
