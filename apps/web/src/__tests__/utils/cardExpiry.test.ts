import { describe, it, expect } from 'vitest';
import {
  getCardExpiryStatus,
  getCardExpiryEnd,
  getCardExpirySortKey,
  isNeedsAttention,
  EXPIRING_SOON_DAYS,
  EXPIRING_SOON_MS,
} from '../../utils/cardExpiry';

/**
 * `now` is injected everywhere below, so these are pure-function tests with no
 * fake timers and no dependence on when the suite happens to run.
 *
 * Instants are built with the local-time `Date` constructor to match the
 * module's own local-time reasoning ("end of July" is the cardholder's July).
 * Where a test asserts a to-the-millisecond boundary it derives the instant from
 * `getCardExpiryEnd`/`EXPIRING_SOON_MS` rather than hardcoding a date, so a
 * daylight-saving transition inside the window cannot make the arithmetic drift.
 */

/** Local-time helper mirroring how the module builds its boundary. */
function localDate(
  year: number,
  month1Based: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): Date {
  return new Date(year, month1Based - 1, day, hours, minutes, seconds, ms);
}

describe('EXPIRING_SOON_DAYS', () => {
  it('is the single source of truth for the warning window', () => {
    expect(EXPIRING_SOON_DAYS).toBe(60);
    expect(EXPIRING_SOON_MS).toBe(60 * 24 * 60 * 60 * 1000);
  });
});

describe('getCardExpiryEnd', () => {
  it('ends a card at the start of the month AFTER the printed expiry', () => {
    // 07/2026 is good through 2026-07-31, so the exclusive end is 2026-08-01.
    expect(getCardExpiryEnd('07', '2026')).toEqual(localDate(2026, 8, 1));
  });

  it('rolls a December expiry into January of the next year', () => {
    expect(getCardExpiryEnd('12', '2026')).toEqual(localDate(2027, 1, 1));
  });

  it('handles a January expiry without touching the year', () => {
    expect(getCardExpiryEnd('01', '2026')).toEqual(localDate(2026, 2, 1));
  });

  it('returns null for unusable input', () => {
    expect(getCardExpiryEnd('13', '2026')).toBeNull();
    expect(getCardExpiryEnd('07', '20')).toBeNull();
  });
});

describe('getCardExpiryStatus - end-of-month boundary', () => {
  // The classic off-by-one-month bug lives here: a card marked 07/2026 must
  // stay valid for every instant of July, and flip to expired at the first
  // instant of August.
  const MONTH = '07';
  const YEAR = '2026';

  it('is not expired at the very last millisecond of the expiry month', () => {
    const lastValidInstant = localDate(2026, 7, 31, 23, 59, 59, 999);
    expect(getCardExpiryStatus(MONTH, YEAR, lastValidInstant)).not.toBe('expired');
  });

  it('is expired at the first instant of the following month', () => {
    const firstExpiredInstant = localDate(2026, 8, 1, 0, 0, 0, 0);
    expect(getCardExpiryStatus(MONTH, YEAR, firstExpiredInstant)).toBe('expired');
  });

  it('is expired one millisecond after the boundary', () => {
    const justAfter = localDate(2026, 8, 1, 0, 0, 0, 1);
    expect(getCardExpiryStatus(MONTH, YEAR, justAfter)).toBe('expired');
  });

  it('is still valid on the first day of the expiry month', () => {
    // A whole month of validity remains, which is well outside the 60-day
    // window only for a card expiring far out; here it is expiring soon.
    expect(getCardExpiryStatus(MONTH, YEAR, localDate(2026, 7, 1))).toBe('expiring_soon');
  });

  it('treats a card expiring in a 28-day February as valid through Feb 28', () => {
    expect(getCardExpiryStatus('02', '2027', localDate(2027, 2, 28, 23, 59, 59, 999))).not.toBe(
      'expired',
    );
    expect(getCardExpiryStatus('02', '2027', localDate(2027, 3, 1))).toBe('expired');
  });

  it('treats a leap-year February as valid through Feb 29', () => {
    expect(getCardExpiryStatus('02', '2028', localDate(2028, 2, 29, 23, 59, 59, 999))).not.toBe(
      'expired',
    );
    expect(getCardExpiryStatus('02', '2028', localDate(2028, 3, 1))).toBe('expired');
  });
});

describe('getCardExpiryStatus - year rollover', () => {
  it('keeps a December card valid through Dec 31', () => {
    expect(getCardExpiryStatus('12', '2026', localDate(2026, 12, 31, 23, 59, 59, 999))).not.toBe(
      'expired',
    );
  });

  it('expires a December card on Jan 1 of the next year', () => {
    expect(getCardExpiryStatus('12', '2026', localDate(2027, 1, 1))).toBe('expired');
  });

  it('spans the new year when computing the expiring-soon window', () => {
    // 01/2027 ends 2027-02-01; 60 days earlier is in December 2026.
    expect(getCardExpiryStatus('01', '2027', localDate(2026, 12, 20))).toBe('expiring_soon');
    expect(getCardExpiryStatus('01', '2027', localDate(2026, 11, 1))).toBe('valid');
  });
});

