// =============================================================================
// Date normalisers for document scanning (pure, no I/O)
// =============================================================================

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** `YYYY-MM-DD` when the date exists in the calendar, else `null`. */
function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0'
  )}`;
}

function monthNumber(token: string): number | null {
  const t = token.toLowerCase().replace(/\.$/, '');
  const abbr = MONTHS.indexOf(t);
  if (abbr >= 0) return abbr + 1;
  const full = MONTH_NAMES.indexOf(t);
  return full >= 0 ? full + 1 : null;
}

/**
 * Normalises a printed date to `YYYY-MM-DD`.
 *
 * Accepts `YYYY-MM-DD`, `DD MMM YYYY` (English month abbreviation or full
 * name, as printed on passports; a bilingual `MAR/MARS` takes the first part),
 * `MM/DD/YYYY` and `DD/MM/YYYY`. A slash date whose order nothing
 * disambiguates (`03/04/2025`) is `null`: it never guesses. `null` too for an
 * unknown shape or a date that does not exist.
 *
 * @stability experimental
 */
export function normalizeDate(input: string): string | null {
  const s = input.trim().replace(/\s+/g, ' ');

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const printed = /^(\d{1,2})[ -]([A-Za-z.]+)(?:\/[A-Za-z.]+)?[ -](\d{4})$/.exec(s);
  if (printed) {
    const month = monthNumber(printed[2]);
    return month === null ? null : isoDate(Number(printed[3]), month, Number(printed[1]));
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = Number(slash[3]);
    if (a === b) return isoDate(year, a, b);
    if (a > 12 && b <= 12) return isoDate(year, b, a); // DD/MM/YYYY
    if (b > 12 && a <= 12) return isoDate(year, a, b); // MM/DD/YYYY
    return null; // ambiguous, or neither part is a month
  }

  return null;
}

/**
 * Resolves an MRZ `YYMMDD` date to `YYYY-MM-DD`.
 *
 * - `birth`: the latest century that does not put the date after `today`.
 * - `expiry`: the century that places the date between 10 years before and 20
 *   years after `today`; `null` when no century does.
 *
 * `null` for anything that is not six digits or not a calendar date.
 *
 * @stability experimental
 */
export function mrzDate(
  yymmdd: string,
  kind: 'birth' | 'expiry',
  today: Date = new Date()
): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const todayIso = isoDate(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    today.getUTCDate()
  ) as string;
  const century = Math.floor(today.getUTCFullYear() / 100) * 100;

  if (kind === 'birth') {
    const current = isoDate(century + yy, month, day);
    if (current === null) return null;
    return current <= todayIso ? current : isoDate(century - 100 + yy, month, day);
  }

  const y = today.getUTCFullYear();
  const lower = isoDate(
    y - 10,
    today.getUTCMonth() + 1,
    Math.min(today.getUTCDate(), 28)
  ) as string;
  const upper = isoDate(
    y + 20,
    today.getUTCMonth() + 1,
    Math.min(today.getUTCDate(), 28)
  ) as string;
  for (const base of [century - 100, century, century + 100]) {
    const candidate = isoDate(base + yy, month, day);
    if (candidate !== null && candidate >= lower && candidate <= upper) return candidate;
  }
  return null;
}
