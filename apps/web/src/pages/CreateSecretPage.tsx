import { useEffect } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { SecretForm } from '../components/secrets/SecretForm';
import { useSecretTypes } from '../hooks/useSecretTypes';
import { createSecret } from '../services/api';

/** New secret (E10.4, issue #95): `POST /api/secrets` with the type's fields. */
export default function CreateSecretPage() {
  const navigate = useNavigate();
  const { types, isLoading, fetchTypes } = useSecretTypes();

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', minWidth: 0 }}>
      <Button
        component={RouterLink}
        to="/secrets"
        startIcon={<BackIcon />}
        size="small"
        sx={{ mb: 1.5, ml: -1, color: 'text.secondary' }}
      >
        Secrets
      </Button>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 2 }}>
        New secret
      </Typography>
      {isLoading && types.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading secret types" />
        </Box>
      ) : (
        <SecretForm
          mode="create"
          types={types}
          submitLabel="Create secret"
          submittingLabel="Creating…"
          onCancel={() => navigate('/secrets')}
          onSubmit={async (values) => {
            const result = await createSecret({
              name: values.name,
              description: values.description || undefined,
              typeId: values.typeId,
              data: values.data,
            });
            navigate(`/secrets/${result.id}`);
          }}
        />
      )}
    </Box>
  );
}
