import { BadRequestException } from '@nestjs/common';

import { BACKUP_CONTENT_MESSAGES } from '../../secrets/export/backup-contents';
import {
  BACKUP_KEEP_COUNT_MAX,
  BACKUP_KEEP_COUNT_MIN,
  parseUpdateBackupScheduleBody,
  updateBackupScheduleSchema,
} from './update-backup-schedule.dto';

const valid = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'UTC',
  keepCount: 7,
  includeAttachments: true,
  includeVersions: false,
  ...over,
});

const messages = (body: unknown): string[] => {
  const result = updateBackupScheduleSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

const ok = (body: unknown) => updateBackupScheduleSchema.safeParse(body).success;

describe('UpdateBackupScheduleDto validation', () => {
  it('accepts a complete daily body without a password', () => {
    expect(ok(valid())).toBe(true);
  });

  describe('per-frequency required fields', () => {
    it('hourly requires intervalHours from the allowed list', () => {
      expect(ok(valid({ frequency: 'hourly', intervalHours: 6 }))).toBe(true);
      expect(messages(valid({ frequency: 'hourly', intervalHours: null }))[0]).toMatch(/intervalHours/);
      expect(ok(valid({ frequency: 'hourly', intervalHours: 5 }))).toBe(false);
      expect(ok(valid({ frequency: 'hourly', intervalHours: 0 }))).toBe(false);
    });

    it('weekly requires dayOfWeek 0-6', () => {
      expect(ok(valid({ frequency: 'weekly', dayOfWeek: 0 }))).toBe(true);
      expect(ok(valid({ frequency: 'weekly', dayOfWeek: 6 }))).toBe(true);
      expect(messages(valid({ frequency: 'weekly', dayOfWeek: null }))[0]).toMatch(/dayOfWeek/);
      expect(ok(valid({ frequency: 'weekly', dayOfWeek: 7 }))).toBe(false);
      expect(ok(valid({ frequency: 'weekly', dayOfWeek: -1 }))).toBe(false);
    });

    it('monthly requires dayOfMonth 1-28', () => {
      expect(ok(valid({ frequency: 'monthly', dayOfMonth: 1 }))).toBe(true);
      expect(ok(valid({ frequency: 'monthly', dayOfMonth: 28 }))).toBe(true);
      expect(messages(valid({ frequency: 'monthly', dayOfMonth: null }))[0]).toMatch(/dayOfMonth/);
      expect(ok(valid({ frequency: 'monthly', dayOfMonth: 0 }))).toBe(false);
      expect(ok(valid({ frequency: 'monthly', dayOfMonth: 29 }))).toBe(false);
    });

    it('daily needs none of the optional day fields', () => {
      expect(ok(valid({ frequency: 'daily', intervalHours: null, dayOfWeek: null, dayOfMonth: null }))).toBe(true);
    });

    it('rejects a non-integer day', () => {
      expect(ok(valid({ frequency: 'weekly', dayOfWeek: 1.5 }))).toBe(false);
    });

    it('rejects an unknown frequency', () => {
      expect(ok(valid({ frequency: 'yearly' }))).toBe(false);
    });
  });

  describe('timezone and timeOfDay', () => {
    it.each(['UTC', 'America/Chicago', 'Europe/Madrid', 'Asia/Kolkata'])('accepts %s', (timezone) => {
      expect(ok(valid({ timezone }))).toBe(true);
    });

    it.each(['Mars/Olympus', 'not a zone', '', 'America/'])('rejects %p', (timezone) => {
      expect(ok(valid({ timezone }))).toBe(false);
    });

    it('rejects a non-string timezone', () => {
      expect(ok(valid({ timezone: 5 }))).toBe(false);
    });

    it.each(['00:00', '23:59', '03:30'])('accepts timeOfDay %s', (timeOfDay) => {
      expect(ok(valid({ timeOfDay }))).toBe(true);
    });

    it.each(['24:00', '3:00', '12:60', 'noon', ''])('rejects timeOfDay %p', (timeOfDay) => {
      expect(ok(valid({ timeOfDay }))).toBe(false);
    });
  });

  describe('keepCount', () => {
    it('accepts the bounds', () => {
      expect(ok(valid({ keepCount: BACKUP_KEEP_COUNT_MIN }))).toBe(true);
      expect(ok(valid({ keepCount: BACKUP_KEEP_COUNT_MAX }))).toBe(true);
    });

    it('rejects below, above, fractional and non-numeric values', () => {
      expect(ok(valid({ keepCount: BACKUP_KEEP_COUNT_MIN - 1 }))).toBe(false);
      expect(ok(valid({ keepCount: BACKUP_KEEP_COUNT_MAX + 1 }))).toBe(false);
      expect(ok(valid({ keepCount: 2.5 }))).toBe(false);
      expect(ok(valid({ keepCount: '7' }))).toBe(false);
    });
  });

  describe('password', () => {
    it('rejects 5 characters and accepts 6', () => {
      expect(ok(valid({ password: 'a'.repeat(5) }))).toBe(false);
      expect(ok(valid({ password: 'a'.repeat(6) }))).toBe(true);
    });

    it('accepts 256 characters and rejects 257', () => {
      expect(ok(valid({ password: 'a'.repeat(256) }))).toBe(true);
      expect(ok(valid({ password: 'a'.repeat(257) }))).toBe(false);
    });

    it('rejects a non-string password', () => {
      expect(ok(valid({ password: 123456 }))).toBe(false);
    });

    it('does not trim the password', () => {
      expect(ok(valid({ password: '      ' }))).toBe(true);
    });

    it('never echoes the submitted password in an error message', () => {
      const secret = 'zz9';
      const all = messages(valid({ password: secret, keepCount: 0 })).join(' ');
      expect(all).not.toContain(secret);
    });
  });

  it('requires every editable field', () => {
    for (const field of [
      'enabled',
      'frequency',
      'timeOfDay',
      'timezone',
      'keepCount',
      'includeAttachments',
      'includeVersions',
    ]) {
      const body: Record<string, unknown> = valid();
      delete body[field];
      expect(ok(body)).toBe(false);
    }
  });

  describe('parseUpdateBackupScheduleBody', () => {
    it('returns the parsed body', () => {
      expect(parseUpdateBackupScheduleBody(valid({ password: 'secret1' })).password).toBe('secret1');
    });

    it('throws a 400 carrying the first message and field paths, never the value', () => {
      let error: unknown;
      try {
        parseUpdateBackupScheduleBody(valid({ password: 'abc' }));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(response.message).toMatch(/at least 6/);
      expect(response.details[0].field).toBe('password');
      expect(JSON.stringify(response)).not.toContain('abc"');
    });

    it('rejects a non-object body', () => {
      expect(() => parseUpdateBackupScheduleBody(undefined)).toThrow(BadRequestException);
      expect(() => parseUpdateBackupScheduleBody('x')).toThrow(BadRequestException);
    });
  });
  describe('content selection', () => {
    it('defaults includeSecrets true, includeMedia and includeSystem false (older clients)', () => {
      const parsed = parseUpdateBackupScheduleBody(valid());
      expect(parsed).toMatchObject({ includeSecrets: true, includeMedia: false, includeSystem: false });
    });

    it('accepts every combination that selects something', () => {
      expect(ok(valid({ includeSecrets: true, includeMedia: true, includeSystem: true }))).toBe(true);
      expect(
        ok(valid({ includeSecrets: false, includeAttachments: false, includeVersions: false, includeMedia: true })),
      ).toBe(true);
      expect(
        ok(valid({ includeSecrets: false, includeAttachments: false, includeVersions: false, includeSystem: true })),
      ).toBe(true);
    });

    it('400 "Choose at least one thing to back up" when nothing is selected', () => {
      expect(
        messages(valid({ includeSecrets: false, includeAttachments: false, includeVersions: false })),
      ).toEqual([BACKUP_CONTENT_MESSAGES.nothingSelected]);
    });

    it('rejects attachments or versions true while secrets are off', () => {
      expect(messages(valid({ includeSecrets: false, includeMedia: true, includeAttachments: true }))).toEqual([
        BACKUP_CONTENT_MESSAGES.attachmentsWithoutSecrets,
      ]);
      expect(
        messages(valid({ includeSecrets: false, includeSystem: true, includeAttachments: false, includeVersions: true })),
      ).toEqual([BACKUP_CONTENT_MESSAGES.versionsWithoutSecrets]);
    });

    it.each(['includeSecrets', 'includeMedia', 'includeSystem'])('rejects a non-boolean %s', (field) => {
      expect(messages(valid({ [field]: 'yes' }))[0]).toBe(`${field} must be a boolean`);
    });

    it('the 400 carries the specific message', () => {
      expect(() =>
        parseUpdateBackupScheduleBody(valid({ includeSecrets: false, includeAttachments: false })),
      ).toThrow(BadRequestException);
      try {
        parseUpdateBackupScheduleBody(valid({ includeSecrets: false, includeAttachments: false }));
      } catch (error) {
        expect(((error as BadRequestException).getResponse() as { message: string }).message).toBe(
          'Choose at least one thing to back up',
        );
      }
    });
  });
});
