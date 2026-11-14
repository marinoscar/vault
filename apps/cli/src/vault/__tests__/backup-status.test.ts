import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BLOCK_BEGIN, BLOCK_END, type CrontabRunner, type PreflightIssue } from '../lib/backup-schedule.js';
import {
  RUN_RECORD_TYPE,
  ago,
  appendRunRecord,
  collectBackupStatus,
  ensureLogFile,
  formatDuration,
  inTime,
  makeRunRecord,
  parseBackupLog,
  readLogTail,
  relevantIssues,
  summarizeFiles,
  summarizeRuns,
  type BackupRunRecord,
} from '../lib/backup-status.js';

const T0 = new Date('2026-03-10T02:30:00.000Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);

function rec(at: string, outcome: 'success' | 'failure', extra: Partial<BackupRunRecord> = {}): BackupRunRecord {
  return { type: RUN_RECORD_TYPE, v: 1, at, startedAt: at, durationMs: 1000, trigger: 'schedule', outcome, ...extra };
}

describe('run records', () => {
  it('records a success with timing and no password', () => {
    const r = makeRunRecord({
      startedAt: T0,
      finishedAt: plus(4200),
      trigger: 'schedule',
      outcome: 'success',
      path: '/home/person-a/vault-backups/vault-backup-2026-03-10_023000.zip',
      size: 2048,
      contents: ['secrets', 'attachments'],
      retentionDeleted: 2,
    });
    expect(r).toEqual({
      type: 'vault.backup.run',
      v: 1,
      at: '2026-03-10T02:30:04.200Z',
      startedAt: '2026-03-10T02:30:00.000Z',
      durationMs: 4200,
      trigger: 'schedule',
      outcome: 'success',
      path: '/home/person-a/vault-backups/vault-backup-2026-03-10_023000.zip',
      size: 2048,
      contents: ['secrets', 'attachments'],
      retentionDeleted: 2,
    });
    expect(Object.keys(r)).not.toContain('password');
  });

  it('keeps a failure message to one line', () => {
    const r = makeRunRecord({ startedAt: T0, finishedAt: T0, trigger: 'cli', outcome: 'failure', error: `line one\nline two ${'x'.repeat(600)}` });
    expect(r.error).not.toContain('\n');
    expect(r.error!.length).toBe(500);
    expect(r.durationMs).toBe(0);
  });
});

describe('parseBackupLog', () => {
  it('reads records, skipping the --json envelopes, stderr noise and broken lines', () => {
    const text = [
      JSON.stringify(rec('2026-03-11T02:30:00.000Z', 'failure', { error: 'Cannot read password file' })),
      '{"success":true,"data":{"backup":{"path":"/x.zip"}}}',
      '(node:123) ExperimentalWarning: something',
      JSON.stringify(rec('2026-03-10T02:30:00.000Z', 'success', { size: 10 })),
      '{"type":"vault.backup.run","v":1,"at":"2026-03-12T0',
      JSON.stringify({ type: RUN_RECORD_TYPE, at: 'not a date', outcome: 'success' }),
      '',
    ].join('\n');
    const runs = parseBackupLog(text);
    expect(runs.map((r) => r.at)).toEqual(['2026-03-10T02:30:00.000Z', '2026-03-11T02:30:00.000Z']);
  });

  it('is empty for an empty log', () => {
    expect(parseBackupLog('')).toEqual([]);
  });
});

describe('summarizeRuns', () => {
  it('finds the last run, last success, last failure and the failure streak', () => {
    const runs = [
      rec('2026-03-08T02:30:00.000Z', 'failure'),
      rec('2026-03-09T02:30:00.000Z', 'success'),
      rec('2026-03-10T02:30:00.000Z', 'failure', { error: 'a' }),
      rec('2026-03-11T02:30:00.000Z', 'failure', { error: 'b' }),
    ];
    const s = summarizeRuns(runs, 3);
    expect(s.total).toBe(4);
    expect(s.recent.map((r) => r.at)).toEqual(['2026-03-11T02:30:00.000Z', '2026-03-10T02:30:00.000Z', '2026-03-09T02:30:00.000Z']);
    expect(s.last?.error).toBe('b');
    expect(s.lastSuccess?.at).toBe('2026-03-09T02:30:00.000Z');
    expect(s.lastFailure?.error).toBe('b');
    expect(s.consecutiveFailures).toBe(2);
  });

  it('has no streak after a success and nothing for no runs', () => {
    expect(summarizeRuns([rec('2026-03-08T00:00:00.000Z', 'failure'), rec('2026-03-09T00:00:00.000Z', 'success')]).consecutiveFailures).toBe(0);
    expect(summarizeRuns([])).toEqual({ total: 0, recent: [], consecutiveFailures: 0 });
  });
});

describe('summarizeFiles and relevantIssues', () => {
  it('counts, sums and finds the newest and oldest', () => {
    const files = [
      { path: '/b/2.zip', mtimeMs: 2000, size: 20 },
      { path: '/b/1.zip', mtimeMs: 1000, size: 10 },
      { path: '/b/3.zip', mtimeMs: 3000, size: 30 },
    ];
    const s = summarizeFiles('/b', files, [files[1]!], true);
    expect(s).toMatchObject({ root: '/b', count: 3, totalBytes: 60, retentionOn: true });
    expect(s.newest?.path).toBe('/b/3.zip');
    expect(s.oldest?.path).toBe('/b/1.zip');
    expect(s.retentionWouldDelete).toEqual([{ path: '/b/1.zip', size: 10, mtimeMs: 1000 }]);
  });

  it('drops unattended-only issues when nothing is scheduled', () => {
    const issues: PreflightIssue[] = [
      { level: 'error', scope: 'schedule', message: 'cron cannot ask' },
      { level: 'error', scope: 'always', message: 'token expired' },
    ];
    expect(relevantIssues(issues, true)).toHaveLength(2);
    expect(relevantIssues(issues, false).map((i) => i.message)).toEqual(['token expired']);
  });
});

describe('time helpers', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');
  it('formats ages, countdowns and durations', () => {
    expect(ago('2026-03-10T11:59:30.000Z', now)).toBe('just now');
    expect(ago('2026-03-10T09:00:00.000Z', now)).toBe('3h ago');
    expect(ago('2026-03-08T08:00:00.000Z', now)).toBe('2d 4h ago');
    expect(ago(undefined, now)).toBe('-');
    expect(inTime(new Date('2026-03-10T14:30:00.000Z'), now)).toBe('in 2h');
    expect(inTime('2026-03-10T12:00:10.000Z', now)).toBe('in <1m');
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(184_000)).toBe('3m 04s');
  });
});

