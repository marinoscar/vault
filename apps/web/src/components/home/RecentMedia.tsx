import {
  Card, CardContent, Box, Typography, Button, List, ListItemButton,
  ListItemIcon, ListItemText, Skeleton,
} from '@mui/material';
import { Folder as FolderIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { MediaFolder } from '../../types';

interface RecentMediaProps {
  folders: MediaFolder[];
  isLoading: boolean;
}

export function RecentMedia({ folders, isLoading }: RecentMediaProps) {
  const navigate = useNavigate();

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>Recent Media</Typography>
          <Button size="small" onClick={() => navigate('/media')}>View All</Button>
        </Box>

        {isLoading ? (
          <List disablePadding dense>
            {Array.from({ length: 5 }).map((_, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, px: 1 }}>
                <Skeleton variant="circular" width={24} height={24} />
                <Box sx={{ flexGrow: 1 }}>
                  <Skeleton width="70%" height={20} />
                  <Skeleton width="30%" height={14} />
                </Box>
              </Box>
            ))}
          </List>
        ) : folders.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">No media folders yet</Typography>
          </Box>
        ) : (
          <List disablePadding dense>
            {folders.map((folder, index) => (
              <ListItemButton
                key={folder.id}
                onClick={() => navigate(`/media/${folder.id}`)}
                divider={index < folders.length - 1}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <FolderIcon color="secondary" fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={folder.name}
                  secondary={`${folder.fileCount} file${folder.fileCount !== 1 ? 's' : ''}`}
                  primaryTypographyProps={{ fontWeight: 500, noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
