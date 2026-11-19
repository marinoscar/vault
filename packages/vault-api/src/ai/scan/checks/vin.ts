// =============================================================================
// Vehicle identification number check (ISO 3779, pure, no I/O)
// =============================================================================

/** @stability experimental */
export type VinCheckReason = 'format' | 'check';

/** @stability experimental */
export interface VinCheckResult {
  /** Upper case without spaces, or `null` when it is not 17 valid characters. */
  normalized: string | null;
  ok: boolean;
  reason?: VinCheckReason;
}

const TRANSLITERATION: Readonly<Record<string, number>> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * The check character (position 9) a 17-character VIN should carry: `0`-`9`
 * or `X` for 10.
 *
 * @stability experimental
 */
export function vinCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLITERATION[ch];
    sum += value * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/**
 * Checks a VIN: 17 characters from `A`-`Z` and `0`-`9` without `I`, `O` and
 * `Q`, and the check digit at position 9 (`X` = 10). The check digit is
 * mandatory in North America; elsewhere a mismatch is only a warning.
 *
 * @stability experimental
 */
export function checkVin(value: string): VinCheckResult {
  const vin = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { normalized: null, ok: false, reason: 'format' };
  if (vin[8] !== vinCheckDigit(vin)) return { normalized: vin, ok: false, reason: 'check' };
  return { normalized: vin, ok: true };
}
