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
import { SecretTypesList } from '../components/secret-types/SecretTypesList';
import { useSecretTypes } from '../hooks/useSecretTypes';
import type { SecretType } from '../types';

export default function SecretTypesPage() {
  const navigate = useNavigate();
  const { types, isLoading, error, fetchTypes, deleteType } = useSecretTypes();
  const [deleteTarget, setDeleteTarget] = useState<SecretType | null>(null);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteType(deleteTarget.id);
    setDeleteTarget(null);
  }, [deleteTarget, deleteType]);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Home
        </Link>
        <Typography color="text.primary">Secret Types</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Secret Types
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <SecretTypesList
        types={types}
        isLoading={isLoading}
        onCreateClick={() => navigate('/secret-types/new')}
        onEditClick={(type) => navigate(`/secret-types/${type.id}/edit`)}
        onDeleteClick={(type) => setDeleteTarget(type)}
      />

      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Secret Type</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone. Any secrets using this type will need to be migrated first.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
