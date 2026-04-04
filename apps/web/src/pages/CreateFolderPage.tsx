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
} from '@mui/material';
import { createMediaFolder } from '../services/api';

export default function CreateFolderPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Folder name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await createMediaFolder(name.trim());
      navigate('/media');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          color="inherit"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          Home
        </Link>
        <Link
          color="inherit"
          href="/media"
          onClick={(e) => {
            e.preventDefault();
            navigate('/media');
          }}
        >
          Media
        </Link>
        <Typography color="text.primary">New Folder</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        New Folder
      </Typography>

      <Paper sx={{ p: 3 }}>
        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Folder Name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button onClick={() => navigate('/media')} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create'}
              </Button>
            </Box>
          </Box>
        </form>
      </Paper>
    </Container>
  );
}
