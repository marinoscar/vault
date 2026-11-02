import { Box, List, ListItem, ListItemButton, ListItemText, Skeleton, Typography } from '@mui/material';
import { CreditCard as CardIcon, EventAvailableOutlined as AllClearIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { CardExpiryBadge } from '../../../cards/ui/components/CardExpiryBadge.js';
import type { CardSummary } from '../../../cards/headless/useCards.js';
import type { DashboardResourceStatus } from '../../../core/headless/useDashboardResource.js';
import { EXPIRING_SOON_DAYS, isNeedsAttention } from '../../../cards/headless/cardExpiry.js';
import { DashboardPanel, PanelEmpty, PanelError } from './DashboardPanel.js';
import { HOME_LINKS } from '../../headless/homeLinks.js';

/**
 * A row's secondary line, `•••• 4242 · Exp 12/26`. A card the summary could not
 * read (null last4 or expiry) shows a dash in that place, never a guess.
 */
export function cardMetaLine(card: Pick<CardSummary, 'maskedNumber' | 'expiryLabel'>): string {
  return `${card.maskedNumber || '•••• —'} · Exp ${card.expiryLabel || '—'}`;
}

/** Rows shown on Home; the rest are one click away in the filtered gallery. */
export const EXPIRING_CARDS_LIMIT = 5;

interface ExpiringCardsPanelProps {
  status: Exclude<DashboardResourceStatus, 'idle'>;
  /**
   * The loaded cards, soonest expiry first (as `useCards` returns them). Home
   * loads with scope `attention`, so this holds every card needing attention
   * and may stop short of the rest of the wallet.
   */
  cards: CardSummary[];
  /** Cards in the whole wallet (the summary's `totalItems`). */
  totalCards: number;
  error: string | null;
  onRetry: () => void;
  /** `secrets:write`: rows open the renew flow; otherwise the card's detail. */
  canRenew: boolean;
  phoneOrder?: number;
}

/**
 * Cards that are expired or expire within 60 days, soonest first. Never the
 * full number: rows show the masked number and the `MM/YY` only.
 */
export function ExpiringCardsPanel({
  status,
  cards,
  totalCards,
  error,
  onRetry,
  canRenew,
  phoneOrder,
}: ExpiringCardsPanelProps) {
  const attention = cards.filter((card) => isNeedsAttention(card.status));
  const shown = attention.slice(0, EXPIRING_CARDS_LIMIT);
  const hidden = attention.length - shown.length;

  return (
    <DashboardPanel
      title="Cards needing attention"
      subtitle={`Expired or expiring within ${EXPIRING_SOON_DAYS} days`}
      action={{ label: 'View', to: HOME_LINKS.cardsNeedingAttention, ariaLabel: 'View cards needing attention' }}
      phoneOrder={phoneOrder}
      testId="home-expiring-cards"
    >
      {status === 'loading' && (
        <Box aria-busy="true" aria-label="Loading cards">
          {[0, 1].map((i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
              <Skeleton variant="rounded" width={24} height={24} />
              <Box sx={{ flexGrow: 1 }}>
                <Skeleton width="55%" height={20} />
                <Skeleton width="35%" height={16} />
              </Box>
              <Skeleton variant="rounded" width={92} height={24} />
            </Box>
          ))}
        </Box>
      )}

      {status === 'error' && <PanelError message={error ?? 'Could not load your cards.'} onRetry={onRetry} />}

      {status === 'ready' && attention.length === 0 && (
        <PanelEmpty icon={<AllClearIcon color="success" />}>
          {totalCards === 0
            ? 'No cards saved yet.'
            : `No card expires in the next ${EXPIRING_SOON_DAYS} days.`}
        </PanelEmpty>
      )}

      {status === 'ready' && shown.length > 0 && (
        <>
          <List disablePadding aria-label="Cards needing attention">
            {shown.map((card) => {
              const meta = cardMetaLine(card);
              return (
                <ListItem key={card.id} disablePadding>
                  <ListItemButton
                    component={RouterLink}
                    to={canRenew ? HOME_LINKS.renewCard(card.id) : HOME_LINKS.secretDetail(card.id)}
                    sx={{ borderRadius: 1, px: 1, mx: -1, gap: 1.5, minHeight: 48 }}
                  >
                    <CardIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                    <ListItemText
                      primary={card.name}
                      secondary={meta}
                      sx={{ my: 0.5, minWidth: 0 }}
                      slotProps={{
                        primary: { noWrap: true, variant: 'body2', sx: { fontWeight: 500 } },
                        secondary: { noWrap: true, variant: 'caption' },
                      }}
                    />
                    <Box sx={{ flexShrink: 0 }}>
                      <CardExpiryBadge status={card.status} expiryLabel={card.expiryLabel} />
                    </Box>
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
          {hidden > 0 && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
              {`+${hidden} more in Cards`}
            </Typography>
          )}
        </>
      )}
    </DashboardPanel>
  );
}
