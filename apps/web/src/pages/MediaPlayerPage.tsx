import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Breadcrumbs,
  Link,
  Alert,
  CircularProgress,
  Box,
  Button,
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import { getMediaFolder, getMediaFile, getMediaFileDownloadUrl } from '../services/api';
import MediaPlayer from '../components/media/MediaPlayer';

function getPlayerMode(mimeType: string): 'video' | 'audio' | 'image' {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'image';
}

export default function MediaPlayerPage() {
  const { folderId, fileId } = useParams<{ folderId: string; fileId: string }>();
  const navigate = useNavigate();

  const [folderName, setFolderName] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [mimeType, setMimeType] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folderId || !fileId) return;
    setIsLoading(true);
    Promise.all([
      getMediaFolder(folderId),
      getMediaFile(folderId, fileId),
      getMediaFileDownloadUrl(folderId, fileId),
    ])
      .then(([folder, file, { url }]) => {
        setFolderName(folder.name);
        setFileName(file.name);
        setMimeType(file.mimeType);
        setDownloadUrl(url);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load media');
      })
      .finally(() => setIsLoading(false));
  }, [folderId, fileId]);

  const handleDownload = () => {
    if (!downloadUrl) return;
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  };

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ pt: 6 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  const mode = getPlayerMode(mimeType);

  return (
    <Container maxWidth="lg" sx={{ py: 2 }}>
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
        <Typography color="text.primary" noWrap sx={{ maxWidth: 200 }}>
          {fileName}
        </Typography>
      </Breadcrumbs>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 1,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {fileName}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          onClick={handleDownload}
          disabled={!downloadUrl}
        >
          Download
        </Button>
      </Box>

      {downloadUrl && (
        <MediaPlayer src={downloadUrl} mode={mode} fileName={fileName} />
      )}
    </Container>
  );
}
