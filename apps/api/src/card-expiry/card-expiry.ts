import {
  CARD_EXPIRY_THRESHOLDS,
  type CardExpiryThreshold,
} from '../notifications-registry/vault-notification-data';

// =============================================================================
// Card expiry arithmetic (issue #86, E7.2): pure, no database, no secrets
// =============================================================================
//
// A card is valid through the LAST DAY of its expiry month. `daysLeft` counts whole UTC
// days from today to that day, so threshold 0 fires on the last day of the month, 7 a week
// before it and 30 thirty days before it.
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** A parsed expiry. */
export interface CardExpiry {
  month: number;
  year: number;
}

/**
 * Reads the `exp_month` / `exp_year` field values: a month 1-12 (`"7"`, `"07"`) and a four-digit
 * year, or a two-digit one (`"27"` is 2027). Anything else is `null` (the card is skipped).
 */
export function parseCardExpiry(month: unknown, year: unknown): CardExpiry | null {
  if (typeof month !== 'string' && typeof month !== 'number') return null;
  if (typeof year !== 'string' && typeof year !== 'number') return null;
  const m = String(month).trim();
  const y = String(year).trim();
  if (!/^\d{1,2}$/.test(m) || !/^(\d{2}|\d{4})$/.test(y)) return null;
  const monthNumber = parseInt(m, 10);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const yearNumber = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  return { month: monthNumber, year: yearNumber };
}

/** `MM/YYYY`. */
export function formatCardExpiry(expiry: CardExpiry): string {
  return `${String(expiry.month).padStart(2, '0')}/${expiry.year}`;
}

/** Whole UTC days from `now` to the last day of the expiry month; negative once it has passed. */
export function daysUntilExpiry(expiry: CardExpiry, now: Date): number {
  const lastDay = Date.UTC(expiry.year, expiry.month, 0); // day 0 of the next month
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((lastDay - today) / DAY_MS);
}

/**
 * The one threshold to notify now, or `null`. It is the most urgent threshold the card has
 * reached (`daysLeft <= threshold`), and only when it has not been notified already, so a
 * missed day (an outage) sends the current warning once instead of replaying the older ones.
 * An expired card (`daysLeft < 0`) is never notified.
 */
export function dueThreshold(daysLeft: number, notified: ReadonlySet<number>): CardExpiryThreshold | null {
  if (daysLeft < 0) return null;
  const reached = CARD_EXPIRY_THRESHOLDS.filter((threshold) => daysLeft <= threshold);
  if (reached.length === 0) return null;
  const mostUrgent = reached[reached.length - 1];
  return notified.has(mostUrgent) ? null : mostUrgent;
}
