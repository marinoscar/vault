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
} from '@mui/material';
import { getMediaFolder, updateMediaFolder } from '../services/api';

export default function EditFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!folderId) return;
    setIsLoading(true);
    getMediaFolder(folderId)
      .then((folder) => {
        setName(folder.name);
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Failed to load folder');
      })
      .finally(() => setIsLoading(false));
  }, [folderId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!folderId) return;
    setFormError(null);

    if (!name.trim()) {
      setFormError('Folder name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateMediaFolder(folderId, name.trim());
      navigate('/media');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to rename folder');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Container maxWidth="sm" sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

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
        <Typography color="text.primary">Edit Folder</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Edit Folder
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
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </Box>
          </Box>
        </form>
      </Paper>
    </Container>
  );
}
