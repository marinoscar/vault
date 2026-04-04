import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  TextField,
} from '@mui/material';
import { FolderList } from '../components/media/FolderList';
import { useMediaFolders } from '../hooks/useMediaFolders';
import type { MediaFolder } from '../types';

export default function MediaFoldersPage() {
  const navigate = useNavigate();
  const {
    folders,
    totalItems,
    page,
    pageSize,
    isLoading,
    error,
    fetchFolders,
    deleteFolder,
  } = useMediaFolders();

  // 0 = closed, 1 = first dialog, 2 = second dialog
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteTarget, setDeleteTarget] = useState<MediaFolder | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleFetch = useCallback(
    (params?: { page?: number; pageSize?: number; search?: string }) => {
      fetchFolders(params);
    },
    [fetchFolders],
  );

  const handleDeleteClick = useCallback((folder: MediaFolder) => {
    setDeleteTarget(folder);
    setDeleteStep(1);
    setConfirmText('');
  }, []);

  const handleFirstConfirm = useCallback(() => {
    setDeleteStep(2);
    setConfirmText('');
  }, []);

  const handleFinalDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteFolder(deleteTarget.id);
      setDeleteStep(0);
      setDeleteTarget(null);
      setConfirmText('');
    } catch {
      // error handled in hook
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteFolder]);

  const handleCloseDelete = useCallback(() => {
    setDeleteStep(0);
    setDeleteTarget(null);
    setConfirmText('');
  }, []);

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
        <Typography color="text.primary">Media</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Media
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <FolderList
        folders={folders}
        totalItems={totalItems}
        page={page}
        pageSize={pageSize}
        isLoading={isLoading}
        onFetch={handleFetch}
        onRowClick={(folderId) => navigate(`/media/${folderId}`)}
        onCreateClick={() => navigate('/media/new-folder')}
        onEditClick={(folderId) => navigate(`/media/${folderId}/edit`)}
        onDeleteClick={handleDeleteClick}
      />

      {/* First confirmation dialog */}
      <Dialog
        open={deleteStep === 1}
        onClose={handleCloseDelete}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Folder</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete folder{' '}
            <strong>{deleteTarget?.name}</strong> and all its contents? This will
            permanently delete{' '}
            <strong>
              {deleteTarget?.fileCount ?? 0} file
              {(deleteTarget?.fileCount ?? 0) !== 1 ? 's' : ''}
            </strong>
            .
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDelete}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleFirstConfirm}>
            Yes, Delete Everything
          </Button>
        </DialogActions>
      </Dialog>

      {/* Second confirmation dialog */}
      <Dialog
        open={deleteStep === 2}
        onClose={handleCloseDelete}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Permanent Deletion</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            This is irreversible. Type the folder name to confirm:
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder={deleteTarget?.name ?? ''}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDelete} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={confirmText !== deleteTarget?.name || isDeleting}
            onClick={handleFinalDelete}
          >
            {isDeleting ? 'Deleting...' : 'Permanently Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
