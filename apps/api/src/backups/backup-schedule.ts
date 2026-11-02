/**
 * Schedule math for the admin-scheduled system backup.
 *
 * Pure and dependency-free: time zones are handled with `Intl.DateTimeFormat`
 * only. Every slot is defined as a WALL-CLOCK time in the schedule's time
 * zone and converted to UTC per occurrence, so a daily 03:00 stays 03:00
 * local across a DST change.
 *
 * DST rules:
 * - A wall-clock time that does not exist (spring-forward gap) runs at the
 *   first instant after the gap (02:30 becomes 03:30 local).
 * - A wall-clock time that happens twice (fall-back overlap) runs at the
 *   first occurrence.
 */

export const BACKUP_FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/** Allowed `intervalHours` for `hourly`: each divides 24, so slots repeat every day. */
export const BACKUP_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;

export interface BackupScheduleTiming {
  frequency: BackupFrequency | string;
  /** hourly only. */
  intervalHours?: number | null;
  /** `HH:mm`, used by daily, weekly and monthly. */
  timeOfDay: string;
  /** weekly only, 0 = Sunday. */
  dayOfWeek?: number | null;
  /** monthly only, 1-28. */
  dayOfMonth?: number | null;
  /** IANA time zone. */
  timezone: string;
}

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True when `value` is a valid `HH:mm` (00:00 to 23:59). */
export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_RE.test(value);
}

/** True when `Intl` accepts `timeZone` as an IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  /** 0-based, like Date. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading of instant `ms` in `timeZone`. */
function wallClockAt(ms: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month') - 1,
    day: get('day'),
    // Some engines print midnight as 24 even with h23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` at instant `ms`, in ms (local minus UTC). */
function offsetAt(ms: number, timeZone: string): number {
  const wall = wallClockAt(ms, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second);
  const floored = Math.floor(ms / 1000) * 1000;
  return asUtc - floored;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads the given time.
 * Out-of-range fields roll over like `Date.UTC` (day 32 is next month).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month, day, hour, minute, 0);
  const offsetGuess = offsetAt(guess, timeZone);
  const first = guess - offsetGuess;
  const offsetFirst = offsetAt(first, timeZone);
  if (offsetFirst === offsetGuess) {
    return new Date(first);
  }
  const second = guess - offsetFirst;
  if (offsetAt(second, timeZone) === offsetFirst) {
    return new Date(second);
  }
  // Neither reading is self-consistent: the time falls in a DST gap. Run at
  // the later instant, i.e. just after the clocks jumped.
  return new Date(Math.max(first, second));
}

function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = TIME_OF_DAY_RE.exec(value);
  if (!match) {
    throw new RangeError('timeOfDay must be HH:mm');
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * The first scheduled slot strictly after `from`.
 *
 * - `hourly`: every `intervalHours` hours on the hour, counted from local
 *   midnight (every 6 hours = 00:00, 06:00, 12:00, 18:00 local).
 *   `timeOfDay` is not used.
 * - `daily`: every day at `timeOfDay`.
 * - `weekly`: every `dayOfWeek` (0 = Sunday) at `timeOfDay`.
 * - `monthly`: every month on `dayOfMonth` (1-28, so it always exists) at `timeOfDay`.
 *
 * @throws RangeError when the schedule is incomplete or invalid.
 */
export function computeNextRunAt(schedule: BackupScheduleTiming, from: Date): Date {
  const timeZone = schedule.timezone;
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError('timezone must be a valid IANA time zone');
  }
  const fromMs = from.getTime();
  if (!Number.isFinite(fromMs)) {
    throw new RangeError('from must be a valid date');
  }
  const local = wallClockAt(fromMs, timeZone);

  const firstAfter = (candidates: Iterable<Date>): Date => {
    for (const candidate of candidates) {
      if (candidate.getTime() > fromMs) {
        return candidate;
      }
    }
    // Unreachable for valid schedules: every generator below covers more
    // than one full period after `from`.
    throw new RangeError('No upcoming slot found for the schedule');
  };

  switch (schedule.frequency) {
    case 'hourly': {
      const interval = schedule.intervalHours;
      if (!interval || !(BACKUP_INTERVAL_HOURS as readonly number[]).includes(interval)) {
        throw new RangeError(`intervalHours must be one of ${BACKUP_INTERVAL_HOURS.join(', ')}`);
      }
      // Start one day back so a slot just after an offset change is not missed.
      return firstAfter(
        (function* () {
          for (let d = -1; d <= 2; d++) {
            for (let h = 0; h < 24; h += interval) {
              yield zonedTimeToUtc(local.year, local.month, local.day + d, h, 0, timeZone);
            }
          }
        })(),
      );
    }

    case 'daily': {
      const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
      return firstAfter(
        (function* () {
          for (let d = -1; d <= 2; d++) {
            yield zonedTimeToUtc(local.year, local.month, local.day + d, hour, minute, timeZone);
          }
        })(),
      );
    }

    case 'weekly': {
      const dayOfWeek = schedule.dayOfWeek;
      if (dayOfWeek === null || dayOfWeek === undefined || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new RangeError('dayOfWeek must be an integer from 0 (Sunday) to 6');
      }
      const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
      return firstAfter(
        (function* () {
          for (let d = -1; d <= 8; d++) {
            const weekday = new Date(Date.UTC(local.year, local.month, local.day + d)).getUTCDay();
            if (weekday === dayOfWeek) {
              yield zonedTimeToUtc(local.year, local.month, local.day + d, hour, minute, timeZone);
            }
          }
        })(),
      );
    }

    case 'monthly': {
      const dayOfMonth = schedule.dayOfMonth;
      if (dayOfMonth === null || dayOfMonth === undefined || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
        throw new RangeError('dayOfMonth must be an integer from 1 to 28');
      }
      const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
      return firstAfter(
        (function* () {
          for (let m = -1; m <= 2; m++) {
            yield zonedTimeToUtc(local.year, local.month + m, dayOfMonth, hour, minute, timeZone);
          }
        })(),
      );
    }

    default:
      throw new RangeError(`frequency must be one of ${BACKUP_FREQUENCIES.join(', ')}`);
  }
}
