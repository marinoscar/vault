import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { SecretForm } from '../components/secrets/SecretForm';
import { SecretTypeIcon } from '../components/secrets/SecretTypeIcon';
import { getSecret, updateSecret } from '../services/api';
import type { SecretDetail } from '../types';

/**
 * Edit a secret (E10.4, issue #95): `PUT /api/secrets/:id`. The API mints a
 * new version only when the field values changed; the type never changes.
 */
export default function EditSecretPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let current = true;
    setIsLoading(true);
    getSecret(id)
      .then((result) => current && setSecret(result))
      .catch((err: unknown) => {
        if (current) setLoadError(err instanceof Error ? err.message : 'Failed to load secret');
      })
      .finally(() => current && setIsLoading(false));
    return () => {
      current = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label="Loading secret" />
      </Box>
    );
  }

  if (!secret || !id) {
    return (
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Alert severity="error">{loadError || 'Secret not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', minWidth: 0 }}>
      <Button
        component={RouterLink}
        to={`/secrets/${id}`}
        startIcon={<BackIcon />}
        size="small"
        sx={{ mb: 1.5, ml: -1, color: 'text.secondary', maxWidth: '100%' }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {secret.name}
        </Box>
      </Button>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Edit secret
        </Typography>
        {secret.type && (
          <Chip
            icon={<SecretTypeIcon icon={secret.type.icon} fontSize="small" />}
            label={secret.type.name}
            size="small"
            variant="outlined"
          />
        )}
      </Box>
      <SecretForm
        mode="edit"
        types={secret.type ? [secret.type] : []}
        initial={{
          name: secret.name,
          description: secret.description ?? '',
          typeId: secret.type?.id ?? '',
          data: secret.values ?? {},
        }}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onCancel={() => navigate(`/secrets/${id}`)}
        onSubmit={async (values) => {
          await updateSecret(id, {
            name: values.name,
            // An emptied description clears it (the API accepts null).
            description: values.description === '' ? null : values.description,
            data: values.data,
          });
          navigate(`/secrets/${id}`);
        }}
      />
    </Box>
  );
}
