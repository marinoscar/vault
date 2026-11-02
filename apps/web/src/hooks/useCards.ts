import { useState, useCallback, useRef } from 'react';
import type { CardSummaryItem } from '../types';
import { getCardSummaries } from '../services/api';
import { formatExpiryForCopy } from '../utils/cardFormat';
import { getCardExpiryStatus, getCardExpirySortKey, type CardExpiryStatus } from '../utils/cardExpiry';

/** The system secret type that holds payment cards. */
const CARD_TYPE_NAME = 'Card';

/** The API's maximum page size for `GET /api/secrets/cards/summary`. */
const CARD_SUMMARY_PAGE_SIZE = 100;

/**
 * Safety bound on pages fetched in one load (100 cards each). A wallet larger
 * than this is reported as truncated rather than looping without end.
 */
const MAX_CARD_PAGES = 50;

/**
 * A card flattened for display. Every field is already a rendered string, so the
 * view layer never touches raw values beyond what it shows.
 *
 * Built from `GET /api/secrets/cards/summary` (#118), which decrypts server-side
 * and returns only the last four digits and the expiry: the full number and the
 * CVV never reach the browser on Home or in the gallery.
 */
export interface CardSummary {
  id: string;
  name: string;
  /** Last four digits, or null when the stored number is unusable. */
  last4: string | null;
  /** `•••• 4242`, or '' when the number is unknown. Never the full PAN. */
  maskedNumber: string;
  /** `MM/YY`, or '' when the stored expiry is unusable. */
  expiryLabel: string;
  status: CardExpiryStatus;
  /** Ascending sort key; unknown expiries sort last. */
  expirySortKey: number;
  updatedAt: string;
}

/**
 * Flatten one summary row into its display shape.
 *
 * `now` is threaded through so a whole page classifies against a single instant
 * rather than drifting mid-render, and so tests stay deterministic.
 */
export function toCardSummary(item: CardSummaryItem, now: Date = new Date()): CardSummary {
  const last4 = typeof item.last4 === 'string' && /^\d{4}$/.test(item.last4) ? item.last4 : null;
  return {
    id: item.id,
    name: item.name,
    last4,
    maskedNumber: last4 ? `•••• ${last4}` : '',
    expiryLabel: formatExpiryForCopy(item.expMonth, item.expYear),
    status: getCardExpiryStatus(item.expMonth, item.expYear, now),
    expirySortKey: getCardExpirySortKey(item.expMonth, item.expYear),
    updatedAt: item.updatedAt,
  };
}

/**
 * What to load.
 * - `all` (the gallery): every card, page after page until `totalPages`.
 * - `attention` (Home): stop after the first page that ends past the
 *   attention window. The API sorts soonest expiry first, so expired and
 *   expiring cards are a prefix of the list and one request is the norm.
 */
export type CardLoadScope = 'all' | 'attention';

interface FetchCardsParams {
  now?: Date;
  scope?: CardLoadScope;
}

interface UseCardsResult {
  cards: CardSummary[];
  /** Total cards the API reports, which may exceed what was loaded. */
  totalItems: number;
  /** True when a full load stopped at the page bound with cards left over. */
  isTruncated: boolean;
  isLoading: boolean;
  error: string | null;
  fetchCards: (params?: FetchCardsParams) => Promise<void>;
}

/** True once a page's last row proves no later row can need attention. */
function isPastAttentionWindow(item: CardSummaryItem, summary: CardSummary): boolean {
  // `valid` means later than every expired/expiring card; a null year sorts
  // last on the API, so everything after it is unknown too.
  return summary.status === 'valid' || item.expYear === null;
}

/**
 * Load the current user's payment cards with expiry status attached, from the
 * single summary endpoint (one request per 100 cards, instead of one detail
 * request per card).
 */
export function useCards(): UseCardsResult {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest load may write state, so a retry never races a slow first try.
  const loadId = useRef(0);

  const fetchCards = useCallback(async (params?: FetchCardsParams) => {
    const id = ++loadId.current;
    const scope = params?.scope ?? 'all';
    const now = params?.now ?? new Date();
    setIsLoading(true);
    setError(null);
    try {
      const loaded: CardSummary[] = [];
      let total = 0;
      let page = 1;
      let totalPages = 1;
      let stoppedEarly = false;
      do {
        const response = await getCardSummaries({ page, pageSize: CARD_SUMMARY_PAGE_SIZE });
        total = response.meta.totalItems;
        totalPages = response.meta.totalPages;
        const summaries = response.items.map((item) => toCardSummary(item, now));
        loaded.push(...summaries);

        const lastItem = response.items[response.items.length - 1];
        const lastSummary = summaries[summaries.length - 1];
        if (scope === 'attention' && lastItem && isPastAttentionWindow(lastItem, lastSummary)) {
          stoppedEarly = true;
          break;
        }
        if (response.items.length === 0) break;
        page += 1;
      } while (page <= totalPages && page <= MAX_CARD_PAGES);

      if (id !== loadId.current) return;
      // The API already sorts by expiry; a stable client sort keeps "unknown
      // last" exact for a card with a year but no usable month.
      loaded.sort((a, b) => a.expirySortKey - b.expirySortKey);
      setCards(loaded);
      setTotalItems(total);
      setIsTruncated(!stoppedEarly && scope === 'all' && loaded.length < total);
    } catch (err) {
      if (id !== loadId.current) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch cards';
      setError(message);
      setCards([]);
      setTotalItems(0);
      setIsTruncated(false);
    } finally {
      if (id === loadId.current) setIsLoading(false);
    }
  }, []);

  return { cards, totalItems, isTruncated, isLoading, error, fetchCards };
}

export { CARD_SUMMARY_PAGE_SIZE, MAX_CARD_PAGES, CARD_TYPE_NAME };
