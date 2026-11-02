import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Grid,
  InputAdornment,
  Paper,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material';
import {
  AddCardOutlined as AddIcon,
  CreditCardOutlined as CardIcon,
  DocumentScannerOutlined as ScanIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { CardTile } from '../components/CardTile.js';
import { useAiStatus } from '../../../core/headless/useAiStatus.js';
import { useCards, type CardSummary } from '../../headless/useCards.js';
import { EXPIRING_SOON_DAYS, isNeedsAttention } from '../../headless/cardExpiry.js';

/**
 * The gallery's status filter (E10.5, spec §8). `attention` is expiring soon
 * OR expired: what the Home dashboard's "Cards needing attention" links to.
 */
export type CardFilter = 'all' | 'attention' | 'expiring_soon' | 'expired';

const FILTERS: { value: CardFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'expiring_soon', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
];

/**
 * Read `?filter=` (all | attention | expiring_soon | expired; `expiring` is
 * accepted for expiring_soon). Anything else, or nothing, is `all`.
 */
export function parseCardFilter(raw: string | null): CardFilter {
  switch (raw) {
    case 'attention':
    case 'expiring_soon':
    case 'expired':
      return raw;
    case 'expiring':
      return 'expiring_soon';
    default:
      return 'all';
  }
}

function matchesFilter(card: CardSummary, filter: CardFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return isNeedsAttention(card.status);
  return card.status === filter;
}

/**
 * The Cards destination: a gallery of the user's payment cards (E10.5, #96).
 *
 * Cards previously sat undifferentiated in the secrets list, so an expiry was
 * only discovered when a payment failed. Everything here is derived from values
 * the user already has; since #118 they arrive in one paged
 * `GET /api/secrets/cards/summary` (display fields only) instead of
 * one decrypted detail request per card.
 *
 * Layout: a header with the two ways to add a card (scan, gated on AI; manual),
 * a toolbar with search and the status filter chips, then a responsive grid of
 * `CardTile`s (one column on a phone, two from `sm`, three from `md`). The
 * shell's `<main>` already pads the page, so the container adds no gutters of
 * its own (no double padding on a phone).
 */
export default function CardsPage() {
  const navigate = useNavigate();
  const { cards, isTruncated, totalItems, isLoading, error, fetchCards } = useCards();
  const { cardExtractEnabled, isLoading: isAiStatusLoading } = useAiStatus();
  const [search, setSearch] = useState('');
  // The filter lives in the URL (`?filter=`), so the Home dashboard can link
  // straight to a filtered gallery and the choice survives a reload or Back.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseCardFilter(searchParams.get('filter'));
  const setFilter = (next: CardFilter) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'all') params.delete('filter');
        else params.set('filter', next);
        return params;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  // Counts describe the whole wallet, not the filtered view, so choosing a
  // filter never changes the headline numbers or the chip counts.
  const counts = useMemo<Record<CardFilter, number>>(
    () => ({
      all: cards.length,
      attention: cards.filter((card) => isNeedsAttention(card.status)).length,
      expiring_soon: cards.filter((card) => card.status === 'expiring_soon').length,
      expired: cards.filter((card) => card.status === 'expired').length,
    }),
    [cards],
  );

  // `cards` arrives already sorted soonest-expiry-first from the hook; filtering
  // preserves that order.
  const visibleCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (!matchesFilter(card, filter)) return false;
      if (!term) return true;
      return [card.name, card.last4 ?? '', card.network, card.issuingBank, card.cardholderName]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term));
    });
  }, [cards, filter, search]);

  const attentionTotal = counts.expired + counts.expiring_soon;

  // Nothing is shown while the status is in flight, so the button never appears
  // and then vanishes under a user who is reaching for it. Gated on
  // GET /api/ai/config (`useAiStatus`, `isCardScanAvailable`): with card scanning
  // unavailable the wizard can only end in a 503 the user cannot act on. The
  // check fails closed.
  const isScanAvailable = !isAiStatusLoading && cardExtractEnabled;

  const goScan = () => navigate('/cards/import');
  const goManual = () => navigate('/secrets/new');

  // Null when there is nothing worth saying: the empty state below already
  // spells out that there are no cards, and repeating it here reads as a bug.
  const summaryLine = (() => {
    if (isLoading || cards.length === 0) return null;
    const total = `${cards.length} card${cards.length === 1 ? '' : 's'}`;
    if (attentionTotal === 0) return `${total}, none expiring soon.`;
    const parts: string[] = [];
    if (counts.expired > 0) parts.push(`${counts.expired} expired`);
    if (counts.expiring_soon > 0) parts.push(`${counts.expiring_soon} expiring soon`);
    return `${total} — ${parts.join(', ')}.`;
  })();

  const hasCards = !isLoading && cards.length > 0;

  return (
    <Container maxWidth="lg" disableGutters>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1">
            Cards
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {isLoading ? 'Loading cards…' : summaryLine ?? 'Your payment cards and when they expire.'}
          </Typography>
        </Box>

        {/* The header actions repeat the empty state's, so they are only shown
            once there is a gallery to sit above. */}
        {hasCards && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={goManual}
              sx={{ flex: { xs: 1, sm: 'none' } }}
            >
              Add manually
            </Button>
            {isScanAvailable && (
              <Button
                variant="contained"
                startIcon={<ScanIcon />}
                onClick={goScan}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                Scan a card
              </Button>
            )}
          </Box>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isTruncated && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Showing the first {cards.length} of {totalItems} cards.
        </Alert>
      )}

      {hasCards && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 1.5,
            mb: 2.5,
          }}
        >
          <TextField
            label="Search cards"
            placeholder="Name, last 4, network, bank or holder"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flexGrow: 1, maxWidth: { sm: 420 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box
            role="group"
            aria-label="Filter cards by expiry"
            sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}
          >
            {FILTERS.map(({ value, label }) => {
              const selected = filter === value;
              return (
                <Chip
                  key={value}
                  label={`${label} (${counts[value]})`}
                  clickable
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  aria-pressed={selected}
                  onClick={() => setFilter(value)}
                  sx={{ fontWeight: selected ? 600 : 500 }}
                />
              );
            })}
          </Box>
        </Box>
      )}

      {isLoading ? (
        <Grid container spacing={2} aria-busy="true" aria-label="Loading cards">
          {[0, 1, 2].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
              <Skeleton variant="rounded" sx={{ aspectRatio: '1.45', height: 'auto', borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
      ) : cards.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{ py: { xs: 5, sm: 7 }, px: 3, textAlign: 'center', borderStyle: 'dashed' }}
        >
          {/* The amber accent as a fill (spec §5: empty-state glyph); the glyph
              on it is the slate on-accent colour. */}
          <Box
            aria-hidden="true"
            sx={{
              width: 64,
              height: 64,
              mx: 'auto',
              mb: 2,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'secondary.main',
              color: 'secondary.contrastText',
            }}
          >
            <CardIcon sx={{ fontSize: 32 }} />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No cards yet
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420, mx: 'auto' }}>
            {isScanAvailable
              ? 'Scan a card with your camera and check the details, or type them in yourself. '
              : 'Add a card and type its details in. '}
            Vault warns you {EXPIRING_SOON_DAYS} days before a card expires.
          </Typography>
          <Box sx={{ mt: 3, display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
            {isScanAvailable && (
              <Button variant="contained" startIcon={<ScanIcon />} onClick={goScan}>
                Scan a card
              </Button>
            )}
            <Button variant="outlined" startIcon={<AddIcon />} onClick={goManual}>
              Add manually
            </Button>
          </Box>
        </Paper>
      ) : visibleCards.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography sx={{ color: 'text.secondary', mb: 1.5 }}>
            No cards match your filters.
          </Typography>
          <Button
            onClick={() => {
              setSearch('');
              setFilter('all');
            }}
          >
            Show all cards
          </Button>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {visibleCards.map((card) => (
            <Grid key={card.id} size={{ xs: 12, sm: 6, md: 4 }}>
              {/* Renewal is offered on every card and is NOT gated on
                  `isScanAvailable`. Unlike the import wizard, the renewal
                  flow is fully usable with AI switched off — it falls back to a
                  manual edit — so hiding it behind the AI check would take a
                  working feature away from exactly the users who cannot turn AI
                  on. */}
              <CardTile
                card={card}
                onClick={(id) => navigate(`/secrets/${id}`)}
                onRenew={(id) => navigate(`/cards/${id}/renew`)}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
