import type { ReactNode } from 'react';
import { Box, Button } from '@mui/material';
import {
  Add as AddIcon,
  DocumentScannerOutlined as ScanIcon,
  Backup as BackupIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { HOME_LINKS } from '../../headless/homeLinks.js';

interface QuickAction {
  key: string;
  label: string;
  to: string;
  icon: ReactNode;
  primary?: boolean;
}

interface QuickActionsProps {
  /** `secrets:write` */
  canCreateSecret: boolean;
  /** `secrets:write` and card scanning enabled (`GET /api/ai/status`). */
  canScanCard: boolean;
  /** `secrets:read` (`/api/backups/me`). */
  canBackUp: boolean;
}

/**
 * The few things people come to Home to start. Each is a link (the work
 * happens on its own page) and appears only for a user who may do it.
 */
export function QuickActions({ canCreateSecret, canScanCard, canBackUp }: QuickActionsProps) {
  const actions: QuickAction[] = [];
  if (canCreateSecret) {
    actions.push({ key: 'new-secret', label: 'New secret', to: HOME_LINKS.newSecret, icon: <AddIcon />, primary: true });
  }
  if (canScanCard) {
    actions.push({ key: 'scan-card', label: 'Scan a card', to: HOME_LINKS.scanCard, icon: <ScanIcon /> });
  }
  if (canBackUp) {
    actions.push({ key: 'back-up', label: 'Back up now', to: HOME_LINKS.myBackups, icon: <BackupIcon /> });
  }
  if (actions.length === 0) return null;

  return (
    <Box
      component="nav"
      aria-label="Quick actions"
      sx={{
        display: 'grid',
        // Phone: equal columns, icon over label, so three actions fit 390px
        // without wrapping. Wider: a compact row of ordinary buttons.
        gridTemplateColumns: { xs: `repeat(${actions.length}, minmax(0, 1fr))`, sm: `repeat(${actions.length}, auto)` },
        gap: 1,
        justifyContent: { sm: 'end' },
      }}
    >
      {actions.map((action) => (
        <Button
          key={action.key}
          component={RouterLink}
          to={action.to}
          variant={action.primary ? 'contained' : 'outlined'}
          sx={{
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 0.25, sm: 1 },
            py: { xs: 1, sm: 0.75 },
            px: { xs: 1, sm: 2 },
            minHeight: 44,
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
            '& .MuiSvgIcon-root': { fontSize: 20 },
          }}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </Box>
  );
}
