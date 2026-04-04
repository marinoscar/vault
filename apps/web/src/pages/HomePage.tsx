import { useEffect } from 'react';
import { Container, Box, Grid } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { useSecrets } from '../hooks/useSecrets';
import { useSecretTypes } from '../hooks/useSecretTypes';
import { useMediaFolders } from '../hooks/useMediaFolders';
import { WelcomeHeader } from '../components/home/WelcomeHeader';
import { StatsCards } from '../components/home/StatsCards';
import { RecentSecrets } from '../components/home/RecentSecrets';
import { RecentMedia } from '../components/home/RecentMedia';
import { QuickActions } from '../components/home/QuickActions';
import { SecretTypesOverview } from '../components/home/SecretTypesOverview';

export default function HomePage() {
  const { user } = useAuth();
  const { secrets, totalItems: totalSecrets, isLoading: secretsLoading, fetchSecrets } = useSecrets();
  const { types, isLoading: typesLoading, fetchTypes } = useSecretTypes();
  const { folders, totalItems: totalFolders, isLoading: foldersLoading, fetchFolders } = useMediaFolders();

  useEffect(() => {
    fetchSecrets({ pageSize: 5, sortBy: 'updatedAt', sortOrder: 'desc' });
    fetchTypes();
    fetchFolders({ pageSize: 5, sortBy: 'createdAt', sortOrder: 'desc' });
  }, [fetchSecrets, fetchTypes, fetchFolders]);

  const isLoading = secretsLoading || typesLoading || foldersLoading;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <WelcomeHeader displayName={user?.displayName ?? null} />

        <Grid container spacing={3}>
          {/* Stats Row */}
          <Grid item xs={12}>
            <StatsCards
              totalSecrets={totalSecrets}
              totalFolders={totalFolders}
              totalTypes={types.length}
              isLoading={isLoading}
            />
          </Grid>

          {/* Recent Secrets (primary) + Recent Media (secondary) */}
          <Grid item xs={12} md={8}>
            <RecentSecrets secrets={secrets} isLoading={secretsLoading} />
          </Grid>
          <Grid item xs={12} md={4}>
            <RecentMedia folders={folders} isLoading={foldersLoading} />
          </Grid>

          {/* Quick Actions + Secret Types */}
          <Grid item xs={12} md={8}>
            <QuickActions />
          </Grid>
          <Grid item xs={12} md={4}>
            <SecretTypesOverview types={types} isLoading={typesLoading} />
          </Grid>
        </Grid>
      </Box>
    </Container>
  );
}
