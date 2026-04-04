import { Card, CardContent, Typography, Box, Chip, Skeleton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { SecretTypeIcon } from '../secrets/SecretTypeIcon';
import type { SecretType } from '../../types';

interface SecretTypesOverviewProps {
  types: SecretType[];
  isLoading: boolean;
}

export function SecretTypesOverview({ types, isLoading }: SecretTypesOverviewProps) {
  const navigate = useNavigate();

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" fontWeight={600} gutterBottom>Secret Types</Typography>
        {isLoading ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" width={90} height={32} sx={{ borderRadius: '16px' }} />
            ))}
          </Box>
        ) : types.length === 0 ? (
          <Typography color="text.secondary" variant="body2">No secret types available</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {types.map((type) => (
              <Chip
                key={type.id}
                icon={<SecretTypeIcon icon={type.icon} fontSize="small" />}
                label={type.name}
                variant="outlined"
                clickable
                onClick={() => navigate(`/secrets?typeId=${type.id}`)}
                sx={{ borderRadius: '16px' }}
              />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
