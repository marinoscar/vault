import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BACKUP_DAY_OF_MONTH_MAX,
  BACKUP_FREQUENCY_LABELS,
  BACKUP_INTERVAL_HOURS,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  WEEKDAY_NAMES,
  describeBackupSchedule,
  formatBytes,
  formatDateTime,
  getBrowserTimeZone,
  getTimeZoneOptions,
  isValidTimeOfDay,
  normalizeScheduleFields,
  scheduleContentSelection,
  startUrlDownload,
  validateScheduleFields,
  withScheduleContents,
} from '../../src/backups/headless/backupSchedule.js';
import { BACKUP_NOTHING_SELECTED_MESSAGE } from '../../src/backups/headless/backupContents.js';
import type { BackupScheduleFields } from '../../src/core/headless/types.js';

const base: BackupScheduleFields = {
  enabled: true,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'America/Chicago',
  keepCount: 7,
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  includeSystem: false,
};

function fields(overrides: Partial<BackupScheduleFields>): BackupScheduleFields {
  return { ...base, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('constants', () => {
  it('lists the allowed hour intervals', () => {
    expect(BACKUP_INTERVAL_HOURS).toEqual([1, 2, 3, 4, 6, 8, 12]);
  });

  it('has a label for every frequency', () => {
    expect(Object.keys(BACKUP_FREQUENCY_LABELS).sort()).toEqual([
      'daily',
      'hourly',
      'monthly',
      'weekly',
    ]);
  });

  it('indexes weekdays from Sunday', () => {
    expect(WEEKDAY_NAMES).toHaveLength(7);
    expect(WEEKDAY_NAMES[0]).toBe('Sunday');
    expect(WEEKDAY_NAMES[6]).toBe('Saturday');
  });
});

describe('isValidTimeOfDay', () => {
  it.each(['00:00', '03:00', '09:59', '12:30', '19:05', '23:59'])('accepts %s', (v) => {
    expect(isValidTimeOfDay(v)).toBe(true);
  });

  it.each(['', '3:00', '24:00', '23:60', '12:5', '12:345', '12-30', 'ab:cd', '12:30:00', ' 12:30'])(
    'rejects %j',
    (v) => {
      expect(isValidTimeOfDay(v)).toBe(false);
    },
  );
});

describe('getBrowserTimeZone', () => {
  it('returns the resolved IANA zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: 'Europe/Paris' }) }) as Intl.DateTimeFormat,
    );
    expect(getBrowserTimeZone()).toBe('Europe/Paris');
  });

  it('falls back to UTC when the zone is empty', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: '' }) }) as Intl.DateTimeFormat,
    );
    expect(getBrowserTimeZone()).toBe('UTC');
  });

  it('falls back to UTC when Intl throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no intl');
    });
    expect(getBrowserTimeZone()).toBe('UTC');
  });
});

