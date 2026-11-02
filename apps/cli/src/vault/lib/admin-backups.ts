/**
 * Pure helpers for `vault admin backups ...` and the "Admin backups" menu:
 * the wire shapes of `/api/admin/backups`, flag-to-body merging, the same
 * validation rules as the API, human summaries, download file naming and the
 * menu visibility rule. No I/O here (file-system lookups are injected), so
 * everything is unit tested.
 */
import { basename, join } from 'path';

// ---------------------------------------------------------------------------
// Wire shapes (binding: apps/api/src/backups/dto/backup-responses.ts)
// ---------------------------------------------------------------------------

export const SCHEDULE_FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/** Allowed `intervalHours` for hourly: each divides 24. */
export const SCHEDULE_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;
export const KEEP_COUNT_MIN = 1;
export const KEEP_COUNT_MAX = 365;
export const SCHEDULE_PASSWORD_MIN = 6;
export const SCHEDULE_PASSWORD_MAX = 256;
/** Below this, or a single word, the password gets a soft (non-blocking) warning. */
export const SCHEDULE_PASSWORD_RECOMMENDED = 12;

export const SYSTEM_SETTINGS_READ = 'system_settings:read';
export const ADMIN_REQUIRED_MESSAGE = 'This needs an administrator account (system_settings permission).';
export const RUN_ALREADY_RUNNING_MESSAGE =
  'A backup is already running. Wait for it to finish (vault admin backups list), then try again.';
export const ENABLE_WITHOUT_PASSWORD_MESSAGE = 'Set a backup password before enabling scheduled backups';
export const ENABLE_WITHOUT_STORAGE_MESSAGE =
  'Object storage is not configured, so scheduled backups cannot be enabled';
export const NOTHING_SELECTED_MESSAGE = 'Choose at least one thing to back up';
export const PASSWORD_WARNING =
  'Short passwords are easy to guess if a backup file is lost or shared. Two or three words like ' +
  '"blue tiger river" are much safer and still easy to remember.';
export const PASSWORD_LOSS_WARNING =
  'If you lose this password, these backups cannot be opened. There is no recovery.';

/** `GET`/`PUT /api/admin/backups/schedule`. The include flags added later may be missing on an older server. */
export interface AdminBackupSchedule {
  enabled: boolean;
  frequency: ScheduleFrequency;
  intervalHours: number | null;
  timeOfDay: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  keepCount: number;
  includeSecrets?: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia?: boolean;
  includeSystem?: boolean;
  passwordConfigured: boolean;
  passwordUpdatedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  storageConfigured: boolean;
  updatedAt: string | null;
}

/** Body of `PUT /api/admin/backups/schedule`: every editable field, `password` optional (write-only). */
export interface AdminBackupScheduleBody {
  enabled: boolean;
  frequency: ScheduleFrequency;
  intervalHours: number | null;
  timeOfDay: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  keepCount: number;
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
  includeSystem: boolean;
  password?: string;
}

export type BackupRunStatus = 'running' | 'succeeded' | 'failed';

export interface AdminBackupRun {
  id: string;
  status: BackupRunStatus;
  trigger: 'schedule' | 'manual';
  triggeredBy: { id: string; email: string; displayName: string | null } | null;
  sizeBytes: number | null;
  userCount: number;
  secretCount: number;
  attachmentCount: number;
  mediaFileCount?: number;
  warningCount: number;
  contents?: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  deletedAt: string | null;
  downloadable: boolean;
}

