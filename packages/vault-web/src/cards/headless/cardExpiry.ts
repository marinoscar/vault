/**
 * Payment card expiry status derivation.
 *
 * A stored card's expiry reaches us from a `Record<string, unknown>` whose shape
 * is defined by a user-editable secret type, so every input here is untrusted: a
 * field may be absent on card secrets created before the expiry fields existed,
 * may be a number rather than a string, and may carry whatever the user typed.
 * Nothing here throws — unusable input yields `'unknown'` so the cards view
 * renders an honest "unknown expiry" badge instead of a plausible-but-wrong
 * "valid".
 *
 * Pure functions only: no DOM access and no ambient clock read that a caller
 * cannot override, so this is reusable from the renewal flow.
 */

/**
 * A card counts as "expiring soon" once it is within this many days of lapsing.
 *
 * Exported so callers can describe the window ("expiring within 60 days")
 * without restating the number and drifting out of sync with this module.
 */
export const EXPIRING_SOON_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The window, in milliseconds, used for the `expiring_soon` comparison. */
export const EXPIRING_SOON_MS = EXPIRING_SOON_DAYS * MS_PER_DAY;

export type CardExpiryStatus = 'expired' | 'expiring_soon' | 'valid' | 'unknown';

/**
 * Parse a stored expiry month into 1-12.
 *
 * Returns null rather than clamping: a stored `13` is a data problem, and
 * silently reading it as December would put a wrong date in front of the user.
 */
function parseExpiryMonth(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const digits = String(value).trim();
  // Reject anything that is not purely digits: '7abc' is not a month.
  if (!/^\d{1,2}$/.test(digits)) {
    return null;
  }
  const month = Number.parseInt(digits, 10);
  if (month < 1 || month > 12) {
    return null;
  }
  return month;
}

/**
 * Parse a stored expiry year into a full four-digit year in 2000-2099.
 *
 * Deliberately stricter than `cardFormat`'s copy helpers, which expand a
 * two-digit year into the 2000s for pasting into a checkout form. Guessing is
 * safe when the user can see the result in the field they pasted into; it is not
 * safe here, where the guess silently decides whether we tell someone their card
 * is dead. A two-digit year therefore reads as `'unknown'` — an honest "we don't
 * know" badge — rather than resolving `'20'` to 2020 and asserting "expired".
 * The API normalises AI-imported years to four digits, so this is the canonical
 * stored shape.
 */
function parseExpiryYear(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const digits = String(value).trim();
  if (!/^\d{4}$/.test(digits)) {
    return null;
  }
  const year = Number.parseInt(digits, 10);
  if (year < 2000 || year > 2099) {
    return null;
  }
  return year;
}

/**
 * The instant a card stops being valid: midnight at the start of the month
 * AFTER the printed expiry month.
 *
 * A card printed `07/2026` is good through 2026-07-31T23:59:59.999, so the
 * exclusive end is 2026-08-01T00:00:00. Passing the 1-based month straight into
 * the 0-based `Date` month argument produces exactly that next-month boundary,
 * and `Date` normalises the December rollover (month 12 of 2026 becomes January
 * 2027) on its own.
 *
 * Local time is deliberate: "my card expires at the end of July" is a statement
 * about the cardholder's calendar, not UTC's.
 */
export function getCardExpiryEnd(expMonth: unknown, expYear: unknown): Date | null {
  const month = parseExpiryMonth(expMonth);
  const year = parseExpiryYear(expYear);
  if (month === null || year === null) {
    return null;
  }
  return new Date(year, month, 1, 0, 0, 0, 0);
}

/**
 * Classify a stored card expiry relative to `now`.
 *
 * `now` is injectable so callers (and tests) are not at the mercy of the ambient
 * clock. It defaults to the current time for ordinary UI use.
 *
 * A card is valid through the END of its expiry month, so a card marked 07/2026
 * is still `'valid'` on 2026-07-31 and only becomes `'expired'` on 2026-08-01.
 */
export function getCardExpiryStatus(
  expMonth: unknown,
  expYear: unknown,
  now: Date = new Date(),
): CardExpiryStatus {
  const expiryEnd = getCardExpiryEnd(expMonth, expYear);
  if (expiryEnd === null) {
    return 'unknown';
  }

  // A caller can hand us an Invalid Date; treating it as a real instant would
  // make every comparison false and mislabel every card 'valid'.
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return 'unknown';
  }

  const remainingMs = expiryEnd.getTime() - nowMs;

  // The boundary instant itself is already past the card's last valid moment.
  if (remainingMs <= 0) {
    return 'expired';
  }

  // Inclusive: landing exactly on the threshold counts as expiring soon, so the
  // warning appears a full window ahead rather than a millisecond short.
  if (remainingMs <= EXPIRING_SOON_MS) {
    return 'expiring_soon';
  }

  return 'valid';
}

/**
 * Sort key for "soonest expiry first".
 *
 * Cards with an unusable expiry sort last: we cannot claim they need attention,
 * and floating them to the top would bury the cards that actually do.
 */
export function getCardExpirySortKey(expMonth: unknown, expYear: unknown): number {
  const expiryEnd = getCardExpiryEnd(expMonth, expYear);
  return expiryEnd === null ? Number.POSITIVE_INFINITY : expiryEnd.getTime();
}

/** Whether a status is one the user should act on. */
export function isNeedsAttention(status: CardExpiryStatus): boolean {
  return status === 'expired' || status === 'expiring_soon';
}
