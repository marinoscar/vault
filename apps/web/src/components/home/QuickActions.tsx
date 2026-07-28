import { Card, CardActionArea, CardContent, Typography, Grid, Avatar } from '@mui/material';
import {
  AddCircleOutline as CreateIcon,
  CloudUpload as UploadIcon,
  Category as TypesIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

const cardSx = {
  textAlign: 'center' as const,
  transition: 'all 0.2s',
  '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 },
  height: '100%',
};

export function QuickActions() {
  const navigate = useNavigate();
  const theme = useTheme();

  const actions = [
    { title: 'Create Secret', description: 'Store a new secret', icon: CreateIcon, color: theme.palette.primary.main, path: '/secrets/new' },
    { title: 'Upload Media', description: 'Upload files', icon: UploadIcon, color: theme.palette.secondary.main, path: '/media' },
    { title: 'Browse Types', description: 'Manage secret types', icon: TypesIcon, color: theme.palette.success.main, path: '/secret-types' },
    { title: 'Settings', description: 'Your preferences', icon: SettingsIcon, color: theme.palette.warning.main, path: '/settings' },
  ];

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" fontWeight={600} gutterBottom>Quick Actions</Typography>
        <Grid container spacing={2}>
          {actions.map((action) => (
            <Grid item xs={6} sm={3} key={action.path}>
              <Card variant="outlined" sx={cardSx}>
                {/* CardActionArea renders a real <button>: tab-reachable, activated by
                    Enter/Space, with a visible focus ring. A Card with a bare onClick
                    is a div and is invisible to assistive tech as an interactive element. */}
                <CardActionArea
                  onClick={() => navigate(action.path)}
                  aria-label={`${action.title}: ${action.description}`}
                  sx={{ height: '100%' }}
                >
                  <CardContent sx={{ py: 2.5, px: 1.5 }}>
                    <Avatar
                      sx={{
                        mx: 'auto', mb: 1.5, width: 48, height: 48,
                        bgcolor: alpha(action.color, 0.12), color: action.color,
                      }}
                    >
                      <action.icon />
                    </Avatar>
                    <Typography variant="subtitle2" fontWeight={600}>{action.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{action.description}</Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
}
