import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Typography, Snackbar, Alert } from '@mui/material';
import { SecretsList } from '../components/secrets/SecretsList';
import { SecretFormDialog } from '../components/secrets/SecretFormDialog';
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
    createSecret,
  } = useSecrets();
  const { types, fetchTypes } = useSecretTypes();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  const handleCreate = useCallback(
    async (data: {
      name: string;
      description?: string;
      typeId: string;
      data: Record<string, unknown>;
    }) => {
      await createSecret(data);
      setCreateDialogOpen(false);
      setSuccessMessage('Secret created successfully');
    },
    [createSecret],
  );

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
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
        onCreateClick={() => setCreateDialogOpen(true)}
      />

      <SecretFormDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSave={handleCreate}
        secretTypes={types}
      />

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
      >
        <Alert severity="success">{successMessage}</Alert>
      </Snackbar>
    </Container>
  );
}
