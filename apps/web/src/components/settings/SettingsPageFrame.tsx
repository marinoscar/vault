import { Box, Container, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface SettingsPageFrameProps {
  /** The page's `h1`: the card's title, word for word. */
  title: string;
  /** The line under the title. */
  description: ReactNode;
  /** `md` for a single-column form, `lg` for tables. */
  maxWidth?: 'md' | 'lg';
  children: ReactNode;
}

/**
 * The chrome every settings card page shares (E10.3, issue #94): the same
 * container, padding and heading as the packaged Doctor, About and Maintenance
 * pages, so a card opened from either hub looks like its neighbours. Below
 * 600px the shell's compact AppBar also shows the title with a back arrow to
 * the hub; the heading stays for the document outline.
 */
export function SettingsPageFrame({ title, description, maxWidth = 'md', children }: SettingsPageFrameProps) {
  return (
    <Container maxWidth={maxWidth}>
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {title}
        </Typography>
        <Typography component="div" sx={{ color: 'text.secondary', mb: 3 }}>
          {description}
        </Typography>
        {children}
      </Box>
    </Container>
  );
}
