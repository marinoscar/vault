import { describe, expect, it } from 'vitest';

import {
  BACKUP_CONTENT_DEFAULTS,
  BACKUP_CONTENT_KEYS,
  BACKUP_FREQUENCIES,
  BACKUP_INTERVAL_HOURS,
  contentSelectionIssues,
  describeContents,
  exportSecretsSchema,
  exportSystemBackupSchema,
  isValidTimeOfDay,
  isValidTimeZone,
  resolveContentSelection,
  selectedContentKeys,
  updateBackupScheduleSchema,
} from '../src/backups/index.js';

const schedule = {
  enabled: true, frequency: 'daily', intervalHours: null, timeOfDay: '03:00', dayOfWeek: null, dayOfMonth: null,
  timezone: 'UTC', keepCount: 7, includeAttachments: true, includeVersions: false,
};

describe('content selection', () => {
  it('applies the defaults and turns attachments and versions off with secrets', () => {
    expect(resolveContentSelection({})).toEqual({ ...BACKUP_CONTENT_DEFAULTS });
    expect(resolveContentSelection({ includeSecrets: false, includeMedia: true })).toMatchObject({ includeAttachments: false, includeVersions: false, includeMedia: true });
  });

  it('rejects nothing selected, attachments without secrets and system at user level', () => {
    expect(contentSelectionIssues({ includeSecrets: false }, 'user').map((i) => i.path)).toEqual(['includeSecrets']);
    expect(contentSelectionIssues({ includeSecrets: false, includeMedia: true, includeAttachments: true }, 'user').map((i) => i.path)).toEqual(['includeAttachments']);
    expect(contentSelectionIssues({ includeSystem: false }, 'user').map((i) => i.path)).toEqual(['includeSystem']);
    expect(contentSelectionIssues({ includeSecrets: false, includeSystem: true }, 'system')).toEqual([]);
  });

  it('lists keys in the fixed order and describes them', () => {
    const all = { includeSecrets: true, includeAttachments: true, includeVersions: true, includeMedia: true, includeSystem: true };
    expect(selectedContentKeys(all)).toEqual([...BACKUP_CONTENT_KEYS]);
    expect(describeContents(all)).toBe('secrets (with attachments and old versions), media library, system configuration');
    expect(describeContents({ includeSecrets: false, includeAttachments: false, includeVersions: false, includeMedia: false })).toBe('nothing');
  });
});

describe('schedule vocabulary', () => {
  it('validates times and zones', () => {
    expect(isValidTimeOfDay('23:59')).toBe(true);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(BACKUP_FREQUENCIES).toEqual(['hourly', 'daily', 'weekly', 'monthly']);
    expect(BACKUP_INTERVAL_HOURS.every((h) => 24 % h === 0)).toBe(true);
  });
});

describe('export schemas', () => {
  it('requires a password of six to 256 characters and rejects includeSystem', () => {
    expect(exportSecretsSchema.safeParse({ password: '123456' }).success).toBe(true);
    const short = exportSecretsSchema.safeParse({ password: '12345' });
    expect(short.success).toBe(false);
    expect(!short.success && short.error.issues[0]?.message).toBe('Password must be at least 6 characters');
    expect(exportSecretsSchema.safeParse({ password: 'x'.repeat(257) }).success).toBe(false);
    expect(exportSecretsSchema.safeParse({ password: '123456', includeSystem: false }).success).toBe(false);
  });

  it('does not echo the password in a message', () => {
    const result = exportSecretsSchema.safeParse({ password: 'abc', includeSecrets: 'yes' });
    expect(JSON.stringify(!result.success && result.error.issues)).not.toContain('abc');
  });

  it('takes exactly one password source for a system export', () => {
    expect(exportSystemBackupSchema.safeParse({}).success).toBe(false);
    expect(exportSystemBackupSchema.safeParse({ useScheduledPassword: true }).success).toBe(true);
    expect(exportSystemBackupSchema.safeParse({ useScheduledPassword: true, password: '123456' }).success).toBe(false);
  });
});

describe('updateBackupScheduleSchema', () => {
  it('accepts a daily schedule and defaults the later content flags', () => {
    expect(updateBackupScheduleSchema.parse(schedule)).toMatchObject({ includeSecrets: true, includeMedia: false, includeSystem: false });
  });

  it('requires the field its frequency needs', () => {
    expect(updateBackupScheduleSchema.safeParse({ ...schedule, frequency: 'hourly' }).success).toBe(false);
    expect(updateBackupScheduleSchema.safeParse({ ...schedule, frequency: 'hourly', intervalHours: 6 }).success).toBe(true);
    expect(updateBackupScheduleSchema.safeParse({ ...schedule, frequency: 'weekly', dayOfWeek: 7 }).success).toBe(false);
    expect(updateBackupScheduleSchema.safeParse({ ...schedule, frequency: 'monthly', dayOfMonth: 29 }).success).toBe(false);
    expect(updateBackupScheduleSchema.safeParse({ ...schedule, keepCount: 366 }).success).toBe(false);
    expect(updateBackupScheduleSchema.safeParse({ ...schedule, timezone: 'Mars/Base' }).success).toBe(false);
  });
});
