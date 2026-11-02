import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { commitPartial } from '../lib/backup-runner.js';

import {
  ADMIN_REQUIRED_MESSAGE,
  ENABLE_WITHOUT_PASSWORD_MESSAGE,
  ENABLE_WITHOUT_STORAGE_MESSAGE,
  NOTHING_SELECTED_MESSAGE,
  RUN_ALREADY_RUNNING_MESSAGE,
  adminBackupErrorMessage,
  adminContentKeys,
  describeAdminContents,
  describeRunContents,
  describeRunCounts,
  describeSchedule,
  downloadTarget,
  formatWhen,
  hasScheduleFlags,
  mergeScheduleFlags,
  parseAdminContentsOption,
  parseDayOfWeek,
  parseTimeOfDayFlag,
  safeDownloadName,
  scheduleContents,
  scheduleDetails,
  scheduleToBody,
  shouldWarnSchedulePassword,
  showAdminBackupsEntry,
  validateScheduleBody,
  type AdminBackupRun,
  type AdminBackupSchedule,
  type AdminBackupScheduleBody,
} from '../lib/admin-backups.js';
import {
  adminContentChoices,
  buildWizardBody,
  deletableRuns,
  downloadableRuns,
  mainMenuChoices,
  runChoiceLabel,
  validateAdminContentSelection,
  wizardSummaryLines,
} from '../interactive/admin-backups-logic.js';

const SCHEDULE: AdminBackupSchedule = {
  enabled: false,
  frequency: 'daily',
  intervalHours: null,
  timeOfDay: '03:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'UTC',
  keepCount: 7,
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  includeSystem: false,
  passwordConfigured: false,
  passwordUpdatedAt: null,
  nextRunAt: null,
  lastRunAt: null,
  storageConfigured: true,
  updatedAt: null,
};
const BODY: AdminBackupScheduleBody = scheduleToBody(SCHEDULE);
const OK_CTX = { passwordConfigured: true, storageConfigured: true };

const RUN: AdminBackupRun = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'succeeded',
  trigger: 'manual',
  triggeredBy: { id: 'u1', email: 'person.a@example.test', displayName: 'Person A' },
  sizeBytes: 2048,
  userCount: 3,
  secretCount: 42,
  attachmentCount: 5,
  mediaFileCount: 2,
  warningCount: 0,
  contents: ['secrets', 'attachments', 'system'],
  error: null,
  startedAt: '2026-11-02T03:00:00.000Z',
  finishedAt: '2026-11-02T03:01:00.000Z',
  deletedAt: null,
  downloadable: true,
};

// ---------------------------------------------------------------------------
describe('scheduleToBody', () => {
  test('copies the editable fields and drops server-only ones', () => {
    assert.deepEqual(Object.keys(BODY).sort(), [
      'dayOfMonth', 'dayOfWeek', 'enabled', 'frequency', 'includeAttachments', 'includeMedia', 'includeSecrets',
      'includeSystem', 'includeVersions', 'intervalHours', 'keepCount', 'timeOfDay', 'timezone',
    ]);
    assert.equal('password' in BODY, false);
  });
  test('fills include flags an older server does not send', () => {
    const { includeSecrets, includeMedia, includeSystem, ...old } = SCHEDULE;
    void includeSecrets; void includeMedia; void includeSystem;
    const body = scheduleToBody(old as AdminBackupSchedule);
    assert.equal(body.includeSecrets, true);
    assert.equal(body.includeMedia, false);
    assert.equal(body.includeSystem, false);
  });
});

