import {
  daysUntilDate as contractDaysUntilDate,
  documentExpiryLeadDays,
  parseDocumentDate,
} from '@marinoscar/vault-contract/secrets';

// =============================================================================
// Identity-document expiry arithmetic (IDOC-9): pure, no database, no secrets
// =============================================================================
//
// A document is valid through its `expiry_date`. `daysUntilDate` counts whole UTC calendar days
// from today to that day (0 on the day, negative after it). Each kind has its own lead days
// (`ID_DOCUMENT_KIND_CATALOG[kind].expiryLeadDays`, `PASSPORT_EXPIRY_LEAD_DAYS`); a reminder is due
// at each lead day, once per expiry.
// =============================================================================

export { parseDocumentDate };

/**
 * An expired document is reminded ("has expired") only within this many days after its expiry: a
 * scan that missed the expiry day still tells the owner, but a passport that lapsed years ago and
 * was stored for the record does not raise a message the day the feature ships.
 */
export const DOCUMENT_EXPIRED_GRACE_DAYS = 30;

/** Whole UTC calendar days from `today` to `isoDate`; 0 on the day, negative after it, `null` if invalid. */
export function daysUntilDate(isoDate: string, today: Date): number | null {
  return contractDaysUntilDate(isoDate, today);
}

/**
 * The lead days of a document: Passport → `PASSPORT_EXPIRY_LEAD_DAYS`; ID Document → the catalog
 * entry of its kind; an unknown kind → `Other`'s. `[]` (Social Security Card, any other type): no
 * reminders.
 */
export function leadDaysFor(typeName: string, documentKind: unknown): readonly number[] {
  return documentExpiryLeadDays(typeName, documentKind);
}

/**
 * The one lead day to notify now, or `null`: the SMALLEST lead day `>= days`, unless it was already
 * notified for this expiry. Thresholds skipped in between (a document saved 20 days before expiry,
 * a scan outage) are never replayed: the owner gets one message, for the most urgent lead day, and
 * the next day the same lead day is already notified. A renewed document has a new expiry, so its
 * `alreadyNotified` set starts empty and the thresholds restart.
 *
 * An expired document (`days < 0`) maps to the 0 lead day, within {@link DOCUMENT_EXPIRED_GRACE_DAYS}.
 */
export function dueThreshold(
  days: number,
  leadDays: readonly number[],
  alreadyNotified: ReadonlySet<number>,
): number | null {
  if (days < -DOCUMENT_EXPIRED_GRACE_DAYS) return null;
  const reached = leadDays.filter((lead) => lead >= days);
  if (reached.length === 0) return null;
  const smallest = Math.min(...reached);
  return alreadyNotified.has(smallest) ? null : smallest;
}
