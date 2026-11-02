import { useState, FormEvent } from 'react';
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
  FormControlLabel,
  Switch,
  Divider,
} from '@mui/material';
import { FieldDefinitionBuilder } from '../components/FieldDefinitionBuilder.js';
import { SecretTypeIcon, availableIcons } from '../components/SecretTypeIcon.js';
import { createSecretType } from '../../../core/headless/api.js';
import type { FieldDefinition } from '../../../core/headless/types.js';

const DEFAULT_FIELDS: FieldDefinition[] = [
  { name: 'value', label: 'Value', type: 'string', required: true, sensitive: true },
];

export default function CreateSecretTypePage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [allowAttachments, setAllowAttachments] = useState(false);
  const [fields, setFields] = useState<FieldDefinition[]>(DEFAULT_FIELDS);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await createSecretType({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon || undefined,
        fields,
        allowAttachments,
      });
      navigate('/settings/secret-types');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create secret type');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/settings" onClick={(e) => { e.preventDefault(); navigate('/settings'); }}>
          Settings
        </Link>
        <Link color="inherit" href="/settings/secret-types" onClick={(e) => { e.preventDefault(); navigate('/settings/secret-types'); }}>
          Secret types
        </Link>
        <Typography sx={{
          color: "text.primary"
        }}>New Type</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        New Secret Type
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
              <Button onClick={() => navigate('/settings/secret-types')} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Type'}
              </Button>
            </Box>
          </Box>
        </form>
      </Paper>
    </Container>
  );
}
