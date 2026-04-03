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
} from '@mui/material';
import { SecretsList } from '../components/secrets/SecretsList';
import { useSecrets } from '../hooks/useSecrets';
import { useSecretTypes } from '../hooks/useSecretTypes';

export default function SecretsPage() {
  const navigate = useNavigate();
  const {
    secrets,
    totalItems,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    fetchSecrets,
    deleteSecret,
  } = useSecrets();
  const { types, fetchTypes } = useSecretTypes();
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const deleteTargetName = deleteTargetId
    ? secrets.find((s) => s.id === deleteTargetId)?.name ?? 'this secret'
    : '';

  useEffect(() => {
    fetchSecrets();
    fetchTypes();
  }, [fetchSecrets, fetchTypes]);

  const handleFetch = useCallback(
    (params: { page?: number; pageSize?: number; typeId?: string; search?: string }) => {
      fetchSecrets(params);
    },
    [fetchSecrets],
  );

  const handleRowClick = useCallback(
    (id: string) => {
      navigate(`/secrets/${id}`);
    },
    [navigate],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId) return;
    await deleteSecret(deleteTargetId);
    setDeleteTargetId(null);
  }, [deleteTargetId, deleteSecret]);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Home
        </Link>
        <Typography color="text.primary">Secrets</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Secrets
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <SecretsList
        secrets={secrets}
        totalItems={totalItems}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        isLoading={isLoading}
        secretTypes={types}
        onFetch={handleFetch}
        onRowClick={handleRowClick}
        onCreateClick={() => navigate('/secrets/new')}
        onDeleteClick={(id) => setDeleteTargetId(id)}
      />

      <Dialog
        open={!!deleteTargetId}
        onClose={() => setDeleteTargetId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Secret</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{deleteTargetName}</strong>? This action cannot be undone and all versions will be permanently lost.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTargetId(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
