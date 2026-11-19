// =============================================================================
// US Social Security number structure check (pure, no I/O)
// =============================================================================

/** @stability experimental */
export type SsnCheckReason = 'format' | 'area' | 'group' | 'serial';

/** @stability experimental */
export interface SsnCheckResult {
  /** `AAA-GG-SSSS`, or `null` when the input is not nine digits. */
  normalized: string | null;
  ok: boolean;
  reason?: SsnCheckReason;
}

/**
 * Checks the structure of a US Social Security number: `###-##-####` or nine
 * digits; the area is not `000`, `666` or `900`-`999`, the group not `00`, the
 * serial not `0000`. A structural check only: it never says a number was
 * issued.
 *
 * @stability experimental
 */
export function checkSsn(value: string): SsnCheckResult {
  const m =
    /^(\d{3})-(\d{2})-(\d{4})$/.exec(value.trim()) ?? /^(\d{3})(\d{2})(\d{4})$/.exec(value.trim());
  if (!m) return { normalized: null, ok: false, reason: 'format' };
  const [, area, group, serial] = m;
  const normalized = `${area}-${group}-${serial}`;
  if (area === '000' || area === '666' || area >= '900')
    return { normalized, ok: false, reason: 'area' };
  if (group === '00') return { normalized, ok: false, reason: 'group' };
  if (serial === '0000') return { normalized, ok: false, reason: 'serial' };
  return { normalized, ok: true };
}