export interface AdminBackupRunList {
  items: AdminBackupRun[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminBackupDownload {
  url: string;
  expiresAt: string;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

/** Keys of `--contents` for the admin schedule, in display order. */
export const ADMIN_CONTENT_KEYS = ['secrets', 'attachments', 'versions', 'media', 'system'] as const;
export type AdminContentKey = (typeof ADMIN_CONTENT_KEYS)[number];

export interface AdminBackupContents {
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
  includeSystem: boolean;
}

/** Default for a new schedule: secrets with attachments. */
export const DEFAULT_ADMIN_CONTENTS: Readonly<AdminBackupContents> = {
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  includeSystem: false,
};

/** Turn a key list into the five include flags (keys not listed are off). Throws on an unknown key. Pure. */
export function adminContentsFromKeys(keys: readonly string[], label = '--contents'): AdminBackupContents {
  const valid = ADMIN_CONTENT_KEYS as readonly string[];
  const unknown = keys.filter((k) => !valid.includes(k));
  if (unknown.length) {
    throw new Error(
      `Unknown ${label} value(s): ${[...new Set(unknown)].join(', ')}. Valid values: ${ADMIN_CONTENT_KEYS.join(', ')}`,
    );
  }
  const set = new Set(keys);
  return {
    includeSecrets: set.has('secrets'),
    includeAttachments: set.has('attachments'),
    includeVersions: set.has('versions'),
    includeMedia: set.has('media'),
    includeSystem: set.has('system'),
  };
}

/** Parse `--contents secrets,media,system` (case and spaces ignored). Pure. */
export function parseAdminContentsOption(raw: string): AdminBackupContents {
  const keys = String(raw)
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k !== '');
  if (keys.length === 0) {
    throw new Error(`--contents needs a comma-separated list of: ${ADMIN_CONTENT_KEYS.join(', ')}`);
  }
  return adminContentsFromKeys(keys);
}

/** The selected keys (attachments / versions only with secrets). Pure. */
export function adminContentKeys(c: AdminBackupContents): AdminContentKey[] {
  const keys: AdminContentKey[] = [];
  if (c.includeSecrets) {
    keys.push('secrets');
    if (c.includeAttachments) keys.push('attachments');
    if (c.includeVersions) keys.push('versions');
  }
  if (c.includeMedia) keys.push('media');
  if (c.includeSystem) keys.push('system');
  return keys;
}

/** The include flags of a schedule response, filling the ones an older server omits. Pure. */
export function scheduleContents(s: Partial<AdminBackupContents>): AdminBackupContents {
  return {
    includeSecrets: s.includeSecrets ?? true,
    includeAttachments: s.includeAttachments ?? true,
    includeVersions: s.includeVersions ?? false,
    includeMedia: s.includeMedia ?? false,
    includeSystem: s.includeSystem ?? false,
  };
}

/**
 * Human summary like the web's, e.g. "Secrets with attachments",
 * "Secrets, media library, system configuration". Pure.
 */
export function describeAdminContents(c: AdminBackupContents): string {
  const parts: string[] = [];
  if (c.includeSecrets) {
    const extras = [c.includeAttachments ? 'attachments' : null, c.includeVersions ? 'old versions' : null].filter(Boolean);
    parts.push(extras.length ? `secrets with ${extras.join(' and ')}` : 'secrets only');
  }
  if (c.includeMedia) parts.push('media library');
  if (c.includeSystem) parts.push('system configuration');
  if (parts.length === 0) return 'Nothing selected';
  if (parts.length > 1 && parts[0] === 'secrets only') parts[0] = 'secrets';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const RUN_CONTENT_LABELS: Record<string, string> = {
  secrets: 'Secrets',
  attachments: 'Attachments',
  versions: 'Versions',
  media: 'Media',
  system: 'System',
};

/** Short label of a run's `contents`, e.g. "Secrets, Attachments, System"; "-" when unknown. Pure. */
export function describeRunContents(contents: readonly string[] | undefined): string {
  if (!contents || contents.length === 0) return '-';
  return contents.map((k) => RUN_CONTENT_LABELS[k] ?? k).join(', ');
}

// ---------------------------------------------------------------------------
// Parsing of single flag values
// ---------------------------------------------------------------------------

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** `--day`: mon..sun (or full names, any case) or 0-6 (0 = Sunday). Pure. */
export function parseDayOfWeek(raw: string): number {
  const s = String(raw).trim().toLowerCase();
  if (/^[0-6]$/.test(s)) return Number(s);
  if (s.length >= 3) {
    const idx = WEEKDAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(s) && (s.length === 3 || d.toLowerCase() === s));
    if (idx >= 0) return idx;
  }
  throw new Error(`--day must be mon, tue, wed, thu, fri, sat, sun or 0-6 (0 = Sunday), got "${raw}"`);
}

/** `--at`: H:mm or HH:mm (24h) → "HH:mm". Pure. */
export function parseTimeOfDayFlag(raw: string): string {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(raw));
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min <= 59) return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  throw new Error(`--at must be HH:mm (00:00 to 23:59), got "${raw}"`);
}

