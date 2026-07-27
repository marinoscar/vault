import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Alert,
  Breadcrumbs,
  Link,
  Box,
  Grid,
  Button,
  Tooltip,
  TextField,
  FormControlLabel,
  Switch,
  CircularProgress,
} from '@mui/material';
import { AddPhotoAlternate as ImportIcon } from '@mui/icons-material';
import { CardTile } from '../components/cards/CardTile';
import { useAiStatus } from '../hooks/useAiStatus';
import { useCards } from '../hooks/useCards';
import { isNeedsAttention } from '../utils/cardExpiry';

/**
 * Dedicated view for payment cards.
 *
 * Cards previously sat undifferentiated in the secrets list, so an expiry was
 * only discovered when a payment failed. Everything here is derived from values
 * the user already has — no new endpoint, no server-side expiry logic.
 */
export default function CardsPage() {
  const navigate = useNavigate();
  const { cards, isTruncated, totalItems, isLoading, error, fetchCards } = useCards();
  const { cardExtractEnabled, isLoading: isAiStatusLoading } = useAiStatus();
  const [search, setSearch] = useState('');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  // Counts describe the whole wallet, not the filtered view, so toggling the
  // filter never changes the headline numbers.
  const { expiredCount, expiringCount } = useMemo(
    () => ({
      expiredCount: cards.filter((card) => card.status === 'expired').length,
      expiringCount: cards.filter((card) => card.status === 'expiring_soon').length,
    }),
    [cards],
  );

  // `cards` arrives already sorted soonest-expiry-first from the hook; filtering
  // preserves that order.
  const visibleCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (needsAttentionOnly && !isNeedsAttention(card.status)) {
        return false;
      }
      if (!term) return true;
      return [card.name, card.network, card.cardholderName, card.issuingBank]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term));
    });
  }, [cards, needsAttentionOnly, search]);

  const attentionTotal = expiredCount + expiringCount;

  // Nothing is shown while the status is in flight, so the button never appears
  // and then vanishes under a user who is reaching for it.
  const isImportAvailable = !isAiStatusLoading && cardExtractEnabled;

  // Null when there is nothing worth saying: the empty state below already
  // spells out that there are no cards, and repeating it here reads as a bug.
  const summaryLine = (() => {
    if (isLoading) return 'Loading cards…';
    if (cards.length === 0) return null;
    if (attentionTotal === 0) {
      return `${cards.length} card${cards.length === 1 ? '' : 's'}, none expiring soon.`;
    }
    const parts: string[] = [];
    if (expiredCount > 0) parts.push(`${expiredCount} expired`);
    if (expiringCount > 0) parts.push(`${expiringCount} expiring soon`);
    return `${cards.length} card${cards.length === 1 ? '' : 's'} — ${parts.join(', ')}.`;
  })();

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          color="inherit"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          Home
        </Link>
        <Typography color="text.primary">Cards</Typography>
      </Breadcrumbs>

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          mb: 1,
        }}
      >
        <Typography variant="h4">Cards</Typography>

        {/* Gated on GET /api/ai/status: with the feature off, the wizard can
            only ever end in a 503 the user cannot act on, so the button is
            hidden rather than offered and disappointing. The status call fails
            closed, so a broken check hides the button too.

            `describeChild` keeps the tooltip a description: without it MUI puts
            the tooltip text in aria-label and the button loses its own name. */}
        {isImportAvailable && (
          <Tooltip describeChild title="Read the details from a photo of the card">
            <Button
              variant="contained"
              startIcon={<ImportIcon />}
              onClick={() => navigate('/cards/import')}
            >
              Import credit card
            </Button>
          </Tooltip>
        )}
      </Box>

      {summaryLine && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {summaryLine}
        </Typography>
      )}

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

      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label="Search cards"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flexGrow: 1, minWidth: 200 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={needsAttentionOnly}
              onChange={(e) => setNeedsAttentionOnly(e.target.checked)}
            />
          }
          label="Needs attention"
        />
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : cards.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary" gutterBottom>
            No cards yet.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add a card from the Secrets page to see its expiry status here.
          </Typography>
          <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={() => navigate('/secrets/new')}>
              Add a card
            </Button>
            {isImportAvailable && (
              <Button
                variant="contained"
                startIcon={<ImportIcon />}
                onClick={() => navigate('/cards/import')}
              >
                Import credit card
              </Button>
            )}
          </Box>
        </Box>
      ) : visibleCards.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">No cards match your filters.</Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {visibleCards.map((card) => (
            <Grid item xs={12} sm={6} md={4} key={card.id}>
              <CardTile card={card} onClick={(id) => navigate(`/secrets/${id}`)} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
