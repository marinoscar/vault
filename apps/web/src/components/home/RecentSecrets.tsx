import {
  Card, CardContent, Box, Typography, Button, List, ListItemButton,
  ListItemIcon, ListItemText, Chip, Skeleton,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { SecretTypeIcon } from '../secrets/SecretTypeIcon';
import type { SecretListItem } from '../../types';

interface RecentSecretsProps {
  secrets: SecretListItem[];
  isLoading: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RecentSecrets({ secrets, isLoading }: RecentSecretsProps) {
  const navigate = useNavigate();

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>Recent Secrets</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={() => navigate('/secrets')}>View All</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/secrets/new')}>
              New Secret
            </Button>
          </Box>
        </Box>

        {isLoading ? (
          <List disablePadding>
            {Array.from({ length: 5 }).map((_, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5, px: 1 }}>
                <Skeleton variant="circular" width={24} height={24} />
                <Box sx={{ flexGrow: 1 }}>
                  <Skeleton width="60%" height={22} />
                  <Skeleton width="40%" height={16} />
                </Box>
                <Skeleton variant="rounded" width={60} height={24} />
              </Box>
            ))}
          </List>
        ) : secrets.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary" gutterBottom>No secrets yet</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/secrets/new')}>
              Create your first secret
            </Button>
          </Box>
        ) : (
          <List disablePadding>
            {secrets.map((secret, index) => (
              <ListItemButton
                key={secret.id}
                onClick={() => navigate(`/secrets/${secret.id}`)}
                divider={index < secrets.length - 1}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <SecretTypeIcon icon={secret.type?.icon ?? null} fontSize="small" color="action" />
                </ListItemIcon>
                <ListItemText
                  primary={secret.name}
                  secondary={secret.description || secret.type?.name}
                  primaryTypographyProps={{ fontWeight: 500, noWrap: true }}
                  secondaryTypographyProps={{ noWrap: true }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1, flexShrink: 0 }}>
                  <Chip label={secret.type?.name} size="small" variant="outlined" sx={{ display: { xs: 'none', sm: 'flex' } }} />
                  <Chip label={`v${secret.currentVersion}`} size="small" color="primary" variant="outlined" />
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 50, textAlign: 'right' }}>
                    {formatRelativeTime(secret.updatedAt)}
                  </Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
