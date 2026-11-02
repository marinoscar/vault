import { Box, ButtonBase, Card, Skeleton, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { DashboardResourceStatus } from '../../../core/headless/useDashboardResource.js';

export interface StatTile {
  key: string;
  label: string;
  /** Null while loading or after the source failed (shown as an em dash). */
  value: number | null;
  status: Exclude<DashboardResourceStatus, 'idle'>;
  to: string;
  /** Draw attention to a non-zero value (e.g. cards that need attention). */
  emphasize?: boolean;
}

/**
 * A compact strip of counts, each a link to where the count lives. Every
 * value comes from a response another panel already needs (a list's
 * `totalItems`), except media, which is one `pageSize=1` request.
 */
export function StatsRow({ tiles }: { tiles: StatTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <Card variant="outlined" component="section" aria-label="Summary" data-testid="home-stats">
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gridTemplateColumns: {
            xs: `repeat(${Math.min(tiles.length, 2)}, minmax(0, 1fr))`,
            sm: `repeat(${tiles.length}, minmax(0, 1fr))`,
          },
          // Hairlines between cells, never doubled on the outer edge.
          gap: '1px',
          bgcolor: 'divider',
        }}
      >
        {tiles.map((tile) => {
          const shown = tile.status === 'ready' && tile.value !== null ? String(tile.value) : '—';
          const attention = tile.emphasize && tile.status === 'ready' && (tile.value ?? 0) > 0;
          return (
            <Box component="li" key={tile.key} sx={{ bgcolor: 'background.paper', minWidth: 0 }}>
              <ButtonBase
                component={RouterLink}
                to={tile.to}
                aria-label={tile.status === 'ready' ? `View ${tile.label} (${shown})` : `View ${tile.label}`}
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  textAlign: 'left',
                  px: { xs: 2, sm: 2.5 },
                  py: 1.5,
                  '&:hover': { bgcolor: 'action.hover' },
                  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                }}
              >
                {tile.status === 'loading' ? (
                  <Skeleton width={40} height={32} data-testid={`stat-skeleton-${tile.key}`} />
                ) : (
                  <Typography
                    component="span"
                    variant="h5"
                    sx={{
                      fontWeight: 600,
                      lineHeight: 1.3,
                      fontVariantNumeric: 'tabular-nums',
                      color: attention ? 'error.main' : 'text.primary',
                    }}
                  >
                    {shown}
                  </Typography>
                )}
                <Typography component="span" variant="body2" noWrap sx={{ color: 'text.secondary', maxWidth: '100%' }}>
                  {tile.label}
                </Typography>
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}
