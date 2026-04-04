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
import { getMediaFolder, getMediaFile, renameMediaFile } from '../services/api';

export default function RenameMediaFilePage() {
  const { folderId, fileId } = useParams<{ folderId: string; fileId: string }>();
  const navigate = useNavigate();

  const [folderName, setFolderName] = useState<string>('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!folderId || !fileId) return;
    Promise.all([getMediaFolder(folderId), getMediaFile(folderId, fileId)])
      .then(([folder, file]) => {
        setFolderName(folder.name);
        setName(file.name);
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => setIsLoading(false));
  }, [folderId, fileId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!folderId || !fileId) return;
    setFormError(null);

    if (!name.trim()) {
      setFormError('File name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await renameMediaFile(folderId, fileId, name.trim());
      navigate(`/media/${folderId}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to rename file');
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
        <Link
          color="inherit"
          href={`/media/${folderId}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/media/${folderId}`);
          }}
        >
          {folderName}
        </Link>
        <Typography color="text.primary">Rename</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Rename File
      </Typography>

      <Paper sx={{ p: 3 }}>
        <form onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="File Name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button
                onClick={() => navigate(`/media/${folderId}`)}
                disabled={isSubmitting}
              >
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