describe('mergeScheduleFlags', () => {
  test('no flags keeps the current body', () => {
    assert.deepEqual(mergeScheduleFlags(BODY, {}), BODY);
    assert.equal(hasScheduleFlags({}), false);
    assert.equal(hasScheduleFlags({ enabled: false }), true);
  });
  test('enable/disable, keep, timezone, time', () => {
    const b = mergeScheduleFlags(BODY, { enabled: true, keep: '14', timezone: ' America/Chicago ', at: '4:30' });
    assert.equal(b.enabled, true);
    assert.equal(b.keepCount, 14);
    assert.equal(b.timezone, 'America/Chicago');
    assert.equal(b.timeOfDay, '04:30');
  });
  test('switching frequency sets the needed field and clears the others', () => {
    const weekly = mergeScheduleFlags({ ...BODY, intervalHours: 6 }, { frequency: 'weekly', day: 'Mon' });
    assert.equal(weekly.frequency, 'weekly');
    assert.equal(weekly.dayOfWeek, 1);
    assert.equal(weekly.intervalHours, null);
    assert.equal(weekly.dayOfMonth, null);

    const hourly = mergeScheduleFlags(weekly, { frequency: 'HOURLY', every: '6' });
    assert.equal(hourly.intervalHours, 6);
    assert.equal(hourly.dayOfWeek, null);

    const monthly = mergeScheduleFlags(BODY, { frequency: 'monthly', dayOfMonth: '15' });
    assert.equal(monthly.dayOfMonth, 15);
  });
  test('a frequency field without that frequency is an error', () => {
    assert.throws(() => mergeScheduleFlags(BODY, { every: '6' }), /--every applies only to an hourly/);
    assert.throws(() => mergeScheduleFlags(BODY, { day: 'mon' }), /--day applies only to a weekly/);
    assert.throws(() => mergeScheduleFlags(BODY, { dayOfMonth: '3' }), /--day-of-month applies only to a monthly/);
    assert.throws(() => mergeScheduleFlags({ ...BODY, frequency: 'hourly', intervalHours: 1 }, { at: '03:00' }), /--at does not apply/);
  });
  test('malformed values are rejected', () => {
    assert.throws(() => mergeScheduleFlags(BODY, { frequency: 'yearly' }), /--frequency must be one of/);
    assert.throws(() => mergeScheduleFlags(BODY, { keep: 'ten' }), /--keep must be a whole number/);
    assert.throws(() => mergeScheduleFlags(BODY, { at: '25:00' }), /--at must be HH:mm/);
  });
  test('--contents sets all five flags and overrides individual flags', () => {
    const b = mergeScheduleFlags(BODY, { contents: 'media, SYSTEM', secrets: true, attachments: true });
    assert.deepEqual(adminContentKeys(b), ['media', 'system']);
    assert.equal(b.includeAttachments, false);
  });
  test('individual content flags', () => {
    const b = mergeScheduleFlags(BODY, { media: true, system: true, includeVersions: true });
    assert.deepEqual(adminContentKeys(b), ['secrets', 'attachments', 'versions', 'media', 'system']);
  });
  test('--no-secrets drops saved attachments/versions but rejects them as flags', () => {
    const b = mergeScheduleFlags({ ...BODY, includeVersions: true }, { secrets: false, media: true });
    assert.equal(b.includeAttachments, false);
    assert.equal(b.includeVersions, false);
    assert.throws(() => mergeScheduleFlags(BODY, { secrets: false, attachments: true }), /--attachments require secrets/);
  });
  test('never carries a password over', () => {
    assert.equal('password' in mergeScheduleFlags({ ...BODY, password: 'secret words' }, {}), false);
  });
  test('unknown --contents key lists the valid ones', () => {
    assert.throws(() => parseAdminContentsOption('secrets,logs'), /Unknown --contents value\(s\): logs\. Valid values: secrets, attachments, versions, media, system/);
    assert.throws(() => parseAdminContentsOption(' , '), /needs a comma-separated list/);
  });
});

describe('flag value parsers', () => {
  test('parseDayOfWeek', () => {
    assert.equal(parseDayOfWeek('sun'), 0);
    assert.equal(parseDayOfWeek('Saturday'), 6);
    assert.equal(parseDayOfWeek('3'), 3);
    for (const bad of ['7', 'mo', 'funday', '-1']) assert.throws(() => parseDayOfWeek(bad), /--day must be/);
  });
  test('parseTimeOfDayFlag', () => {
    assert.equal(parseTimeOfDayFlag('03:00'), '03:00');
    assert.equal(parseTimeOfDayFlag('9:05'), '09:05');
    for (const bad of ['24:00', '3', '03:60', '0300']) assert.throws(() => parseTimeOfDayFlag(bad));
  });
});

