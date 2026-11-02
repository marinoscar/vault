/**
 * Payment card formatting helpers.
 *
 * These exist so a stored card can be pasted straight into a checkout form.
 * Stored values come from a `Record<string, unknown>` whose shape is defined by
 * a user-editable secret type, so every input here is untrusted: a field may be
 * absent on older card secrets, may be a number rather than a string, and may
 * carry whatever separators the user typed. Every function returns a string and
 * none of them throw — malformed input yields '' so a copy button degrades to a
 * no-op instead of breaking the detail view.
 *
 * Pure functions only: no DOM access, so they are reusable from the cards view.
 */

/** Coerce an unknown stored field into a trimmed string. */
function toStringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  // Booleans, objects, arrays and symbols are never valid card fields.
  return '';
}

/** Strip everything that is not a digit. */
function digitsOnly(value: unknown): string {
  return toStringValue(value).replace(/\D/g, '');
}

/**
 * Card number as digits only — no spaces, no dashes.
 *
 * Checkout forms vary in whether they tolerate separators, and digits are
 * universally accepted, so we normalise on paste.
 */
export function formatCardNumberForCopy(value: unknown): string {
  return digitsOnly(value);
}

/**
 * Security code (CVV/CVC) as digits only.
 */
export function formatSecurityCodeForCopy(value: unknown): string {
  return digitsOnly(value);
}

/**
 * Expiry month as a zero-padded two-digit string, e.g. `3` -> `03`.
 *
 * Returns '' when the value is not a month in 1-12, so a garbage stored value
 * never produces a plausible-looking-but-wrong `00`.
 */
export function formatExpiryMonthForCopy(month: unknown): string {
  const digits = digitsOnly(month);
  if (digits === '') {
    return '';
  }
  const parsed = Number.parseInt(digits, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 12) {
    return '';
  }
  return String(parsed).padStart(2, '0');
}

/**
 * Expiry year as two digits, e.g. `2029` -> `29`, `29` -> `29`.
 *
 * Accepts either a 2- or 4-digit stored year. Anything else returns ''.
 */
export function formatExpiryYearShortForCopy(year: unknown): string {
  const digits = digitsOnly(year);
  if (digits.length === 2) {
    return digits;
  }
  if (digits.length === 4) {
    return digits.slice(2);
  }
  return '';
}

/**
 * Expiry year as four digits, e.g. `29` -> `2029`, `2029` -> `2029`.
 *
 * A 2-digit year is expanded into the 2000s, matching how every card expiry in
 * circulation is written.
 */
export function formatExpiryYearLongForCopy(year: unknown): string {
  const digits = digitsOnly(year);
  if (digits.length === 4) {
    return digits;
  }
  if (digits.length === 2) {
    return `20${digits}`;
  }
  return '';
}

/**
 * Expiry as `MM/YY`.
 *
 * Returns '' unless both halves are valid — a half-formed `12/` is worse than
 * nothing in a checkout field.
 */
export function formatExpiryForCopy(month: unknown, year: unknown): string {
  const mm = formatExpiryMonthForCopy(month);
  const yy = formatExpiryYearShortForCopy(year);
  if (mm === '' || yy === '') {
    return '';
  }
  return `${mm}/${yy}`;
}

/**
 * Display mask for a card number: all but the last four digits become bullets,
 * grouped in fours — `•••• •••• •••• 4242`.
 *
 * For display only; never use this as a copy value. Cards shorter than five
 * digits are masked entirely rather than leaking the whole number as "last
 * four".
 */
export function maskCardNumber(value: unknown): string {
  const digits = digitsOnly(value);
  if (digits === '') {
    return '';
  }

  const VISIBLE = 4;

  // Too short to reveal a meaningful "last four" without leaking the whole
  // number, so mask all of it.
  if (digits.length <= VISIBLE) {
    return '•'.repeat(digits.length);
  }

  const hiddenCount = digits.length - VISIBLE;
  const last = digits.slice(hiddenCount);

  // Group the masked portion in fours and keep the visible digits as their own
  // trailing group, so a 15-digit Amex renders '•••• •••• ••• 4242' rather than
  // splitting the real digits across groups.
  const maskedGroups = '•'.repeat(hiddenCount).match(/.{1,4}/g) ?? [];
  return [...maskedGroups, last].join(' ');
}
