import { Box, Button, Card, Typography } from '@mui/material';
import { Add as AddIcon, LockOutlined as LockIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { HOME_LINKS } from './homeLinks';

/**
 * First run (no secrets yet): one call to action instead of a row of empty
 * panels.
 */
export function FirstRunPanel({ canCreate }: { canCreate: boolean }) {
  return (
    <Card variant="outlined" component="section" aria-labelledby="home-first-run-title" data-testid="home-first-run">
      <Box sx={{ p: { xs: 3, sm: 4 }, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'secondary.main',
            color: 'secondary.contrastText',
          }}
        >
          <LockIcon />
        </Box>
        <Typography id="home-first-run-title" variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          Your vault is empty
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
          Store logins, API keys, payment cards and notes, encrypted and versioned.
        </Typography>
        {canCreate && (
          <Button component={RouterLink} to={HOME_LINKS.newSecret} variant="contained" startIcon={<AddIcon />} sx={{ mt: 1 }}>
            Add your first secret
          </Button>
        )}
      </Box>
    </Card>
  );
}
