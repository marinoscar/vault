import { useState, useCallback } from 'react';
import type { SecretDetail } from '../types';
import { getSecretTypes, getSecrets, getSecret } from '../services/api';
import { maskCardNumber, formatExpiryForCopy } from '../utils/cardFormat';
import { getCardExpiryStatus, getCardExpirySortKey, type CardExpiryStatus } from '../utils/cardExpiry';

/** The system secret type that holds payment cards. */
const CARD_TYPE_NAME = 'Card';

/**
 * Upper bound on cards loaded in one go.
 *
 * Expiry status is derived client-side from decrypted values, so it cannot be
 * sorted or filtered by the API. Paginating server-side would therefore sort
 * only within a page and make "soonest first" quietly wrong across pages, and
 * would make the header counts describe a page instead of the wallet. We fetch
 * one generous page instead and report truncation honestly.
 */
const MAX_CARDS = 100;

/**
 * A card flattened for display. Every field is already a rendered string, so the
 * view layer never touches raw decrypted values beyond what it shows.
 */
export interface CardSummary {
  id: string;
  name: string;
  description: string | null;
  /** Issuing network, e.g. 'Visa'. Empty on cards created before the field existed. */
  network: string;
  /** 'Credit' / 'Debit'. Empty on older cards. */
  kind: string;
  cardholderName: string;
  issuingBank: string;
  /** Masked for display — never the full PAN. */
  maskedNumber: string;
  /** `MM/YY`, or '' when the stored expiry is unusable. */
  expiryLabel: string;
  status: CardExpiryStatus;
  /** Ascending sort key; unknown expiries sort last. */
  expirySortKey: number;
  /** True when the card has at least one attachment (see thumbnail note below). */
  hasAttachments: boolean;
  updatedAt: string;
}

/** Read a stored field as a trimmed display string; never throws. */
function displayString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Flatten one decrypted card secret into its display shape.
 *
 * `now` is threaded through so a whole page classifies against a single instant
 * rather than drifting mid-render, and so tests stay deterministic.
 */
export function toCardSummary(secret: SecretDetail, now: Date = new Date()): CardSummary {
  const values = secret.values ?? {};
  const expMonth = values.exp_month;
  const expYear = values.exp_year;

  return {
    id: secret.id,
    name: secret.name,
    description: secret.description,
    network: displayString(values.card_network),
    kind: displayString(values.card_kind),
    cardholderName: displayString(values.cardholder_name),
    issuingBank: displayString(values.issuing_bank),
    maskedNumber: maskCardNumber(values.number),
    expiryLabel: formatExpiryForCopy(expMonth, expYear),
    status: getCardExpiryStatus(expMonth, expYear, now),
    expirySortKey: getCardExpirySortKey(expMonth, expYear),
    hasAttachments: (secret.attachments?.length ?? 0) > 0,
    updatedAt: secret.updatedAt,
  };
}

interface UseCardsResult {
  cards: CardSummary[];
  /** Total cards the API reports, which may exceed what was loaded. */
  totalItems: number;
  /** True when the API holds more cards than MAX_CARDS. */
  isTruncated: boolean;
  isLoading: boolean;
  error: string | null;
  fetchCards: (params?: { search?: string; now?: Date }) => Promise<void>;
}

/**
 * Load the current user's payment cards with expiry status attached.
 *
 * The list endpoint returns metadata only — a card's number and expiry live in
 * the per-secret detail response — so this necessarily fans out to one detail
 * request per card. Reads are not audited server-side, so this costs latency
 * rather than audit noise. A card whose detail fetch fails is dropped rather
 * than failing the whole view.
 */
export function useCards(): UseCardsResult {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCards = useCallback(async (params?: { search?: string; now?: Date }) => {
    setIsLoading(true);
    setError(null);
    try {
      // There is no category column on SecretType, so the Card type is
      // identified by the name of the system type.
      const types = await getSecretTypes({ includeSystem: true });
      const cardType = types.find((type) => type.isSystem && type.name === CARD_TYPE_NAME);

      if (!cardType) {
        setCards([]);
        setTotalItems(0);
        setIsTruncated(false);
        return;
      }

      const response = await getSecrets({
        typeId: cardType.id,
        page: 1,
        pageSize: MAX_CARDS,
        search: params?.search || undefined,
      });

      const details = await Promise.allSettled(
        response.items.map((item) => getSecret(item.id)),
      );

      const now = params?.now ?? new Date();
      const summaries = details
        .filter(
          (result): result is PromiseFulfilledResult<SecretDetail> =>
            result.status === 'fulfilled',
        )
        .map((result) => toCardSummary(result.value, now))
        .sort((a, b) => a.expirySortKey - b.expirySortKey);

      setCards(summaries);
      setTotalItems(response.meta.totalItems);
      setIsTruncated(response.meta.totalItems > response.items.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch cards';
      setError(message);
      setCards([]);
      setTotalItems(0);
      setIsTruncated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { cards, totalItems, isTruncated, isLoading, error, fetchCards };
}

export { MAX_CARDS, CARD_TYPE_NAME };