describe('getCardExpiryStatus - the 60-day threshold', () => {
  const MONTH = '07';
  const YEAR = '2026';
  const expiryEnd = getCardExpiryEnd(MONTH, YEAR) as Date;

  it('is expiring_soon exactly at the 60-day threshold (inclusive)', () => {
    const exactlyAtThreshold = new Date(expiryEnd.getTime() - EXPIRING_SOON_MS);
    expect(getCardExpiryStatus(MONTH, YEAR, exactlyAtThreshold)).toBe('expiring_soon');
  });

  it('is still valid one millisecond before the threshold', () => {
    const justOutside = new Date(expiryEnd.getTime() - EXPIRING_SOON_MS - 1);
    expect(getCardExpiryStatus(MONTH, YEAR, justOutside)).toBe('valid');
  });

  it('is expiring_soon one millisecond inside the threshold', () => {
    const justInside = new Date(expiryEnd.getTime() - EXPIRING_SOON_MS + 1);
    expect(getCardExpiryStatus(MONTH, YEAR, justInside)).toBe('expiring_soon');
  });

  it('is expiring_soon one millisecond before expiry', () => {
    const almostExpired = new Date(expiryEnd.getTime() - 1);
    expect(getCardExpiryStatus(MONTH, YEAR, almostExpired)).toBe('expiring_soon');
  });

  it('is valid far outside the window', () => {
    expect(getCardExpiryStatus(MONTH, YEAR, localDate(2025, 1, 1))).toBe('valid');
  });
});

describe('getCardExpiryStatus - unknown input', () => {
  const NOW = localDate(2026, 7, 27);

  it.each([
    ['month out of range (13)', '13', '2026'],
    ['month out of range (0)', '0', '2026'],
    ['month non-numeric', 'July', '2026'],
    ['two-digit year', '07', '20'],
    ['two-digit year (29)', '07', '29'],
    ['three-digit year', '07', '202'],
    ['year out of range', '07', '1999'],
    ['empty month', '', '2026'],
    ['empty year', '07', ''],
    ['both empty', '', ''],
    ['undefined month', undefined, '2026'],
    ['undefined year', '07', undefined],
    ['null month', null, '2026'],
    ['null year', '07', null],
    ['object month', {}, '2026'],
    ['array year', '07', []],
    ['boolean month', true, '2026'],
    ['whitespace month', '   ', '2026'],
    ['month with trailing junk', '7abc', '2026'],
    ['year with separators', '07', '20-26'],
  ])('returns unknown for %s', (_label, month, year) => {
    expect(getCardExpiryStatus(month, year, NOW)).toBe('unknown');
  });

  it('accepts a numeric month and year, not just strings', () => {
    // Stored values arrive as Record<string, unknown>; a number is legitimate.
    expect(getCardExpiryStatus(7, 2026, localDate(2026, 7, 15))).toBe('expiring_soon');
    expect(getCardExpiryStatus(7, 2026, localDate(2026, 8, 1))).toBe('expired');
  });

  it('accepts an unpadded month string', () => {
    expect(getCardExpiryStatus('7', '2026', localDate(2026, 8, 1))).toBe('expired');
  });

  it('tolerates surrounding whitespace', () => {
    expect(getCardExpiryStatus(' 07 ', ' 2026 ', localDate(2026, 8, 1))).toBe('expired');
  });

  it('returns unknown when now is an Invalid Date', () => {
    expect(getCardExpiryStatus('07', '2026', new Date('nonsense'))).toBe('unknown');
  });
});

describe('getCardExpirySortKey', () => {
  it('orders soonest expiry first', () => {
    const keys = [
      getCardExpirySortKey('12', '2027'),
      getCardExpirySortKey('01', '2026'),
      getCardExpirySortKey('06', '2026'),
    ];
    const sorted = [...keys].sort((a, b) => a - b);
    expect(sorted).toEqual([
      getCardExpirySortKey('01', '2026'),
      getCardExpirySortKey('06', '2026'),
      getCardExpirySortKey('12', '2027'),
    ]);
  });

  it('sorts unknown expiries last', () => {
    expect(getCardExpirySortKey('13', '2026')).toBe(Number.POSITIVE_INFINITY);
    expect(getCardExpirySortKey(undefined, undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(getCardExpirySortKey('12', '2099')).toBeLessThan(getCardExpirySortKey('', ''));
  });
});

describe('isNeedsAttention', () => {
  it('flags expired and expiring_soon only', () => {
    expect(isNeedsAttention('expired')).toBe(true);
    expect(isNeedsAttention('expiring_soon')).toBe(true);
    expect(isNeedsAttention('valid')).toBe(false);
    expect(isNeedsAttention('unknown')).toBe(false);
  });
});