describe('the log file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-status-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends one line per run and creates the file 0600', () => {
    const file = join(dir, 'state', 'backup.log');
    expect(appendRunRecord(rec('2026-03-10T02:30:00.000Z', 'success'), file)).toBe(true);
    expect(appendRunRecord(rec('2026-03-11T02:30:00.000Z', 'failure'), file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(parseBackupLog(readLogTail(file))).toHaveLength(2);
  });

  it('never throws when the log cannot be written', () => {
    writeFileSync(join(dir, 'blocker'), 'a file, not a folder');
    expect(appendRunRecord(rec('2026-03-10T02:30:00.000Z', 'success'), join(dir, 'blocker', 'backup.log'))).toBe(false);
  });

  it('creates an empty 0600 log before cron would', () => {
    const file = join(dir, 'backup.log');
    ensureLogFile(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('');
  });

  it('reads only the tail of a large log, dropping the cut line', () => {
    const file = join(dir, 'backup.log');
    const lines = Array.from({ length: 200 }, (_, i) => JSON.stringify(rec(new Date(T0.getTime() + i * 60_000).toISOString(), 'success')));
    writeFileSync(file, lines.join('\n') + '\n');
    const tail = readLogTail(file, 2000);
    const runs = parseBackupLog(tail);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThan(200);
    expect(runs[runs.length - 1]!.at).toBe(new Date(T0.getTime() + 199 * 60_000).toISOString());
    expect(readLogTail(join(dir, 'missing.log'))).toBe('');
  });
});

describe('collectBackupStatus', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-status-all-'));
    for (const k of ['HOME', 'VAULT_CONFIG_DIR', 'VAULT_TOKEN', 'VAULTCLI_CONFIG_DIR']) saved[k] = process.env[k];
    process.env.HOME = join(dir, 'home');
    process.env.VAULT_CONFIG_DIR = join(dir, 'state');
    delete process.env.VAULT_TOKEN;
    delete process.env.VAULTCLI_CONFIG_DIR;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('combines history, schedule, files, retention, token and issues', async () => {
    const state = join(dir, 'state');
    const backups = join(dir, 'backups');
    const home = join(dir, 'home');
    for (const d of [state, backups, join(home, '.vault')]) mkdirp(d);
    writeFileSync(join(state, 'backup-password'), 'correct horse\n', { mode: 0o600 });
    writeFileSync(
      join(state, 'backup.json'),
      JSON.stringify({ output: join(backups, 'vault-{datetime}.zip'), passwordFile: join(state, 'backup-password'), keepLast: 1 }),
    );
    writeFileSync(join(home, '.vault', 'config.json'), JSON.stringify({ serverUrl: 'https://vault.example.test', token: 'pat_aaaaaaaaaaaaaaaaaaaaaaaa', expiresAt: '2026-03-14T00:00:00.000Z' }));
    writeFileSync(join(backups, 'vault-2026-03-08_023000.zip'), 'old');
    writeFileSync(join(backups, 'vault-2026-03-09_023000.zip'), 'new!');
    utimesSync(join(backups, 'vault-2026-03-08_023000.zip'), new Date('2026-03-08T02:30:00Z'), new Date('2026-03-08T02:30:00Z'));
    utimesSync(join(backups, 'vault-2026-03-09_023000.zip'), new Date('2026-03-09T02:30:00Z'), new Date('2026-03-09T02:30:00Z'));
    appendRunRecord(rec('2026-03-09T02:30:00.000Z', 'success', { size: 4 }), join(state, 'backup.log'));
    appendRunRecord(rec('2026-03-10T02:30:00.000Z', 'failure', { error: 'cannot reach the server' }), join(state, 'backup.log'));

    const crontab = `${BLOCK_BEGIN}\n30 2 * * * true\n${BLOCK_END}\n`;
    const run: CrontabRunner = async () => ({ code: 0, stdout: crontab, stderr: '' });
    const status = await collectBackupStatus({ run, platform: 'linux', now: new Date('2026-03-10T12:00:00.000Z'), env: {} });

    expect(status.settingsSaved).toBe(true);
    expect(status.runs.consecutiveFailures).toBe(1);
    expect(status.runs.lastSuccess?.at).toBe('2026-03-09T02:30:00.000Z');
    expect(status.schedule.installed?.description).toBe('Every day at 02:30');
    expect(status.schedule.next).toHaveLength(3);
    expect(status.files).toMatchObject({ count: 2, totalBytes: 7, retentionOn: true });
    expect(status.files.retentionWouldDelete.map((f) => f.path)).toEqual([join(backups, 'vault-2026-03-08_023000.zip')]);
    expect(status.token).toMatchObject({ source: 'config', level: 'warning', expiresAt: '2026-03-14T00:00:00.000Z' });
    expect(status.issues[0]).toMatchObject({ level: 'error', message: expect.stringMatching(/last backup failed: cannot reach the server/) });
    expect(status.issues.some((i) => /expires in 3 day/.test(i.message))).toBe(true);
    expect(JSON.stringify(status)).not.toContain('correct horse');
    expect(JSON.stringify(status)).not.toContain('pat_aaaa');
  });

  it('reports a signed-out machine with nothing saved', async () => {
    const run: CrontabRunner = async () => ({ code: 1, stdout: '', stderr: 'no crontab for person-a' });
    const status = await collectBackupStatus({ run, platform: 'linux', now: new Date('2026-03-10T12:00:00.000Z'), env: {} });
    expect(status.settingsSaved).toBe(false);
    expect(status.runs.total).toBe(0);
    expect(status.schedule.installed).toBeNull();
    expect(status.token).toMatchObject({ source: undefined, text: 'not signed in' });
    expect(status.issues.map((i) => i.message)).toEqual([expect.stringMatching(/Not signed in/)]);
  });
});

function mkdirp(d: string): void {
  mkdirSync(d, { recursive: true });
}
