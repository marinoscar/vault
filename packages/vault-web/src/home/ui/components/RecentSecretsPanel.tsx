import { Box, Button, List, ListItem, ListItemButton, ListItemText, Skeleton, Typography } from '@mui/material';
import { Add as AddIcon, LockOutlined as EmptyIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { SecretTypeIcon } from '../../../secrets/ui/components/SecretTypeIcon.js';
import type { DashboardResourceStatus } from '../../../core/headless/useDashboardResource.js';
import type { SecretListItem } from '../../../core/headless/types.js';
import { formatRelativeTime } from '../../../core/headless/relativeTime.js';
import { DashboardPanel, PanelEmpty, PanelError } from './DashboardPanel.js';
import { HOME_LINKS } from '../../headless/homeLinks.js';

/** How many recently updated secrets Home lists (one `GET /api/secrets` page). */
export const RECENT_SECRETS_LIMIT = 5;

interface RecentSecretsPanelProps {
  status: Exclude<DashboardResourceStatus, 'idle'>;
  secrets: SecretListItem[];
  error: string | null;
  onRetry: () => void;
  canCreate: boolean;
  phoneOrder?: number;
  now?: Date;
}

/**
 * The most recently updated secrets: name, type and age only. List responses
 * are never decrypted, so no value can reach this panel.
 */
export function RecentSecretsPanel({
  status,
  secrets,
  error,
  onRetry,
  canCreate,
  phoneOrder,
  now = new Date(),
}: RecentSecretsPanelProps) {
  return (
    <DashboardPanel
      title="Recently updated"
      action={{ label: 'View all', to: HOME_LINKS.secrets, ariaLabel: 'View all secrets' }}
      phoneOrder={phoneOrder}
      testId="home-recent-secrets"
    >
      {status === 'loading' && (
        <Box aria-busy="true" aria-label="Loading recent secrets">
          {Array.from({ length: RECENT_SECRETS_LIMIT }).map((_, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
              <Skeleton variant="circular" width={24} height={24} />
              <Box sx={{ flexGrow: 1 }}>
                <Skeleton width="50%" height={20} />
                <Skeleton width="30%" height={16} />
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {status === 'error' && (
        <PanelError message={error ?? 'Could not load your recent secrets.'} onRetry={onRetry} />
      )}

      {status === 'ready' && secrets.length === 0 && (
        <PanelEmpty
          icon={<EmptyIcon />}
          action={
            canCreate ? (
              <Button component={RouterLink} to={HOME_LINKS.newSecret} size="small" startIcon={<AddIcon />}>
                New secret
              </Button>
            ) : undefined
          }
        >
          No secrets yet.
        </PanelEmpty>
      )}

      {status === 'ready' && secrets.length > 0 && (
        <List disablePadding aria-label="Recently updated secrets">
          {secrets.map((secret) => (
            <ListItem key={secret.id} disablePadding>
              <ListItemButton
                component={RouterLink}
                to={HOME_LINKS.secretDetail(secret.id)}
                sx={{ borderRadius: 1, px: 1, mx: -1, gap: 1.5, minHeight: 48 }}
              >
                <Box sx={{ display: 'flex', color: 'primary.main', flexShrink: 0 }}>
                  <SecretTypeIcon icon={secret.type.icon} fontSize="small" />
                </Box>
                <ListItemText
                  primary={secret.name}
                  secondary={secret.type.name}
                  sx={{ my: 0.5, minWidth: 0 }}
                  slotProps={{
                    primary: { noWrap: true, variant: 'body2', sx: { fontWeight: 500 } },
                    secondary: { noWrap: true, variant: 'caption' },
                  }}
                />
                <Typography
                  variant="caption"
                  component="time"
                  dateTime={secret.updatedAt}
                  sx={{ color: 'text.secondary', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {formatRelativeTime(secret.updatedAt, now)}
                </Typography>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </DashboardPanel>
  );
}
