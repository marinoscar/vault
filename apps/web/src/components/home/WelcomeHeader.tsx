import { Typography, Box } from '@mui/material';

interface WelcomeHeaderProps {
  displayName: string | null;
}

export function WelcomeHeader({ displayName }: WelcomeHeaderProps) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h4" component="h1" fontWeight={700}>
        {greeting}{displayName ? `, ${displayName}` : ''}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
        Here's what's happening in your vault
      </Typography>
    </Box>
  );
}
