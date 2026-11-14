import { describe, expect, it } from 'vitest';

import { describeCron, nextRun, nextRuns, parseCron, parseWeekday, validateCron } from '../lib/cron.js';

// All dates are local time, like cron.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe('parseCron', () => {
  it('parses the five fields', () => {
    const s = parseCron('30 2 * * *');
    expect(s.minutes).toEqual([30]);
    expect(s.hours).toEqual([2]);
    expect(s.daysOfMonth).toHaveLength(31);
    expect(s.months).toHaveLength(12);
    expect(s.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.domRestricted).toBe(false);
    expect(s.dowRestricted).toBe(false);
  });

  it('understands steps, ranges, lists and names', () => {
    expect(parseCron('*/15 * * * *').minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron('0 0-12/4 * * *').hours).toEqual([0, 4, 8, 12]);
    expect(parseCron('0 9 1,15 * *').daysOfMonth).toEqual([1, 15]);
    expect(parseCron('0 9 * jan,jul *').months).toEqual([1, 7]);
    expect(parseCron('0 9 * * mon-fri').daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('treats weekday 7 as Sunday', () => {
    expect(parseCron('0 9 * * 7').daysOfWeek).toEqual([0]);
  });

  it('expands the @ shorthands', () => {
    expect(parseCron('@daily').expression).toBe('0 0 * * *');
    expect(parseCron('@hourly').expression).toBe('0 * * * *');
    expect(parseCron('@weekly').expression).toBe('0 0 * * 0');
  });

  it('normalises whitespace', () => {
    expect(parseCron('  30   2 * *  * ').expression).toBe('30 2 * * *');
  });

  it.each([
    ['30 2 * *', /5 fields/],
    ['30 2 * * * *', /5 fields/],
    ['60 2 * * *', /minute must be 0-59/],
    ['0 24 * * *', /hour must be 0-23/],
    ['0 0 0 * *', /day of month must be 1-31/],
    ['0 0 * 13 *', /month must be 1-12/],
    ['0 0 * * 8', /day of week must be 0-7/],
    ['0 0 * * funday', /Invalid day of week/],
    ['*/0 * * * *', /Invalid step/],
    ['5-1 * * * *', /backwards/],
    ['1,,2 * * * *', /Empty item/],
    ['@reboot', /Unsupported shorthand/],
  ])('rejects %s', (expr, message) => {
    expect(() => parseCron(expr)).toThrow(message);
    const v = validateCron(expr);
    expect(v.ok).toBe(false);
  });
});

describe('nextRuns', () => {
  it('finds the next daily run later today or tomorrow', () => {
    expect(nextRun('30 2 * * *', at(2026, 3, 10, 1, 0))).toEqual(at(2026, 3, 10, 2, 30));
    expect(nextRun('30 2 * * *', at(2026, 3, 10, 2, 30))).toEqual(at(2026, 3, 11, 2, 30));
    expect(nextRun('30 2 * * *', at(2026, 3, 10, 3, 0))).toEqual(at(2026, 3, 11, 2, 30));
  });

  it('lists several runs of an every-6-hours schedule', () => {
    expect(nextRuns('0 */6 * * *', at(2026, 3, 10, 5, 59), 3)).toEqual([
      at(2026, 3, 10, 6, 0),
      at(2026, 3, 10, 12, 0),
      at(2026, 3, 10, 18, 0),
    ]);
  });

  it('finds the next weekly run (2026-03-10 is a Tuesday)', () => {
    expect(at(2026, 3, 10).getDay()).toBe(2);
    expect(nextRun('0 3 * * 0', at(2026, 3, 10, 12))).toEqual(at(2026, 3, 15, 3, 0));
    expect(nextRun('0 3 * * 2', at(2026, 3, 10, 2))).toEqual(at(2026, 3, 10, 3, 0));
  });

  it('matches day of month OR day of week when both are restricted', () => {
    // The 13th, or any Monday; from Tuesday 2026-03-10 the first is Friday the 13th.
    expect(nextRuns('0 0 13 * 1', at(2026, 3, 10, 1), 2)).toEqual([at(2026, 3, 13), at(2026, 3, 16)]);
  });

  it('crosses month and year boundaries', () => {
    expect(nextRun('0 0 1 * *', at(2026, 12, 15))).toEqual(at(2027, 1, 1));
    expect(nextRun('0 12 29 2 *', at(2026, 3, 1))).toEqual(at(2028, 2, 29, 12));
  });

  it('returns nothing for a date that never comes', () => {
    expect(nextRuns('0 0 30 2 *', at(2026, 1, 1), 1)).toEqual([]);
  });
});

describe('describeCron', () => {
  it.each([
    ['30 2 * * *', 'Every day at 02:30'],
    ['0 3 * * 1', 'Every Monday at 03:00'],
    ['0 * * * *', 'Every hour'],
    ['15 * * * *', 'Every hour at :15'],
    ['0 */6 * * *', 'Every 6 hours'],
    ['5 */2 * * *', 'Every 2 hours at :05'],
    ['15 1 * * 1-5', 'cron: 15 1 * * 1-5'],
    ['nonsense', 'cron: nonsense'],
  ])('%s → %s', (expr, text) => {
    expect(describeCron(expr)).toBe(text);
  });
});

describe('parseWeekday', () => {
  it('accepts short and long names and numbers', () => {
    expect(parseWeekday('sun')).toBe(0);
    expect(parseWeekday('Monday')).toBe(1);
    expect(parseWeekday('SAT')).toBe(6);
    expect(parseWeekday('3')).toBe(3);
    expect(parseWeekday('7')).toBe(0);
  });

  it('rejects anything else', () => {
    expect(() => parseWeekday('someday')).toThrow(/Unknown day/);
    expect(() => parseWeekday('9')).toThrow(/Unknown day/);
  });
});
