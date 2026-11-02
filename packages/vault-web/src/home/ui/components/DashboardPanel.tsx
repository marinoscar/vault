import { useId } from 'react';
import type { ReactNode } from 'react';
import { Alert, Box, Button, Card, Typography } from '@mui/material';
import { ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';

interface DashboardPanelProps {
  title: string;
  /** One short line under the title. */
  subtitle?: string;
  /** Header link, e.g. "View all". */
  action?: { label: string; to: string; ariaLabel?: string };
  children: ReactNode;
  /** Order in the phone's single column (urgency first); reset from `md`. */
  phoneOrder?: number;
  testId?: string;
}

/**
 * The frame every Home panel shares: an outlined card that is a labelled
 * `section` landmark, a heading level 2 and an optional header link.
 */
export function DashboardPanel({ title, subtitle, action, children, phoneOrder, testId }: DashboardPanelProps) {
  const headingId = useId();
  return (
    <Card
      variant="outlined"
      component="section"
      aria-labelledby={headingId}
      data-testid={testId}
      sx={{ order: { xs: phoneOrder ?? 0, md: 0 }, minWidth: 0 }}
    >
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography id={headingId} variant="subtitle1" component="h2" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {action && (
            <Button
              component={RouterLink}
              to={action.to}
              size="small"
              endIcon={<ChevronRightIcon />}
              aria-label={action.ariaLabel}
              sx={{ flexShrink: 0, mt: -0.25, mr: -1 }}
            >
              {action.label}
            </Button>
          )}
        </Box>
        {children}
      </Box>
    </Card>
  );
}

/** A panel's error state: what failed and a way to try again. */
export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert
      severity="error"
      variant="outlined"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

/** A panel's empty state: one calm sentence, an optional icon and action. */
export function PanelEmpty({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.5, color: 'text.secondary' }}>
      {icon && <Box sx={{ display: 'flex', flexShrink: 0 }}>{icon}</Box>}
      <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
        {children}
      </Typography>
      {action}
    </Box>
  );
}
