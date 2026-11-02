import {
  computeNextRunAt,
  isValidTimeOfDay,
  isValidTimeZone,
  zonedTimeToUtc,
} from './backup-schedule';

const at = (iso: string) => new Date(iso);
const daily = (timeOfDay: string, timezone = 'UTC') => ({ frequency: 'daily', timeOfDay, timezone });

describe('computeNextRunAt', () => {
  describe('daily', () => {
    it('returns today when the time is still ahead', () => {
      expect(computeNextRunAt(daily('03:00'), at('2026-05-10T01:00:00Z')).toISOString()).toBe(
        '2026-05-10T03:00:00.000Z',
      );
    });

    it('returns tomorrow when the time has passed', () => {
      expect(computeNextRunAt(daily('03:00'), at('2026-05-10T04:00:00Z')).toISOString()).toBe(
        '2026-05-11T03:00:00.000Z',
      );
    });

    it('is strictly after from (exactly on the slot goes to the next one)', () => {
      expect(computeNextRunAt(daily('03:00'), at('2026-05-10T03:00:00Z')).toISOString()).toBe(
        '2026-05-11T03:00:00.000Z',
      );
    });

    it('uses the wall clock of the time zone', () => {
      // America/Chicago is UTC-5 in May (CDT).
      expect(
        computeNextRunAt(daily('03:00', 'America/Chicago'), at('2026-05-10T07:00:00Z')).toISOString(),
      ).toBe('2026-05-10T08:00:00.000Z');
    });

    it('handles the local date differing from the UTC date', () => {
      // 2026-05-10T23:30Z is 2026-05-11 08:30 in Tokyo (UTC+9).
      expect(
        computeNextRunAt(daily('09:00', 'Asia/Tokyo'), at('2026-05-10T23:30:00Z')).toISOString(),
      ).toBe('2026-05-11T00:00:00.000Z');
    });

    it('keeps 03:00 local across the spring-forward change', () => {
      const s = daily('03:00', 'America/Chicago');
      // Before DST (CST, UTC-6) on 2026-03-07, after (CDT, UTC-5) on 2026-03-09.
      expect(computeNextRunAt(s, at('2026-03-07T10:00:00Z')).toISOString()).toBe('2026-03-08T08:00:00.000Z');
      expect(computeNextRunAt(s, at('2026-03-06T10:00:00Z')).toISOString()).toBe('2026-03-07T09:00:00.000Z');
      expect(computeNextRunAt(s, at('2026-03-08T09:00:00Z')).toISOString()).toBe('2026-03-09T08:00:00.000Z');
    });

    it('runs a time inside the spring-forward gap just after the jump', () => {
      // 02:30 does not exist in Chicago on 2026-03-08; clocks go 02:00 -> 03:00 CDT.
      expect(
        computeNextRunAt(daily('02:30', 'America/Chicago'), at('2026-03-08T00:00:00Z')).toISOString(),
      ).toBe('2026-03-08T08:30:00.000Z'); // 03:30 CDT
    });

    it('runs an ambiguous fall-back time once, at the first occurrence', () => {
      // 01:30 happens twice in Chicago on 2026-11-01 (CDT then CST).
      const s = daily('01:30', 'America/Chicago');
      const first = computeNextRunAt(s, at('2026-11-01T00:00:00Z'));
      expect(first.toISOString()).toBe('2026-11-01T06:30:00.000Z'); // 01:30 CDT
      // From the first occurrence, the next run is the following day, not an hour later.
      expect(computeNextRunAt(s, first).toISOString()).toBe('2026-11-02T07:30:00.000Z'); // 01:30 CST
    });
  });

  describe('hourly', () => {
    const hourly = (intervalHours: number, timezone = 'UTC') => ({
      frequency: 'hourly',
      intervalHours,
      timeOfDay: '03:00',
      timezone,
    });

    it('runs on the hour, every N hours from local midnight', () => {
      expect(computeNextRunAt(hourly(6), at('2026-05-10T07:15:00Z')).toISOString()).toBe(
        '2026-05-10T12:00:00.000Z',
      );
      expect(computeNextRunAt(hourly(1), at('2026-05-10T07:15:00Z')).toISOString()).toBe(
        '2026-05-10T08:00:00.000Z',
      );
    });

    it('wraps to the next local day', () => {
      expect(computeNextRunAt(hourly(12), at('2026-05-10T13:00:00Z')).toISOString()).toBe(
        '2026-05-11T00:00:00.000Z',
      );
    });

    it('counts from local midnight in the time zone', () => {
      // Kolkata is UTC+5:30: local 00:00/08:00/16:00 = 18:30Z/02:30Z/10:30Z.
      expect(
        computeNextRunAt(hourly(8, 'Asia/Kolkata'), at('2026-05-10T03:00:00Z')).toISOString(),
      ).toBe('2026-05-10T10:30:00.000Z');
    });

    it('rejects an interval that does not divide the day', () => {
      expect(() => computeNextRunAt(hourly(5), at('2026-05-10T00:00:00Z'))).toThrow(RangeError);
      expect(() =>
        computeNextRunAt({ frequency: 'hourly', intervalHours: null, timeOfDay: '00:00', timezone: 'UTC' }, new Date()),
      ).toThrow(RangeError);
    });
  });

  describe('weekly', () => {
    const weekly = (dayOfWeek: number, timeOfDay = '03:00', timezone = 'UTC') => ({
      frequency: 'weekly',
      dayOfWeek,
      timeOfDay,
      timezone,
    });

    it('returns the next matching weekday (0 = Sunday)', () => {
      // 2026-05-10 is a Sunday.
      expect(computeNextRunAt(weekly(3), at('2026-05-10T12:00:00Z')).toISOString()).toBe(
        '2026-05-13T03:00:00.000Z',
      );
    });

    it('returns the same day when the time is still ahead, else a week later', () => {
      expect(computeNextRunAt(weekly(0), at('2026-05-10T01:00:00Z')).toISOString()).toBe(
        '2026-05-10T03:00:00.000Z',
      );
      expect(computeNextRunAt(weekly(0), at('2026-05-10T03:00:00Z')).toISOString()).toBe(
        '2026-05-17T03:00:00.000Z',
      );
    });

    it('uses the local weekday, not the UTC one', () => {
      // 2026-05-10T02:00Z is still Saturday 2026-05-09 21:00 in Chicago.
      expect(
        computeNextRunAt(weekly(6, '22:00', 'America/Chicago'), at('2026-05-10T02:00:00Z')).toISOString(),
      ).toBe('2026-05-10T03:00:00.000Z');
    });
  });

  describe('monthly', () => {
    const monthly = (dayOfMonth: number, timeOfDay = '03:00', timezone = 'UTC') => ({
      frequency: 'monthly',
      dayOfMonth,
      timeOfDay,
      timezone,
    });

    it('returns this month when the day is ahead, else next month', () => {
      expect(computeNextRunAt(monthly(15), at('2026-05-10T00:00:00Z')).toISOString()).toBe(
        '2026-05-15T03:00:00.000Z',
      );
      expect(computeNextRunAt(monthly(5), at('2026-05-10T00:00:00Z')).toISOString()).toBe(
        '2026-06-05T03:00:00.000Z',
      );
    });

    it('rolls over the year and handles February with day 28', () => {
      expect(computeNextRunAt(monthly(28), at('2026-12-28T04:00:00Z')).toISOString()).toBe(
        '2027-01-28T03:00:00.000Z',
      );
      expect(computeNextRunAt(monthly(28), at('2027-02-01T00:00:00Z')).toISOString()).toBe(
        '2027-02-28T03:00:00.000Z',
      );
    });

    it('rejects a day of month outside 1-28', () => {
      expect(() => computeNextRunAt(monthly(29), new Date())).toThrow(RangeError);
      expect(() => computeNextRunAt(monthly(0), new Date())).toThrow(RangeError);
    });
  });

  it('rejects an unknown frequency, a bad time of day and a bad time zone', () => {
    expect(() => computeNextRunAt({ frequency: 'yearly', timeOfDay: '03:00', timezone: 'UTC' }, new Date())).toThrow(RangeError);
    expect(() => computeNextRunAt(daily('3:00'), new Date())).toThrow(RangeError);
    expect(() => computeNextRunAt(daily('03:00', 'Mars/Olympus'), new Date())).toThrow(RangeError);
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a normal wall-clock time', () => {
    expect(zonedTimeToUtc(2026, 0, 15, 12, 0, 'Europe/Berlin').toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(zonedTimeToUtc(2026, 6, 15, 12, 0, 'Europe/Berlin').toISOString()).toBe('2026-07-15T10:00:00.000Z');
  });
});

describe('validators', () => {
  it('isValidTimeOfDay', () => {
    expect(isValidTimeOfDay('00:00')).toBe(true);
    expect(isValidTimeOfDay('23:59')).toBe(true);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeOfDay('3:00')).toBe(false);
    expect(isValidTimeOfDay('03:60')).toBe(false);
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
