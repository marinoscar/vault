import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Alert,
  Breadcrumbs,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Box,
} from '@mui/material';
import { MediaList } from '../components/media/MediaList';
import { useMediaFiles } from '../hooks/useMediaFiles';
import { getMediaFolder, getMediaFileDownloadUrl } from '../services/api';
import type { MediaFile } from '../types';

export default function MediaFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();

  const {
    files,
    totalItems,
    page,
    pageSize,
    isLoading,
    error,
    fetchFiles,
    deleteFile,
  } = useMediaFiles();

  const [folderName, setFolderName] = useState<string>('');
  const [folderLoading, setFolderLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<MediaFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!folderId) return;
    getMediaFolder(folderId)
      .then((folder) => setFolderName(folder.name))
      .catch(() => setFolderName('Folder'))
      .finally(() => setFolderLoading(false));
    fetchFiles(folderId);
  }, [folderId, fetchFiles]);

  const handleFetch = useCallback(
    (params?: { page?: number; pageSize?: number; search?: string }) => {
      if (!folderId) return;
      fetchFiles(folderId, params);
    },
    [folderId, fetchFiles],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!folderId || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteFile(folderId, deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // error handled in hook
    } finally {
      setIsDeleting(false);
    }
  }, [folderId, deleteTarget, deleteFile]);

  const handleDownload = useCallback(
    async (fileId: string) => {
      if (!folderId) return;
      try {
        const { url } = await getMediaFileDownloadUrl(folderId, fileId);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        console.error('Download failed:', err);
      }
    },
    [folderId],
  );

  if (folderLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ pt: 6 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
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
        <Typography color="text.primary">{folderName}</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        {folderName}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <MediaList
        files={files}
        totalItems={totalItems}
        page={page}
        pageSize={pageSize}
        isLoading={isLoading}
        onFetch={handleFetch}
        onViewClick={(fileId) => navigate(`/media/${folderId}/${fileId}`)}
        onDownloadClick={handleDownload}
        onRenameClick={(fileId) => navigate(`/media/${folderId}/${fileId}/rename`)}
        onDeleteClick={(file) => setDeleteTarget(file)}
        onUploadClick={() => navigate(`/media/${folderId}/upload`)}
      />

      {/* Delete file confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete File</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete{' '}
            <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={isDeleting}
            onClick={handleDeleteConfirm}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
