import { Card, CardActionArea, CardContent, Box, Typography } from '@mui/material';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link as RouterLink } from 'react-router-dom';

/**
 * The way into Secret types from Settings (E10.2, issue #93): secret types are
 * a settings card, not a navigation destination (docs/specs/ux-refresh.md §6).
 * The `/secret-types` routes are unchanged; E10.3 turns this into a card of
 * the `USER_SETTINGS_SECTIONS` registry. Gated by the caller on
 * `secret_types:read` (`secret-types.controller.ts`).
 */
export function SecretTypesLink() {
  return (
    <Card id="secret-types">
      <CardActionArea component={RouterLink} to="/secret-types">
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CategoryIcon sx={{ color: 'primary.main' }} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h2">
              Secret types
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The fields each kind of secret holds. System types are read-only; add your own.
            </Typography>
          </Box>
          <ChevronRightIcon sx={{ color: 'text.secondary' }} />
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
