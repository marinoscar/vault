import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Typography, Alert, Breadcrumbs, Link } from '@mui/material';
import { SecretTypesList } from '../components/secret-types/SecretTypesList';
import { useSecretTypes } from '../hooks/useSecretTypes';
import type { SecretType } from '../types';

export default function SecretTypesPage() {
  const navigate = useNavigate();
  const { types, isLoading, error, fetchTypes, deleteType } = useSecretTypes();

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  const handleDelete = useCallback(
    async (type: SecretType) => {
      if (confirm(`Delete "${type.name}"? This cannot be undone.`)) {
        await deleteType(type.id);
      }
    },
    [deleteType],
  );

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
        onDeleteClick={handleDelete}
      />
    </Container>
  );
}