describe('getTimeZoneOptions', () => {
  const original = Object.getOwnPropertyDescriptor(Intl, 'supportedValuesOf');

  function setSupported(value: unknown) {
    Object.defineProperty(Intl, 'supportedValuesOf', {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    if (original) Object.defineProperty(Intl, 'supportedValuesOf', original);
    else delete (Intl as unknown as Record<string, unknown>).supportedValuesOf;
  });

  it('returns a sorted list that always includes UTC', () => {
    setSupported(() => ['Europe/Paris', 'America/Chicago']);
    expect(getTimeZoneOptions()).toEqual(['America/Chicago', 'Europe/Paris', 'UTC']);
  });

  it('includes the current value even when the runtime does not know it', () => {
    setSupported(() => ['Europe/Paris']);
    expect(getTimeZoneOptions('Mars/Olympus')).toContain('Mars/Olympus');
  });

  it('does not duplicate entries', () => {
    setSupported(() => ['UTC', 'Europe/Paris']);
    const result = getTimeZoneOptions('Europe/Paris');
    expect(result.filter((z) => z === 'UTC')).toHaveLength(1);
    expect(result.filter((z) => z === 'Europe/Paris')).toHaveLength(1);
  });

  it('still returns UTC and current when supportedValuesOf is missing', () => {
    setSupported(undefined);
    expect(getTimeZoneOptions('Asia/Tokyo')).toEqual(['Asia/Tokyo', 'UTC']);
  });

  it('still returns UTC when supportedValuesOf throws', () => {
    setSupported(() => {
      throw new RangeError('bad key');
    });
    expect(getTimeZoneOptions()).toEqual(['UTC']);
  });
});

describe('describeBackupSchedule', () => {
  it('describes daily schedules', () => {
    expect(describeBackupSchedule(base)).toBe('Every day at 03:00 (America/Chicago) · keeps 7');
  });

  it('describes weekly schedules with the weekday name', () => {
    expect(describeBackupSchedule(fields({ frequency: 'weekly', dayOfWeek: 3, timeOfDay: '22:15' }))).toBe(
      'Every Wednesday at 22:15 (America/Chicago) · keeps 7',
    );
  });

  it('defaults a missing weekday to Sunday', () => {
    expect(describeBackupSchedule(fields({ frequency: 'weekly', dayOfWeek: null }))).toContain(
      'Every Sunday',
    );
  });

  it('describes monthly schedules', () => {
    expect(describeBackupSchedule(fields({ frequency: 'monthly', dayOfMonth: 15 }))).toBe(
      'Monthly on day 15 at 03:00 (America/Chicago) · keeps 7',
    );
  });

  it('defaults a missing day of month to 1', () => {
    expect(describeBackupSchedule(fields({ frequency: 'monthly', dayOfMonth: null }))).toContain(
      'Monthly on day 1 ',
    );
  });

  it('describes hourly schedules without a time of day', () => {
    expect(describeBackupSchedule(fields({ frequency: 'hourly', intervalHours: 6 }))).toBe(
      'Every 6 hours · keeps 7',
    );
  });

  it('uses the singular for every 1 hour and defaults a missing interval', () => {
    expect(describeBackupSchedule(fields({ frequency: 'hourly', intervalHours: 1 }))).toBe(
      'Every hour · keeps 7',
    );
    expect(describeBackupSchedule(fields({ frequency: 'hourly', intervalHours: null }))).toBe(
      'Every hour · keeps 7',
    );
  });

  it('reflects keepCount', () => {
    expect(describeBackupSchedule(fields({ keepCount: 30 }))).toMatch(/keeps 30$/);
  });
});

describe('normalizeScheduleFields', () => {
  it('nulls the fields a daily schedule does not use', () => {
    const result = normalizeScheduleFields(
      fields({ frequency: 'daily', intervalHours: 6, dayOfWeek: 2, dayOfMonth: 9 }),
    );
    expect(result.intervalHours).toBeNull();
    expect(result.dayOfWeek).toBeNull();
    expect(result.dayOfMonth).toBeNull();
  });

  it('keeps only intervalHours for hourly', () => {
    const result = normalizeScheduleFields(
      fields({ frequency: 'hourly', intervalHours: 4, dayOfWeek: 2, dayOfMonth: 9 }),
    );
    expect(result.intervalHours).toBe(4);
    expect(result.dayOfWeek).toBeNull();
    expect(result.dayOfMonth).toBeNull();
  });

  it('keeps only dayOfWeek for weekly', () => {
    const result = normalizeScheduleFields(
      fields({ frequency: 'weekly', intervalHours: 4, dayOfWeek: 5, dayOfMonth: 9 }),
    );
    expect(result.intervalHours).toBeNull();
    expect(result.dayOfWeek).toBe(5);
    expect(result.dayOfMonth).toBeNull();
  });

  it('keeps only dayOfMonth for monthly', () => {
    const result = normalizeScheduleFields(
      fields({ frequency: 'monthly', intervalHours: 4, dayOfWeek: 5, dayOfMonth: 9 }),
    );
    expect(result.intervalHours).toBeNull();
    expect(result.dayOfWeek).toBeNull();
    expect(result.dayOfMonth).toBe(9);
  });

  it('defaults the field the frequency uses when it is missing', () => {
    expect(normalizeScheduleFields(fields({ frequency: 'hourly' })).intervalHours).toBe(1);
    expect(normalizeScheduleFields(fields({ frequency: 'weekly' })).dayOfWeek).toBe(1);
    expect(normalizeScheduleFields(fields({ frequency: 'monthly' })).dayOfMonth).toBe(1);
  });

  it('keeps Sunday (0) rather than defaulting it', () => {
    expect(normalizeScheduleFields(fields({ frequency: 'weekly', dayOfWeek: 0 })).dayOfWeek).toBe(0);
  });

  it('passes the other fields through and does not mutate the input', () => {
    const input = fields({ frequency: 'daily', dayOfWeek: 2 });
    const result = normalizeScheduleFields(input);
    expect(result.timezone).toBe('America/Chicago');
    expect(result.keepCount).toBe(7);
    expect(result.timeOfDay).toBe('03:00');
    expect(input.dayOfWeek).toBe(2);
  });
});

describe('validateScheduleFields', () => {
  it('accepts a valid daily schedule', () => {
    expect(validateScheduleFields(base)).toBeNull();
  });

  it('accepts a valid schedule for every frequency', () => {
    expect(validateScheduleFields(fields({ frequency: 'hourly', intervalHours: 12 }))).toBeNull();
    expect(validateScheduleFields(fields({ frequency: 'weekly', dayOfWeek: 0 }))).toBeNull();
    expect(validateScheduleFields(fields({ frequency: 'monthly', dayOfMonth: 28 }))).toBeNull();
  });

  it('rejects an hourly interval that is not allowed', () => {
    const msg = 'Choose how many hours between backups';
    expect(validateScheduleFields(fields({ frequency: 'hourly', intervalHours: null }))).toBe(msg);
    expect(validateScheduleFields(fields({ frequency: 'hourly', intervalHours: 5 }))).toBe(msg);
    expect(validateScheduleFields(fields({ frequency: 'hourly', intervalHours: 24 }))).toBe(msg);
  });

  it('does not check the time of day for hourly schedules', () => {
    expect(
      validateScheduleFields(fields({ frequency: 'hourly', intervalHours: 2, timeOfDay: 'junk' })),
    ).toBeNull();
  });

  it.each(['daily', 'weekly', 'monthly'] as const)('rejects a bad time for %s', (frequency) => {
    expect(
      validateScheduleFields(
        fields({ frequency, dayOfWeek: 1, dayOfMonth: 1, timeOfDay: '25:00' }),
      ),
    ).toBe('Enter a time as HH:mm');
  });

  it('rejects a missing or out-of-range weekday', () => {
    const msg = 'Choose a day of the week';
    expect(validateScheduleFields(fields({ frequency: 'weekly', dayOfWeek: null }))).toBe(msg);
    expect(validateScheduleFields(fields({ frequency: 'weekly', dayOfWeek: -1 }))).toBe(msg);
    expect(validateScheduleFields(fields({ frequency: 'weekly', dayOfWeek: 7 }))).toBe(msg);
  });

  it('rejects a missing or out-of-range day of month', () => {
    const msg = `Choose a day of the month between 1 and ${BACKUP_DAY_OF_MONTH_MAX}`;
    expect(validateScheduleFields(fields({ frequency: 'monthly', dayOfMonth: null }))).toBe(msg);
    expect(validateScheduleFields(fields({ frequency: 'monthly', dayOfMonth: 0 }))).toBe(msg);
    expect(validateScheduleFields(fields({ frequency: 'monthly', dayOfMonth: 29 }))).toBe(msg);
  });

  it('rejects an empty time zone', () => {
    expect(validateScheduleFields(fields({ timezone: '' }))).toBe('Choose a time zone');
  });

  it('rejects keepCount outside the range or not an integer', () => {
    const msg = `Keep between ${BACKUP_KEEP_MIN} and ${BACKUP_KEEP_MAX} backups`;
    expect(validateScheduleFields(fields({ keepCount: 0 }))).toBe(msg);
    expect(validateScheduleFields(fields({ keepCount: BACKUP_KEEP_MAX + 1 }))).toBe(msg);
    expect(validateScheduleFields(fields({ keepCount: 2.5 }))).toBe(msg);
    expect(validateScheduleFields(fields({ keepCount: Number.NaN }))).toBe(msg);
  });

  it('accepts the keepCount bounds', () => {
    expect(validateScheduleFields(fields({ keepCount: BACKUP_KEEP_MIN }))).toBeNull();
    expect(validateScheduleFields(fields({ keepCount: BACKUP_KEEP_MAX }))).toBeNull();
  });
});

describe('schedule contents', () => {
  it('reads the selection from the include flags', () => {
    expect(scheduleContentSelection(fields({ includeMedia: true, includeSystem: true }))).toEqual({
      secrets: true,
      attachments: true,
      versions: false,
      media: true,
      system: true,
    });
  });

  it('writes a selection back as raw flags without touching other fields', () => {
    const next = withScheduleContents(base, {
      secrets: false,
      attachments: true,
      versions: true,
      media: false,
      system: true,
    });
    expect(next).toMatchObject({
      includeSecrets: false,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: false,
      includeSystem: true,
      keepCount: 7,
      timezone: 'America/Chicago',
    });
    expect(base.includeSystem).toBe(false);
  });

  it('normalize sends attachments and versions as false while Secrets is off', () => {
    const result = normalizeScheduleFields(
      fields({ includeSecrets: false, includeVersions: true, includeSystem: true }),
    );
    expect(result).toMatchObject({
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: false,
      includeSystem: true,
    });
  });

  it('normalize keeps the nested options while Secrets is on', () => {
    expect(normalizeScheduleFields(fields({ includeVersions: true }))).toMatchObject({
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: true,
    });
  });

  it('validation rejects a schedule that backs up nothing', () => {
    expect(
      validateScheduleFields(
        fields({ includeSecrets: false, includeMedia: false, includeSystem: false }),
      ),
    ).toBe(BACKUP_NOTHING_SELECTED_MESSAGE);
  });

  it('validation accepts system configuration alone', () => {
    expect(validateScheduleFields(fields({ includeSecrets: false, includeSystem: true }))).toBeNull();
  });
});

describe('formatBytes', () => {
  it.each([
    [null, '—'],
    [-1, '—'],
    [Number.NaN, '—'],
    [Number.POSITIVE_INFINITY, '—'],
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [2048, '2.0 KB'],
    [10 * 1024, '10 KB'],
    [1024 * 1024, '1.0 MB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
    [250 * 1024 * 1024, '250 MB'],
    [1024 ** 3, '1.0 GB'],
    [1024 ** 4, '1.0 TB'],
    [5000 * 1024 ** 4, '5000 TB'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatBytes(input as number | null)).toBe(expected);
  });
});

describe('formatDateTime', () => {
  it.each([null, undefined, '', 'not a date'])('returns null for %j', (v) => {
    expect(formatDateTime(v as string | null | undefined)).toBeNull();
  });

  it('formats a valid ISO string with the locale format', () => {
    const iso = '2026-11-01T09:00:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});

describe('startUrlDownload', () => {
  it('clicks a hidden anchor with the url and file name, then removes it', () => {
    let captured: HTMLAnchorElement | null = null;
    let attachedAtClick = false;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        captured = this;
        attachedAtClick = document.body.contains(this);
      });

    startUrlDownload('https://files.example.test/signed?sig=abc', 'backup-2026-11-01.zip');

    expect(click).toHaveBeenCalledTimes(1);
    expect(captured).not.toBeNull();
    const link = captured as unknown as HTMLAnchorElement;
    expect(link.href).toBe('https://files.example.test/signed?sig=abc');
    expect(link.download).toBe('backup-2026-11-01.zip');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.style.display).toBe('none');
    expect(attachedAtClick).toBe(true);
    expect(document.body.contains(link)).toBe(false);
  });

  it('removes the anchor even when click throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    const before = document.body.querySelectorAll('a').length;

    expect(() => startUrlDownload('https://files.example.test/x', 'x.zip')).toThrow('blocked');
    expect(document.body.querySelectorAll('a').length).toBe(before);
  });
});
