import { useState, useEffect, ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Breadcrumbs,
  Link,
  Paper,
  Button,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import { CloudUpload as CloudUploadIcon } from '@mui/icons-material';
import { getMediaFolder } from '../services/api';
import { useMediaFiles } from '../hooks/useMediaFiles';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function MediaUploadPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { uploadFile } = useMediaFiles();

  const [folderName, setFolderName] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!folderId) return;
    getMediaFolder(folderId)
      .then((folder) => setFolderName(folder.name))
      .catch(() => setFolderName('Folder'));
  }, [folderId]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError(null);
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!folderId || !selectedFile) return;
    setFormError(null);
    setIsUploading(true);
    try {
      await uploadFile(folderId, selectedFile);
      navigate(`/media/${folderId}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
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
        <Typography color="text.primary">Upload</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Upload File
      </Typography>

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {formError && <Alert severity="error">{formError}</Alert>}

          <Box
            sx={{
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              p: 4,
              textAlign: 'center',
              bgcolor: 'action.hover',
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body1" color="text.secondary" gutterBottom>
              Select a video, audio, or image file
            </Typography>
            <Button
              variant="outlined"
              component="label"
              disabled={isUploading}
            >
              Choose File
              <input
                type="file"
                hidden
                accept="video/*,audio/*,image/*"
                onChange={handleFileChange}
              />
            </Button>
          </Box>

          {selectedFile && (
            <Box
              sx={{
                p: 2,
                bgcolor: 'background.default',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" fontWeight={500} noWrap>
                {selectedFile.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedFile.type} &bull; {formatFileSize(selectedFile.size)}
              </Typography>
            </Box>
          )}

          {isUploading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                Uploading...
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
            <Button
              onClick={() => navigate(`/media/${folderId}`)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={!selectedFile || isUploading}
              onClick={handleUpload}
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