// ---------------------------------------------------------------------------
describe('validateScheduleBody (same rules as the API)', () => {
  test('a default body is valid', () => {
    assert.deepEqual(validateScheduleBody(BODY, OK_CTX), []);
  });
  test('field rules', () => {
    const cases: [Partial<AdminBackupScheduleBody>, RegExp][] = [
      [{ timeOfDay: '3:00' }, /timeOfDay must be HH:mm/],
      [{ timezone: 'Mars/Olympus' }, /valid IANA time zone/],
      [{ keepCount: 0 }, /keepCount must be at least 1/],
      [{ keepCount: 366 }, /keepCount must be at most 365/],
      [{ keepCount: 1.5 }, /keepCount must be an integer/],
      [{ frequency: 'hourly', intervalHours: 5 }, /must be one of 1, 2, 3, 4, 6, 8, 12 for an hourly/],
      [{ frequency: 'hourly', intervalHours: null }, /for an hourly/],
      [{ frequency: 'weekly', dayOfWeek: null }, /0 \(Sunday\) to 6 for a weekly/],
      [{ frequency: 'weekly', dayOfWeek: 7 }, /for a weekly/],
      [{ frequency: 'monthly', dayOfMonth: 29 }, /1 to 28 for a monthly/],
      [{ frequency: 'monthly', dayOfMonth: 0 }, /1 to 28 for a monthly/],
      [{ password: 'short' }, /at least 6 characters/],
      [{ password: 'x'.repeat(257) }, /at most 256 characters/],
    ];
    for (const [patch, re] of cases) {
      const errors = validateScheduleBody({ ...BODY, ...patch }, OK_CTX);
      assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(patch)} -> ${JSON.stringify(errors)}`);
    }
  });
  test('valid per-frequency bodies', () => {
    assert.deepEqual(validateScheduleBody({ ...BODY, frequency: 'hourly', intervalHours: 12 }, OK_CTX), []);
    assert.deepEqual(validateScheduleBody({ ...BODY, frequency: 'weekly', dayOfWeek: 0 }, OK_CTX), []);
    assert.deepEqual(validateScheduleBody({ ...BODY, frequency: 'monthly', dayOfMonth: 28 }, OK_CTX), []);
  });
  test('contents rules', () => {
    const none = { ...BODY, includeSecrets: false, includeAttachments: false, includeVersions: false };
    assert.deepEqual(validateScheduleBody(none, OK_CTX), [NOTHING_SELECTED_MESSAGE]);
    assert.deepEqual(validateScheduleBody({ ...none, includeSystem: true }, OK_CTX), []);
    assert.deepEqual(validateScheduleBody({ ...none, includeMedia: true }, OK_CTX), []);
    const orphan = validateScheduleBody({ ...none, includeMedia: true, includeAttachments: true }, OK_CTX);
    assert.match(orphan[0], /require secrets/);
  });
  test('enabling needs a password (stored or given) and storage', () => {
    const on = { ...BODY, enabled: true };
    assert.deepEqual(validateScheduleBody(on, { passwordConfigured: false, storageConfigured: true }), [ENABLE_WITHOUT_PASSWORD_MESSAGE]);
    assert.deepEqual(validateScheduleBody({ ...on, password: 'blue tiger river' }, { passwordConfigured: false, storageConfigured: true }), []);
    assert.deepEqual(validateScheduleBody(on, { passwordConfigured: true, storageConfigured: false }), [ENABLE_WITHOUT_STORAGE_MESSAGE]);
    // Disabled: neither is needed.
    assert.deepEqual(validateScheduleBody(BODY, { passwordConfigured: false, storageConfigured: false }), []);
  });
  test('soft password warning', () => {
    assert.equal(shouldWarnSchedulePassword(''), false);
    assert.equal(shouldWarnSchedulePassword('abcdefgh'), true);
    assert.equal(shouldWarnSchedulePassword('averyveryverylongword'), true);
    assert.equal(shouldWarnSchedulePassword('blue tiger river'), false);
  });
});

// ---------------------------------------------------------------------------
describe('schedule summary text', () => {
  test('the example from the spec', () => {
    assert.equal(
      describeSchedule({ ...BODY, timezone: 'America/Chicago' }),
      'Every day at 03:00 (America/Chicago) · keeps 7 · Secrets with attachments',
    );
  });
  test('each frequency', () => {
    assert.equal(describeSchedule({ ...BODY, frequency: 'hourly', intervalHours: 1 }), 'Every hour (UTC) · keeps 7 · Secrets with attachments');
    assert.equal(describeSchedule({ ...BODY, frequency: 'hourly', intervalHours: 6 }), 'Every 6 hours (UTC) · keeps 7 · Secrets with attachments');
    assert.equal(describeSchedule({ ...BODY, frequency: 'weekly', dayOfWeek: 1, timeOfDay: '02:30' }), 'Every Monday at 02:30 (UTC) · keeps 7 · Secrets with attachments');
    assert.equal(describeSchedule({ ...BODY, frequency: 'monthly', dayOfMonth: 15 }), 'Monthly on day 15 at 03:00 (UTC) · keeps 7 · Secrets with attachments');
  });
  test('contents wording', () => {
    const c = (patch: object) => describeAdminContents({ ...scheduleContents(BODY), ...patch });
    assert.equal(c({}), 'Secrets with attachments');
    assert.equal(c({ includeAttachments: false }), 'Secrets only');
    assert.equal(c({ includeVersions: true }), 'Secrets with attachments and old versions');
    assert.equal(c({ includeAttachments: false, includeMedia: true, includeSystem: true }), 'Secrets, media library, system configuration');
    assert.equal(c({ includeSecrets: false, includeAttachments: false, includeSystem: true }), 'System configuration');
    assert.equal(c({ includeSecrets: false, includeAttachments: false }), 'Nothing selected');
  });
  test('schedule details: status, next and last run, password, storage', () => {
    const d = Object.fromEntries(
      scheduleDetails(
        { ...SCHEDULE, enabled: true, nextRunAt: '2026-11-03T03:00:00.000Z', passwordConfigured: true, passwordUpdatedAt: '2026-11-01T10:00:00.000Z', storageConfigured: false },
        'UTC',
      ),
    );
    assert.equal(d.Status, 'Enabled');
    assert.equal(d['Next run'], '2026-11-03 03:00');
    assert.equal(d['Last run'], '-');
    assert.equal(d.Password, 'set on 2026-11-01 10:00');
    assert.equal(d.Storage, 'not configured');
    const off = Object.fromEntries(scheduleDetails(SCHEDULE, 'UTC'));
    assert.equal(off.Status, 'Disabled');
    assert.equal(off['Next run'], '- (disabled)');
    assert.equal(off.Password, 'not set');
  });
  test('formatWhen honours the time zone', () => {
    assert.equal(formatWhen('2026-11-02T03:00:00.000Z', 'America/Chicago'), '2026-11-01 21:00'); // CST, UTC-6
    assert.equal(formatWhen('2026-07-02T03:00:00.000Z', 'America/Chicago'), '2026-07-01 22:00'); // CDT, UTC-5
    assert.equal(formatWhen(null), '-');
  });
  test('run counts and contents', () => {
    assert.equal(describeRunCounts(RUN), '3 users, 42 secrets, 5 attachments, 2 media files');
    assert.equal(describeRunCounts({ ...RUN, mediaFileCount: undefined, warningCount: 1 }), '3 users, 42 secrets, 5 attachments, 1 warnings');
    assert.equal(describeRunContents(RUN.contents), 'Secrets, Attachments, System');
    assert.equal(describeRunContents(undefined), '-');
  });
});

// ---------------------------------------------------------------------------
describe('download file naming', () => {
  const base = {
    fileName: 'vault-backup-2026-11-02_030000.zip',
    cwd: '/work',
    homeDir: '/home/me',
    resolve: (...p: string[]) => join(...(p[1]?.startsWith('/') ? p.slice(1) : p)),
  };
  const dirs = new Set(['/work/out', '/home/me/bk']);
  const isDirectory = (p: string) => dirs.has(p);

  test('default: the API name in the current folder', () => {
    assert.equal(downloadTarget({ ...base, isDirectory }), '/work/vault-backup-2026-11-02_030000.zip');
  });
  test('-o as an existing folder, a folder with a trailing slash, or ~', () => {
    assert.equal(downloadTarget({ ...base, output: 'out', isDirectory }), '/work/out/vault-backup-2026-11-02_030000.zip');
    assert.equal(downloadTarget({ ...base, output: 'new/', isDirectory }), '/work/new/vault-backup-2026-11-02_030000.zip');
    assert.equal(downloadTarget({ ...base, output: '~/bk', isDirectory }), '/home/me/bk/vault-backup-2026-11-02_030000.zip');
  });
  test('-o as a file', () => {
    assert.equal(downloadTarget({ ...base, output: '/tmp/x.zip', isDirectory }), '/tmp/x.zip');
    assert.equal(downloadTarget({ ...base, output: 'x.zip', isDirectory }), '/work/x.zip');
  });
  test('the API name can never escape the folder', () => {
    assert.equal(safeDownloadName('../../etc/passwd'), 'passwd');
    assert.equal(safeDownloadName('a\\b\\c.zip'), 'c.zip');
    assert.equal(safeDownloadName(''), 'vault-backup.zip');
    assert.equal(safeDownloadName('..'), 'vault-backup.zip');
    assert.equal(safeDownloadName('bad\u0000\nname.zip'), 'badname.zip');
  });
  test('collisions get -1, -2 ... unless --overwrite (the .partial is moved into place)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vaultcli-admin-dl-'));
    try {
      const target = join(dir, 'a.zip');
      writeFileSync(target, 'old');
      writeFileSync(join(dir, 'a-1.zip'), 'old1');
      const put = async (content: string, overwrite: boolean) => {
        const partial = `${target}.partial`;
        writeFileSync(partial, content, { mode: 0o600 });
        const path = await commitPartial(partial, target, overwrite);
        assert.equal(existsSync(partial), false, 'partial is gone');
        return path;
      };
      assert.equal(await put('new', false), join(dir, 'a-2.zip'));
      assert.equal(readFileSync(target, 'utf-8'), 'old');
      assert.equal(await put('newer', false), join(dir, 'a-3.zip'));
      assert.equal(await put('replaced', true), target);
      assert.equal(readFileSync(target, 'utf-8'), 'replaced');
      assert.equal(statSync(target).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
describe('menu visibility', () => {
  test('showAdminBackupsEntry', () => {
    assert.equal(showAdminBackupsEntry({ kind: 'signed-out' }), false);
    assert.equal(showAdminBackupsEntry({ kind: 'signed-in', permissions: ['user_settings:read'] }), false);
    assert.equal(showAdminBackupsEntry({ kind: 'signed-in', permissions: ['system_settings:read'] }), true);
    assert.equal(showAdminBackupsEntry({ kind: 'signed-in', permissions: ['system_settings:write'] }), false);
    // Permissions unknown: show it and let a 403 explain.
    assert.equal(showAdminBackupsEntry({ kind: 'signed-in' }), true);
    assert.equal(showAdminBackupsEntry({ kind: 'unknown' }), true);
  });
  test('mainMenuChoices places the entry after Backups', () => {
    const admin = mainMenuChoices({ kind: 'signed-in', permissions: ['system_settings:read'] }).map((c) => c.value);
    assert.deepEqual(admin, ['backups', 'admin-backups', 'auth', 'exit']);
    const viewer = mainMenuChoices({ kind: 'signed-in', permissions: [] }).map((c) => c.value);
    assert.deepEqual(viewer, ['backups', 'auth', 'exit']);
  });
});

describe('error messages', () => {
  test('403 always gets the administrator message', () => {
    assert.equal(adminBackupErrorMessage(403, 'Forbidden'), ADMIN_REQUIRED_MESSAGE);
    assert.equal(adminBackupErrorMessage(403, 'Forbidden', 'run'), ADMIN_REQUIRED_MESSAGE);
  });
  test('409 on run, and the API message for 400', () => {
    assert.equal(adminBackupErrorMessage(409, 'A backup is already running', 'run'), RUN_ALREADY_RUNNING_MESSAGE);
    assert.equal(adminBackupErrorMessage(400, 'keepCount must be at most 365'), 'keepCount must be at most 365');
    assert.match(adminBackupErrorMessage(409, 'A running backup cannot be deleted', 'delete'), /Wait for it to finish/);
  });
});

// ---------------------------------------------------------------------------
describe('TUI wizard helpers', () => {
  test('content checkbox has the five choices, default secrets + attachments', () => {
    const choices = adminContentChoices(scheduleContents({}));
    assert.deepEqual(choices.map((c) => c.value), ['secrets', 'attachments', 'versions', 'media', 'system']);
    assert.deepEqual(choices.filter((c) => c.checked).map((c) => c.value), ['secrets', 'attachments']);
    assert.match(choices[4].name, /System configuration/);
  });
  test('content selection validator', () => {
    assert.equal(validateAdminContentSelection(['system']), true);
    assert.equal(validateAdminContentSelection([]), NOTHING_SELECTED_MESSAGE);
    assert.match(String(validateAdminContentSelection(['media', 'versions'])), /require secrets/);
  });
  test('buildWizardBody keeps only the fields the frequency needs', () => {
    const b = buildWizardBody(BODY, {
      frequency: 'weekly', dayOfWeek: 5, timeOfDay: '01:15', timezone: 'Europe/Madrid', keepCount: 30,
      contents: ['secrets', 'system'], enabled: true, password: 'blue tiger river',
    });
    assert.equal(b.dayOfWeek, 5);
    assert.equal(b.dayOfMonth, null);
    assert.equal(b.intervalHours, null);
    assert.equal(b.timeOfDay, '01:15');
    assert.equal(b.includeAttachments, false);
    assert.equal(b.includeSystem, true);
    assert.equal(b.password, 'blue tiger river');
    const h = buildWizardBody({ ...BODY, password: 'stale' } as AdminBackupScheduleBody, {
      frequency: 'hourly', intervalHours: 4, timezone: 'UTC', keepCount: 7, contents: ['secrets'], enabled: false,
    });
    assert.equal(h.intervalHours, 4);
    assert.equal(h.timeOfDay, '03:00');
    assert.equal('password' in h, false);
  });
  test('summary lines never show the password', () => {
    const body = { ...BODY, password: 'blue tiger river' };
    const lines = wizardSummaryLines(body, 'set', null);
    assert.ok(lines.every((l) => !l.includes('tiger')));
    assert.match(lines[0], /^Schedule: Every day at 03:00 \(UTC\)/);
    assert.match(wizardSummaryLines(BODY, 'keep', '2026-11-01T10:00:00.000Z')[2], /keep the current one/);
  });
  test('pick lists', () => {
    const running = { ...RUN, id: 'r', status: 'running' as const, downloadable: false };
    const deleted = { ...RUN, id: 'd', deletedAt: '2026-11-02T04:00:00.000Z', downloadable: false };
    const failed = { ...RUN, id: 'f', status: 'failed' as const, downloadable: false };
    assert.deepEqual(downloadableRuns([RUN, running, deleted, failed]).map((r) => r.id), [RUN.id]);
    assert.deepEqual(deletableRuns([RUN, running, deleted, failed]).map((r) => r.id), [RUN.id, 'f']);
    assert.match(runChoiceLabel(RUN, (n) => `${n} B`), /· manual · succeeded · 2048 B$/);
  });
});
