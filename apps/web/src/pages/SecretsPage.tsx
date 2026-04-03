import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Typography, Alert } from '@mui/material';
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

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteSecret(id);
    },
    [deleteSecret],
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
        onCreateClick={() => navigate('/secrets/new')}
        onDeleteClick={handleDelete}
      />
    </Container>
  );
}
