import { Card, CardContent, Box, Typography, Avatar, Grid, Skeleton } from '@mui/material';
import { VpnKey as SecretsIcon, PermMedia as MediaIcon, Category as TypesIcon } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

interface StatsCardsProps {
  totalSecrets: number;
  totalFolders: number;
  totalTypes: number;
  isLoading: boolean;
}

const cardSx = {
  cursor: 'pointer',
  transition: 'transform 0.2s, box-shadow 0.2s',
  '&:hover': { transform: 'translateY(-2px)', boxShadow: 6 },
};

export function StatsCards({ totalSecrets, totalFolders, totalTypes, isLoading }: StatsCardsProps) {
  const navigate = useNavigate();
  const theme = useTheme();

  const stats = [
    { label: 'Secrets', count: totalSecrets, icon: SecretsIcon, color: theme.palette.primary.main, path: '/secrets' },
    { label: 'Media Folders', count: totalFolders, icon: MediaIcon, color: theme.palette.secondary.main, path: '/media' },
    { label: 'Secret Types', count: totalTypes, icon: TypesIcon, color: theme.palette.success.main, path: '/secret-types' },
  ];

  return (
    <Grid container spacing={3}>
      {stats.map((stat) => (
        <Grid item xs={12} sm={4} key={stat.label}>
          <Card sx={cardSx} onClick={() => navigate(stat.path)}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {isLoading ? (
                <Skeleton variant="circular" width={56} height={56} />
              ) : (
                <Avatar sx={{ bgcolor: alpha(stat.color, 0.12), width: 56, height: 56, color: stat.color }}>
                  <stat.icon fontSize="large" />
                </Avatar>
              )}
              <Box>
                {isLoading ? (
                  <>
                    <Skeleton width={60} height={40} />
                    <Skeleton width={80} height={20} />
                  </>
                ) : (
                  <>
                    <Typography variant="h4" fontWeight={700}>{stat.count}</Typography>
                    <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
                  </>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
