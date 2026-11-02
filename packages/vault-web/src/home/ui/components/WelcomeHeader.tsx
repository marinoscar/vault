import type { ReactNode } from 'react';
import { Typography, Box } from '@mui/material';

interface WelcomeHeaderProps {
  displayName: string | null;
  /** Rendered beside the greeting from 600px, under it on a phone. */
  actions?: ReactNode;
  /** Injectable for tests; defaults to the current time. */
  now?: Date;
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function WelcomeHeader({ displayName, actions, now = new Date() }: WelcomeHeaderProps) {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'flex-end' },
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="h4"
          component="h1"
          sx={{ fontWeight: 700, fontSize: { xs: '1.5rem', sm: '1.875rem' }, lineHeight: 1.25, overflowWrap: 'anywhere' }}
        >
          {greetingFor(now)}
          {displayName ? `, ${displayName}` : ''}
        </Typography>
        <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>Here's what's happening in your vault</Typography>
      </Box>
      {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
    </Box>
  );
}
