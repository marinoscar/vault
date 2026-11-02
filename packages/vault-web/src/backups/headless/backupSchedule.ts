/**
 * Pure helpers for the admin "Scheduled backups" card: option lists, the
 * human-readable schedule summary, client-side validation and formatting.
 * The API re-validates everything; these only shape the form.
 */
import type { BackupFrequency, BackupScheduleFields } from '../../core/headless/types.js';
import {
  fromBackupContentFlags,
  rawBackupContentFlags,
  toBackupContentFlags,
  validateBackupContents,
  type BackupContentSelection,
} from './backupContents.js';

export const BACKUP_INTERVAL_HOURS: readonly number[] = [1, 2, 3, 4, 6, 8, 12];

export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 365;
export const BACKUP_KEEP_DEFAULT = 7;

export const BACKUP_DAY_OF_MONTH_MAX = 28;

export const BACKUP_FREQUENCY_LABELS: Record<BackupFrequency, string> = {
  hourly: 'Every N hours',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** Index = `dayOfWeek` (0 = Sunday). */
export const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const BACKUP_PASSWORD_LOSS_WARNING =
  'If you lose this password, these backups cannot be opened. There is no recovery.';

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a 24-hour 'HH:mm' value. */
export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_RE.test(value);
}

/** The browser's IANA time zone, or 'UTC' when it cannot be read. */
export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Every IANA time zone the browser knows, always including 'UTC' and
 * `current` (so a stored value from another runtime stays selectable).
 */
export function getTimeZoneOptions(current?: string): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (typeof supported === 'function') zones = supported('timeZone');
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  set.add('UTC');
  if (current) set.add(current);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function keepsText(keepCount: number): string {
  return `keeps ${keepCount}`;
}

/**
 * Human summary, e.g. "Every day at 03:00 (America/Chicago) · keeps 7".
 */
export function describeBackupSchedule(schedule: BackupScheduleFields): string {
  const tz = `(${schedule.timezone})`;
  const at = `at ${schedule.timeOfDay} ${tz}`;
  let when: string;
  switch (schedule.frequency) {
    case 'hourly': {
      const n = schedule.intervalHours ?? 1;
      when = n === 1 ? 'Every hour' : `Every ${n} hours`;
      break;
    }
    case 'weekly': {
      const day = WEEKDAY_NAMES[schedule.dayOfWeek ?? 0] ?? WEEKDAY_NAMES[0];
      when = `Every ${day} ${at}`;
      break;
    }
    case 'monthly':
      when = `Monthly on day ${schedule.dayOfMonth ?? 1} ${at}`;
      break;
    case 'daily':
    default:
      when = `Every day ${at}`;
      break;
  }
  return `${when} · ${keepsText(schedule.keepCount)}`;
}

/** The "What to back up" selection held by a schedule's include flags. */
export function scheduleContentSelection(fields: BackupScheduleFields): BackupContentSelection {
  return fromBackupContentFlags(fields);
}

/**
 * The schedule fields with the include flags replaced by a selection, kept
 * as selected (turning Secrets back on restores the nested options);
 * `normalizeScheduleFields` applies the nested rule before sending.
 */
export function withScheduleContents<T extends BackupScheduleFields>(
  fields: T,
  selection: BackupContentSelection,
): T {
  return { ...fields, ...rawBackupContentFlags(selection) };
}

/**
 * Normalize the editable fields before sending: frequency-specific fields
 * that do not apply are sent as null, the ones that do get a default.
 * Attachments and versions are sent as false while Secrets is off (the API
 * rejects them without secrets).
 */
export function normalizeScheduleFields(fields: BackupScheduleFields): BackupScheduleFields {
  return {
    ...fields,
    ...toBackupContentFlags(scheduleContentSelection(fields)),
    intervalHours: fields.frequency === 'hourly' ? fields.intervalHours ?? 1 : null,
    dayOfWeek: fields.frequency === 'weekly' ? fields.dayOfWeek ?? 1 : null,
    dayOfMonth: fields.frequency === 'monthly' ? fields.dayOfMonth ?? 1 : null,
  };
}

/** Blocking validation of the schedule fields (not the password). */
export function validateScheduleFields(fields: BackupScheduleFields): string | null {
  if (fields.frequency === 'hourly') {
    if (!BACKUP_INTERVAL_HOURS.includes(fields.intervalHours ?? -1)) {
      return 'Choose how many hours between backups';
    }
  } else if (!isValidTimeOfDay(fields.timeOfDay)) {
    return 'Enter a time as HH:mm';
  }
  if (
    fields.frequency === 'weekly' &&
    (fields.dayOfWeek === null || fields.dayOfWeek < 0 || fields.dayOfWeek > 6)
  ) {
    return 'Choose a day of the week';
  }
  if (
    fields.frequency === 'monthly' &&
    (fields.dayOfMonth === null ||
      fields.dayOfMonth < 1 ||
      fields.dayOfMonth > BACKUP_DAY_OF_MONTH_MAX)
  ) {
    return `Choose a day of the month between 1 and ${BACKUP_DAY_OF_MONTH_MAX}`;
  }
  if (!fields.timezone) {
    return 'Choose a time zone';
  }
  if (
    !Number.isInteger(fields.keepCount) ||
    fields.keepCount < BACKUP_KEEP_MIN ||
    fields.keepCount > BACKUP_KEEP_MAX
  ) {
    return `Keep between ${BACKUP_KEEP_MIN} and ${BACKUP_KEEP_MAX} backups`;
  }
  return validateBackupContents(scheduleContentSelection(fields));
}

/** "1.4 MB"-style size; em dash for null. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Locale date-time for an ISO string, or null when missing/invalid. */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

/**
 * Start a download from a signed URL without opening a window (a popup
 * opened after an await is usually blocked). The server sets the
 * attachment disposition, so the page does not navigate away.
 */
export function startUrlDownload(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
  }
}
