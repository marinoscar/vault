import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Autorenew as RenewIcon,
  ContactlessOutlined as ContactlessIcon,
} from '@mui/icons-material';
import { CardExpiryBadge } from './CardExpiryBadge';
import type { CardSummary } from '../../hooks/useCards';
import { isNeedsAttention } from '../../utils/cardExpiry';
import { CARD_ASPECT_RATIO } from '../../utils/cardImage';

/**
 * One payment card, drawn as a card (E10.5, issue #96; spec §8).
 *
 * The tile is a card face in the brand colour (a `primary` gradient, read from
 * the theme so light and dark both hold their contrast) carrying the facts a
 * user scans a wallet for: the name they gave the card, the last four digits
 * and the expiry. Below the face sit the expiry badge and the Renew action.
 *
 * The data comes from `GET /api/secrets/cards/summary` (#118), which returns
 * only the name, the last four digits and the expiry: the gallery no longer
 * decrypts every card in the browser, so network, kind, issuing bank and
 * cardholder live on the card's detail page only.
 *
 * Only `•••• last4` is ever rendered here — a list view must never put a full
 * PAN on screen, and this component never receives one. Never the CVV either.
 *
 * Every tile has the same height (the face keeps the ISO card aspect ratio and
 * the footer is one row), so the gallery reads as a uniform grid on a phone.
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

export function CardTile({ card, onClick, onRenew }: CardTileProps) {
  const theme = useTheme();
  // `name` is required on a secret, so the fallback only guards a blank row.
  const heading = card.name || 'Card';
  const needsAttention = isNeedsAttention(card.status);
  const isExpired = card.status === 'expired';

  // The face: the brand primary, or a muted slate once the card is dead, so an
  // expired card recedes in the grid (the badge still says so in words). Both
  // gradients are read from the theme; no colour is written here.
  //
  // Light mode: a solid deep-teal face (primary.dark -> primary.main) with
  // white text (7.37:1 and up). Dark mode: the dark primary is a bright teal,
  // which would glare in a dark gallery, so the face is a TONAL teal (primary
  // at 38% -> 18% over the paper) with the body text colour (about 6:1).
  const { palette } = theme;
  const isDark = palette.mode === 'dark';
  let faceBackground: string;
  let onFace: string;
  if (isExpired) {
    const start = palette.grey[isDark ? 800 : 700];
    const end = palette.grey[isDark ? 700 : 600];
    faceBackground = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
    onFace = palette.getContrastText(start);
  } else if (isDark) {
    faceBackground = `linear-gradient(135deg, ${alpha(palette.primary.main, 0.38)} 0%, ${alpha(palette.primary.main, 0.18)} 100%), ${palette.background.paper}`;
    onFace = palette.text.primary;
  } else {
    faceBackground = `linear-gradient(135deg, ${palette.primary.dark} 0%, ${palette.primary.main} 100%)`;
    onFace = palette.primary.contrastText;
  }
  const onFaceMuted = alpha(onFace, 0.82);

  return (
    <Card
      variant="outlined"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      data-testid="card-tile"
      data-status={card.status}
    >
      <CardActionArea
        onClick={() => onClick(card.id)}
        sx={{ p: 1.5, pb: 1, alignItems: 'stretch' }}
      >
        <Box
          sx={{
            position: 'relative',
            aspectRatio: String(CARD_ASPECT_RATIO),
            borderRadius: 2,
            p: { xs: 2, sm: 1.75, md: 2 },
            display: 'flex',
            flexDirection: 'column',
            color: onFace,
            background: faceBackground,
            overflow: 'hidden',
            // A soft sheen so the face reads as a card, not a coloured box.
            '&::after': {
              content: '""',
              position: 'absolute',
              right: '-20%',
              top: '-45%',
              width: '75%',
              aspectRatio: '1',
              borderRadius: '50%',
              background: alpha(onFace, 0.08),
              pointerEvents: 'none',
            },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography
                variant="subtitle1"
                component="h3"
                noWrap
                sx={{ fontWeight: 600, lineHeight: 1.3 }}
              >
                {heading}
              </Typography>
            </Box>
            <ContactlessIcon aria-hidden="true" sx={{ color: onFaceMuted, flexShrink: 0 }} />
          </Box>

          {/* A drawn EMV chip: decorative, so the face reads as a card. */}
          <Box
            aria-hidden="true"
            sx={{
              mt: { xs: 1.5, sm: 1, md: 1.5 },
              width: 38,
              height: 28,
              borderRadius: 1,
              border: '1px solid',
              borderColor: alpha(onFace, 0.35),
              background: `linear-gradient(135deg, ${alpha(onFace, 0.28)}, ${alpha(onFace, 0.12)})`,
            }}
          />

          {/* Bottom row: `•••• last4` and the expiry. Missing data reads as a
              dash, never as a plausible-looking guess. */}
          <Box sx={{ mt: 'auto', display: 'flex', alignItems: 'flex-end', gap: 2, minWidth: 0 }}>
            <Typography
              variant="body1"
              sx={{
                flexGrow: 1,
                minWidth: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: { xs: '1.05rem', sm: '1rem', md: '1.05rem' },
                letterSpacing: 1.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {card.maskedNumber || '•••• —'}
            </Typography>
            <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
              <Typography
                variant="caption"
                sx={{ color: onFaceMuted, display: 'block', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' }}
              >
                Expires
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                {card.expiryLabel || '—'}
              </Typography>
            </Box>
          </Box>
        </Box>
      </CardActionArea>

      {/* Outside the CardActionArea on purpose: a button nested inside another
          button is invalid markup and unreachable by keyboard in the order a
          user expects. */}
      <CardActions
        sx={{
          px: 1.5,
          pt: 0.5,
          pb: 1.5,
          mt: 'auto',
          gap: 1,
          justifyContent: 'space-between',
          flexWrap: 'nowrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <CardExpiryBadge status={card.status} expiryLabel={card.expiryLabel} />
        </Box>
        {onRenew && (
          <Button
            size="small"
            startIcon={<RenewIcon />}
            variant={needsAttention ? 'contained' : 'text'}
            color={isExpired ? 'error' : 'primary'}
            onClick={() => onRenew(card.id)}
            // Names the card the way the user does — with several cards on one
            // network, "Renew American Express" would be ambiguous read aloud.
            aria-label={`Renew ${heading}`}
            sx={{ flexShrink: 0, ml: 'auto' }}
          >
            Renew
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