/** A whole number for `label`; range checks are left to {@link validateScheduleBody}. Pure. */
export function parseIntFlag(raw: string | number, label: string): number {
  const s = String(raw).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`${label} must be a whole number, got "${raw}"`);
  return Number(s);
}

/** `--frequency`. Pure. */
export function parseFrequency(raw: string): ScheduleFrequency {
  const s = String(raw).trim().toLowerCase();
  if ((SCHEDULE_FREQUENCIES as readonly string[]).includes(s)) return s as ScheduleFrequency;
  throw new Error(`--frequency must be one of ${SCHEDULE_FREQUENCIES.join(', ')}, got "${raw}"`);
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidTimeOfDay(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// ---------------------------------------------------------------------------
// Flag merging
// ---------------------------------------------------------------------------

/** Options of `admin backups schedule set` that were typed on the command line (raw strings). */
export interface ScheduleFlags {
  enabled?: boolean;
  frequency?: string;
  every?: string;
  at?: string;
  day?: string;
  dayOfMonth?: string;
  timezone?: string;
  keep?: string;
  contents?: string;
  secrets?: boolean;
  attachments?: boolean;
  includeVersions?: boolean;
  media?: boolean;
  system?: boolean;
}

/** The editable fields of a schedule response, as a PUT body (no password). Pure. */
export function scheduleToBody(s: AdminBackupSchedule): AdminBackupScheduleBody {
  return {
    enabled: s.enabled,
    frequency: s.frequency,
    intervalHours: s.intervalHours ?? null,
    timeOfDay: s.timeOfDay,
    dayOfWeek: s.dayOfWeek ?? null,
    dayOfMonth: s.dayOfMonth ?? null,
    timezone: s.timezone,
    keepCount: s.keepCount,
    ...scheduleContents(s),
  };
}

/**
 * Apply the typed flags to the current schedule and return the full PUT body.
 *
 * - `--contents` sets all five include flags and overrides the individual ones.
 * - With secrets off, attachments / versions that come from the current
 *   schedule are dropped silently; asking for them with a flag is an error.
 * - Fields the frequency does not use are sent as null; a field the new
 *   frequency needs keeps its current value unless a flag sets it.
 *
 * Throws on a malformed flag value; range and cross-field rules are checked by
 * {@link validateScheduleBody}. Pure.
 */
export function mergeScheduleFlags(current: AdminBackupScheduleBody, flags: ScheduleFlags): AdminBackupScheduleBody {
  const next: AdminBackupScheduleBody = { ...current };
  delete next.password;
  if (flags.enabled !== undefined) next.enabled = flags.enabled;
  if (flags.frequency !== undefined) next.frequency = parseFrequency(flags.frequency);
  if (flags.every !== undefined) next.intervalHours = parseIntFlag(flags.every, '--every');
  if (flags.at !== undefined) next.timeOfDay = parseTimeOfDayFlag(flags.at);
  if (flags.day !== undefined) next.dayOfWeek = parseDayOfWeek(flags.day);
  if (flags.dayOfMonth !== undefined) next.dayOfMonth = parseIntFlag(flags.dayOfMonth, '--day-of-month');
  if (flags.timezone !== undefined) next.timezone = flags.timezone.trim();
  if (flags.keep !== undefined) next.keepCount = parseIntFlag(flags.keep, '--keep');

  if (flags.every !== undefined && next.frequency !== 'hourly') {
    throw new Error('--every applies only to an hourly schedule (add --frequency hourly)');
  }
  if (flags.day !== undefined && next.frequency !== 'weekly') {
    throw new Error('--day applies only to a weekly schedule (add --frequency weekly)');
  }
  if (flags.dayOfMonth !== undefined && next.frequency !== 'monthly') {
    throw new Error('--day-of-month applies only to a monthly schedule (add --frequency monthly)');
  }
  if (flags.at !== undefined && next.frequency === 'hourly') {
    throw new Error('--at does not apply to an hourly schedule (hourly runs on the hour; use --every)');
  }

  if (next.frequency !== 'hourly') next.intervalHours = null;
  if (next.frequency !== 'weekly') next.dayOfWeek = null;
  if (next.frequency !== 'monthly') next.dayOfMonth = null;

  // Contents.
  if (flags.contents !== undefined) {
    Object.assign(next, parseAdminContentsOption(flags.contents));
  } else {
    if (flags.secrets !== undefined) next.includeSecrets = flags.secrets;
    if (flags.attachments !== undefined) next.includeAttachments = flags.attachments;
    if (flags.includeVersions !== undefined) next.includeVersions = flags.includeVersions;
    if (flags.media !== undefined) next.includeMedia = flags.media;
    if (flags.system !== undefined) next.includeSystem = flags.system;
    if (!next.includeSecrets) {
      const flagged = [
        flags.attachments === true ? '--attachments' : null,
        flags.includeVersions === true ? '--include-versions' : null,
      ].filter(Boolean);
      if (flagged.length) {
        throw new Error(`${flagged.join(' and ')} require secrets; remove --no-secrets or ${flagged.join(' / ')}`);
      }
      next.includeAttachments = false;
      next.includeVersions = false;
    }
  }
  return next;
}

/** True when at least one schedule option was given. Pure. */
export function hasScheduleFlags(flags: ScheduleFlags): boolean {
  return Object.values(flags).some((v) => v !== undefined);
}

// ---------------------------------------------------------------------------
// Validation (same rules as UpdateBackupScheduleDto and BackupsService)
// ---------------------------------------------------------------------------

export interface ScheduleValidationContext {
  /** A password is already stored on the server. */
  passwordConfigured: boolean;
  /** Object storage is configured on the server. */
  storageConfigured: boolean;
}

/**
 * Every rule the API applies to a PUT body, in the API's order. Returns the
 * messages (empty when the body is acceptable). Pure.
 */
export function validateScheduleBody(body: AdminBackupScheduleBody, ctx: ScheduleValidationContext): string[] {
  const errors: string[] = [];
  if (!(SCHEDULE_FREQUENCIES as readonly string[]).includes(body.frequency)) {
    errors.push(`frequency must be one of ${SCHEDULE_FREQUENCIES.join(', ')}`);
  }
  if (!isValidTimeOfDay(body.timeOfDay)) errors.push('timeOfDay must be HH:mm (00:00 to 23:59)');
  if (!isValidTimeZone(body.timezone)) errors.push(`timezone must be a valid IANA time zone (got "${body.timezone}")`);
  if (!Number.isInteger(body.keepCount)) errors.push('keepCount must be an integer');
  else if (body.keepCount < KEEP_COUNT_MIN) errors.push(`keepCount must be at least ${KEEP_COUNT_MIN}`);
  else if (body.keepCount > KEEP_COUNT_MAX) errors.push(`keepCount must be at most ${KEEP_COUNT_MAX}`);
  if (body.password !== undefined) {
    if (body.password.length < SCHEDULE_PASSWORD_MIN) {
      errors.push(`Password must be at least ${SCHEDULE_PASSWORD_MIN} characters`);
    } else if (body.password.length > SCHEDULE_PASSWORD_MAX) {
      errors.push(`Password must be at most ${SCHEDULE_PASSWORD_MAX} characters`);
    }
  }
  if (body.frequency === 'hourly') {
    if (body.intervalHours === null || !(SCHEDULE_INTERVAL_HOURS as readonly number[]).includes(body.intervalHours)) {
      errors.push(`intervalHours (--every) must be one of ${SCHEDULE_INTERVAL_HOURS.join(', ')} for an hourly schedule`);
    }
  }
  if (body.frequency === 'weekly') {
    if (body.dayOfWeek === null || !Number.isInteger(body.dayOfWeek) || body.dayOfWeek < 0 || body.dayOfWeek > 6) {
      errors.push('dayOfWeek (--day) must be 0 (Sunday) to 6 for a weekly schedule');
    }
  }
  if (body.frequency === 'monthly') {
    if (body.dayOfMonth === null || !Number.isInteger(body.dayOfMonth) || body.dayOfMonth < 1 || body.dayOfMonth > 28) {
      errors.push('dayOfMonth (--day-of-month) must be 1 to 28 for a monthly schedule');
    }
  }
  if (!body.includeSecrets) {
    const orphan = [body.includeAttachments ? 'attachments' : null, body.includeVersions ? 'old versions' : null].filter(Boolean);
    if (orphan.length) errors.push(`Secret ${orphan.join(' and ')} require secrets to be included`);
  }
  if (!body.includeSecrets && !body.includeMedia && !body.includeSystem) errors.push(NOTHING_SELECTED_MESSAGE);
  if (body.enabled) {
    if (!ctx.passwordConfigured && body.password === undefined) errors.push(ENABLE_WITHOUT_PASSWORD_MESSAGE);
    if (!ctx.storageConfigured) errors.push(ENABLE_WITHOUT_STORAGE_MESSAGE);
  }
  return errors;
}

/** Whether a new schedule password gets the soft warning (short or a single word). Pure. */
export function shouldWarnSchedulePassword(pw: string): boolean {
  if (pw.length === 0) return false;
  return pw.length < SCHEDULE_PASSWORD_RECOMMENDED || pw.trim().split(/\s+/).filter(Boolean).length <= 1;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

type ScheduleTiming = Pick<
  AdminBackupScheduleBody,
  'frequency' | 'intervalHours' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth' | 'timezone' | 'keepCount'
>;

/** When it runs, e.g. "Every day at 03:00 (America/Chicago)". Pure. */
export function describeScheduleTiming(s: ScheduleTiming): string {
  const tz = `(${s.timezone})`;
  const at = `at ${s.timeOfDay} ${tz}`;
  switch (s.frequency) {
    case 'hourly': {
      const n = s.intervalHours ?? 1;
      return `${n === 1 ? 'Every hour' : `Every ${n} hours`} ${tz}`;
    }
    case 'weekly':
      return `Every ${WEEKDAY_NAMES[s.dayOfWeek ?? 0] ?? WEEKDAY_NAMES[0]} ${at}`;
    case 'monthly':
      return `Monthly on day ${s.dayOfMonth ?? 1} ${at}`;
    case 'daily':
    default:
      return `Every day ${at}`;
  }
}

/**
 * One-line summary: "Every day at 03:00 (America/Chicago) · keeps 7 · Secrets with attachments". Pure.
 */
export function describeSchedule(s: ScheduleTiming & Partial<AdminBackupContents>): string {
  return `${describeScheduleTiming(s)} · keeps ${s.keepCount} · ${describeAdminContents(scheduleContents(s))}`;
}

/** A timestamp for people: local "YYYY-MM-DD HH:mm", or "-" when empty. Pure (time zone injectable). */
export function formatWhen(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** Lines of `schedule show` (label, value). Pure. */
export function scheduleDetails(s: AdminBackupSchedule, timeZone?: string): [string, string][] {
  return [
    ['Status', s.enabled ? 'Enabled' : 'Disabled'],
    ['Schedule', describeSchedule(s)],
    ['Next run', s.enabled ? formatWhen(s.nextRunAt, timeZone) : '- (disabled)'],
    ['Last run', formatWhen(s.lastRunAt, timeZone)],
    ['Password', s.passwordConfigured ? `set${s.passwordUpdatedAt ? ` on ${formatWhen(s.passwordUpdatedAt, timeZone)}` : ''}` : 'not set'],
    ['Storage', s.storageConfigured ? 'configured' : 'not configured'],
  ];
}

/** Counts of a run, e.g. "3 users, 42 secrets, 5 attachments, 2 media files". Pure. */
export function describeRunCounts(r: AdminBackupRun): string {
  const parts = [`${r.userCount} users`, `${r.secretCount} secrets`, `${r.attachmentCount} attachments`];
  if (r.mediaFileCount !== undefined) parts.push(`${r.mediaFileCount} media files`);
  if (r.warningCount > 0) parts.push(`${r.warningCount} warnings`);
  return parts.join(', ');
}

/** Status label of a run, "deleted" for a removed archive. Pure. */
export function runStatusLabel(r: AdminBackupRun): string {
  if (r.deletedAt) return `${r.status} (deleted)`;
  return r.status;
}

export function isRunSettled(r: Pick<AdminBackupRun, 'status'>): boolean {
  return r.status !== 'running';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The message to show for a failed admin backups call. 403 always gets the
 * administrator message; 409 on POST /run gets the "already running" text. Pure.
 */
export function adminBackupErrorMessage(status: number, apiMessage: string, op?: 'run' | 'delete' | 'download'): string {
  if (status === 403) return ADMIN_REQUIRED_MESSAGE;
  if (status === 409 && op === 'run') return RUN_ALREADY_RUNNING_MESSAGE;
  if (status === 409 && op === 'delete') return `${apiMessage}. Wait for it to finish, then try again.`;
  if (status === 404 && (op === 'download' || op === 'delete')) return `${apiMessage} (check the id with: vault admin backups list)`;
  return apiMessage;
}

// ---------------------------------------------------------------------------
// Download naming
// ---------------------------------------------------------------------------

/** The API's file name reduced to a safe basename (no folders, no control characters). Pure. */
export function safeDownloadName(fileName: string | undefined, fallback = 'vault-backup.zip'): string {
  // eslint-disable-next-line no-control-regex
  const base = basename(String(fileName ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base || base === '.' || base === '..') return fallback;
  return base;
}

export interface DownloadTargetInput {
  /** `-o` as typed (a file, or a folder), undefined for the default. */
  output?: string;
  /** The API's `fileName`. */
  fileName: string;
  /** Folder a relative path is resolved against. */
  cwd: string;
  homeDir: string;
  /** Whether a path is an existing directory (injected). */
  isDirectory: (path: string) => boolean;
  /** Path join/resolve (injected for testability; defaults to path.join semantics). */
  resolve: (...parts: string[]) => string;
}

/**
 * Where to save a download before collision handling: `-o` as a file, or the
 * API's name inside `-o` when it is a folder (existing, or ending in a
 * separator), or the API's name in the current folder. `~` expands. Collisions
 * are resolved when the finished `.partial` is moved into place
 * (`commitPartial`: -1, -2 ... unless overwrite). Pure.
 */
export function downloadTarget(input: DownloadTargetInput): string {
  const name = safeDownloadName(input.fileName);
  if (input.output === undefined || input.output.trim() === '') return input.resolve(input.cwd, name);
  let out = input.output;
  if (out === '~' || /^~[\\/]/.test(out)) out = input.homeDir + out.slice(1);
  const abs = input.resolve(input.cwd, out);
  if (/[\\/]$/.test(out) || input.isDirectory(abs)) return join(abs, name);
  return abs;
}

// ---------------------------------------------------------------------------
// Menu visibility
// ---------------------------------------------------------------------------

/** What the menu knows about the signed-in user. */
export type MenuUserState =
  | { kind: 'signed-out' }
  /** `/auth/me` failed (network, server down): we cannot tell. */
  | { kind: 'unknown' }
  | { kind: 'signed-in'; permissions?: readonly string[] };

/**
 * Show "Admin backups" only to a user with `system_settings:read`. When the
 * server does not report permissions (or /auth/me failed while a token is
 * stored), show it and let a 403 explain. Hidden when signed out. Pure.
 */
export function showAdminBackupsEntry(state: MenuUserState): boolean {
  if (state.kind === 'signed-out') return false;
  if (state.kind === 'unknown') return true;
  if (!Array.isArray(state.permissions)) return true;
  return state.permissions.includes(SYSTEM_SETTINGS_READ);
}

/** The local IANA time zone (wizard default), "UTC" when unknown. */
export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Interval after which `run --wait` and the TUI poll a running backup. */
export const RUN_POLL_INTERVAL_MS = 5_000;
