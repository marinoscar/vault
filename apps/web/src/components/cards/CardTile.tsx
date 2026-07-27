import {
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Box,
  Button,
  Typography,
  Stack,
} from '@mui/material';
import {
  CreditCard as CreditCardIcon,
  Autorenew as RenewIcon,
} from '@mui/icons-material';
import { CardExpiryBadge } from './CardExpiryBadge';
import type { CardSummary } from '../../hooks/useCards';
import { isNeedsAttention } from '../../utils/cardExpiry';

/**
 * One payment card, presented as a card rather than a table row.
 *
 * Only the masked number is ever rendered here — a list view must never put a
 * full PAN on screen, so this component has no access to one: `CardSummary`
 * carries the masked string and nothing else.
 */

interface CardTileProps {
  card: CardSummary;
  onClick: (id: string) => void;
  /**
   * Start a renewal for this card.
   *
   * Offered on EVERY card, not only the expiring ones — a card can be reissued
   * after loss or fraud at any time, long before its printed date. Expiry
   * status only decides how prominent the button is.
   */
  onRenew?: (id: string) => void;
}

/**
 * Front-image thumbnail slot.
 *
 * Currently always a placeholder. Resolving a real image needs two hops —
 * attachment -> storageObject.id, then a signed-URL request per card — and the
 * generic storage download call does not exist in the API client yet, nor does
 * the attachment `role` that distinguishes front from back. Rendering a
 * deliberate placeholder keeps the layout final so wiring the real image later
 * is a drop-in change.
 */
function CardThumbnail({ hasAttachments }: { hasAttachments: boolean }) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: { xs: 56, sm: 64 },
        height: { xs: 36, sm: 40 },
        flexShrink: 0,
        borderRadius: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
        color: hasAttachments ? 'text.secondary' : 'action.disabled',
      }}
    >
      <CreditCardIcon fontSize="small" />
    </Box>
  );
}

export function CardTile({ card, onClick, onRenew }: CardTileProps) {
  // Older cards predate card_network / card_kind, so fall back to the secret's
  // own name rather than rendering an empty heading.
  const heading = card.network || card.name;
  const subheading = [card.kind, card.issuingBank].filter(Boolean).join(' · ');
  const needsAttention = isNeedsAttention(card.status);

  return (
    <Card
      variant="outlined"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardActionArea
        onClick={() => onClick(card.id)}
        sx={{ flexGrow: 1, alignItems: 'stretch' }}
      >
        <CardContent sx={{ height: '100%' }}>
          <Stack spacing={1.5} sx={{ height: '100%' }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
              <CardThumbnail hasAttachments={card.hasAttachments} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  {heading}
                </Typography>
                {subheading && (
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {subheading}
                  </Typography>
                )}
              </Box>
            </Box>

            <Box>
              <Typography
                variant="body1"
                sx={{ fontFamily: 'monospace', letterSpacing: 1, wordBreak: 'break-all' }}
              >
                {card.maskedNumber || '—'}
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Cardholder
                </Typography>
                <Typography variant="body2" noWrap>
                  {card.cardholderName || '—'}
                </Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Expires
                </Typography>
                <Typography variant="body2">{card.expiryLabel || 'Unknown'}</Typography>
              </Box>
            </Box>

            <Box sx={{ mt: 'auto' }}>
              <CardExpiryBadge status={card.status} expiryLabel={card.expiryLabel} />
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>

      {/* Outside the CardActionArea on purpose: a button nested inside another
          button is invalid markup and unreachable by keyboard in the order a
          user expects. */}
      {onRenew && (
        <CardActions sx={{ pt: 0 }}>
          <Button
            size="small"
            startIcon={<RenewIcon />}
            variant={needsAttention ? 'contained' : 'text'}
            color={card.status === 'expired' ? 'error' : 'primary'}
            onClick={() => onRenew(card.id)}
            aria-label={`Renew ${heading}`}
          >
            Renew
          </Button>
        </CardActions>
      )}
    </Card>
  );
}
