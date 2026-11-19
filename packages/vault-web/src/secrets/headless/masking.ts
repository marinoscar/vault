/**
 * Display masks for sensitive values. Display only: a mask is never a copy
 * value, and the stored value is always whole.
 */

/** The bullet a masked character becomes. */
export const MASK_CHAR = '•';

/** How many trailing characters a last-4 mask keeps. */
const VISIBLE = 4;

export interface MaskLast4Options {
  /**
   * Group the hidden part in fours (`•••• •••• •••• 4242`, the card number
   * display) instead of the fixed `•••• 4242` prefix.
   */
  groupHidden?: boolean;
}

/**
 * Mask all but the last four non-space characters of a value: `•••• 4567` by
 * default, or `•••• •••• •••• 4242` with `groupHidden`.
 *
 * A value of four characters or fewer is masked entirely (one bullet per
 * character) rather than leaking the whole value as its "last four". '' for an
 * empty value.
 */
export function maskLast4(value: unknown, options: MaskLast4Options = {}): string {
  const chars = value === undefined || value === null ? '' : String(value).replace(/\s+/g, '');
  if (chars === '') return '';
  if (chars.length <= VISIBLE) return MASK_CHAR.repeat(chars.length);

  const hiddenCount = chars.length - VISIBLE;
  const last = chars.slice(hiddenCount);
  if (!options.groupHidden) return `${MASK_CHAR.repeat(VISIBLE)} ${last}`;

  // Keep the visible characters as their own trailing group, so a 15-digit
  // Amex renders '•••• •••• ••• 0005' rather than splitting them across groups.
  const maskedGroups = MASK_CHAR.repeat(hiddenCount).match(/.{1,4}/g) ?? [];
  return [...maskedGroups, last].join(' ');
}
