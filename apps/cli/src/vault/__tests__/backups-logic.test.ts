import { describe, expect, it } from 'vitest';

import type { AdminBackupRun } from '../lib/admin-backups.js';
import type { BackupRunRecord, BackupStatus } from '../lib/backup-status.js';
import {
  actionForKey,
  adminRunRow,
  applyProgress,
  cronFieldFeedback,
  dashboardActions,
  dashboardCards,
  fileRows,
  filesCard,
  finishProgress,
  footerHints,
  friendlyError,
  initialProgress,
  lastBackupCard,
  nextRunCard,
  progressBar,
  recentRunRows,
  schedulePreview,
  sortIssues,
  tokenCard,
  truncate,
  truncateMiddle,
} from '../tui/backups-logic.js';

const NOW = new Date('2026-03-10T12:00:00.000Z');

function run(at: string, outcome: 'success' | 'failure', extra: Partial<BackupRunRecord> = {}): BackupRunRecord {
  return { type: 'vault.backup.run', v: 1, at, startedAt: at, durationMs: 4200, trigger: 'schedule', outcome, ...extra };
}

function status(over: Partial<BackupStatus> = {}): BackupStatus {
  return {
    generatedAt: NOW.toISOString(),
    settingsFile: '/home/person-a/.vault/backup.json',
    settingsSaved: true,
    logFile: '/home/person-a/.vault/backup.log',
    runs: { total: 0, recent: [], consecutiveFailures: 0 },
    schedule: { supported: true, installed: null, next: [] },
    files: { root: '/b', count: 0, totalBytes: 0, retentionWouldDelete: [], retentionOn: false },
    token: { source: 'config', expiresAt: '2027-01-01T00:00:00.000Z', level: 'ok', text: 'in 297 days' },
    issues: [],
    ...over,
  };
}

describe('text helpers', () => {
  it('truncates at the end or in the middle', () => {
    expect(truncate('abcdef', 10)).toBe('abcdef');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 0)).toBe('');
    const p = truncateMiddle('/home/person-a/vault-backups/2026/03/vault-backup-2026-03-10_023000.zip', 30);
    expect(p).toHaveLength(30);
    expect(p).toContain('…');
    expect(p.endsWith('023000.zip')).toBe(true);
  });

  it('draws a progress bar, or a moving block when the size is unknown', () => {
    expect(progressBar(50, 100, 10)).toBe('█████░░░░░  50%');
    expect(progressBar(100, 100, 10)).toBe('██████████ 100%');
    const a = progressBar(10, null, 10, 0);
    const b = progressBar(10, null, 10, 3);
    expect(a).toHaveLength(10);
    expect(a).not.toBe(b);
  });

  it('names the server instead of "fetch failed"', () => {
    expect(friendlyError(new Error('Backup failed: fetch failed'), 'https://vault.example.test')).toBe(
      'Backup failed: cannot reach the server https://vault.example.test',
    );
    expect(friendlyError('other', 'x')).toBe('other');
  });
});

describe('dashboard cards', () => {
  it('shows a never-run machine in yellow', () => {
    expect(lastBackupCard(status(), NOW)).toMatchObject({ value: 'never', tone: 'yellow' });
  });

  it('shows the last success in green with its age and size', () => {
    const r = run('2026-03-10T09:00:00.000Z', 'success', { size: 2048 });
    const card = lastBackupCard(status({ runs: { total: 1, recent: [r], last: r, lastSuccess: r, consecutiveFailures: 0 } }), NOW);
    expect(card).toEqual({ title: 'Last backup', value: '✔ 3h ago', detail: '2.0 KB · schedule', tone: 'green' });
  });

  it('shows failures in red with the streak', () => {
    const ok = run('2026-03-08T02:30:00.000Z', 'success');
    const bad = run('2026-03-10T02:30:00.000Z', 'failure');
    const card = lastBackupCard(status({ runs: { total: 3, recent: [bad], last: bad, lastSuccess: ok, consecutiveFailures: 2 } }), NOW);
    expect(card).toMatchObject({ tone: 'red', detail: '2 failures in a row' });
    expect(card.value).toMatch(/failed 9h 30m ago|failed 9h ago/);
  });

  it('shows the next run, or "not scheduled" in yellow', () => {
    expect(nextRunCard(status(), NOW)).toMatchObject({ value: 'not scheduled', tone: 'yellow' });
    const installed = { cron: '30 2 * * *', command: 'x', line: '30 2 * * * x', description: 'Every day at 02:30' };
    const s = status({ schedule: { supported: true, installed, next: [new Date('2026-03-11T02:30:00.000Z')] } });
    expect(nextRunCard(s, NOW)).toMatchObject({ value: 'in 14h', detail: 'Every day at 02:30', tone: 'cyan' });
    expect(nextRunCard(status({ schedule: { supported: false, installed: null, next: [] } }), NOW)).toMatchObject({ value: 'manual' });
  });

  it('summarises files and what retention would prune', () => {
    const f = { path: '/b/a.zip', mtimeMs: NOW.getTime() - 3_600_000, size: 1024 };
    const card = filesCard(status({ files: { root: '/b', count: 3, totalBytes: 3072, newest: f, oldest: f, retentionWouldDelete: [f], retentionOn: true } }));
    expect(card).toMatchObject({ value: '3 · 3.0 KB', tone: 'cyan' });
    expect(card.detail).toBe('newest 1h ago · 1 to prune');
  });

  it('colours the token by its expiry', () => {
    expect(tokenCard(status())).toMatchObject({ value: '297 days', tone: 'green' });
    expect(tokenCard(status({ token: { source: undefined, level: 'expired', text: 'not signed in' } }))).toMatchObject({ value: 'signed out', tone: 'red' });
    expect(tokenCard(status({ token: { source: 'environment', level: 'unknown', text: 'from VAULT_TOKEN' } }))).toMatchObject({ tone: 'yellow' });
    expect(tokenCard(status({ token: { source: 'config', expiresAt: '2026-03-12T00:00:00Z', level: 'warning', text: 'in 1 day' } }))).toMatchObject({ tone: 'yellow' });
  });

  it('builds the four cards in order', () => {
    expect(dashboardCards(status(), NOW).map((c) => c.title)).toEqual(['Last backup', 'Next run', 'On disk', 'Token']);
  });

  it('lists recent runs with size and duration, or the error', () => {
    const rows = recentRunRows(
      [run('2026-03-10T02:30:00.000Z', 'failure', { error: 'Cannot read password file' }), run('2026-03-09T02:30:00.000Z', 'success', { size: 1024, retentionDeleted: 2 })],
      NOW,
    );
    expect(rows[0]).toMatchObject({ mark: '✖', tone: 'red', detail: 'Cannot read password file', trigger: 'schedule' });
    expect(rows[1]).toMatchObject({ mark: '✔', tone: 'green', detail: '1.0 KB in 4.2s · pruned 2' });
  });

  it('puts errors before warnings', () => {
    const sorted = sortIssues([
      { level: 'warning', scope: 'always', message: 'w' },
      { level: 'error', scope: 'always', message: 'e' },
    ]);
    expect(sorted.map((i) => i.message)).toEqual(['e', 'w']);
  });
});

describe('dashboard actions', () => {
  it('offers run and server backups only to a signed-in user who may see them', () => {
    const admin = dashboardActions({ signedIn: true, user: { kind: 'signed-in', permissions: ['system_settings:read'] } });
    expect(admin.map((a) => a.value)).toEqual(['run', 'setup', 'schedule', 'list', 'admin', 'refresh', 'back']);
    const member = dashboardActions({ signedIn: true, user: { kind: 'signed-in', permissions: ['secrets:read'] } });
    expect(member.map((a) => a.value)).not.toContain('admin');
    const out = dashboardActions({ signedIn: false, user: { kind: 'signed-out' } });
    expect(out.map((a) => a.value)).toEqual(['setup', 'schedule', 'list', 'refresh', 'back']);
  });

  it('maps hot keys, case-insensitively, to available actions only', () => {
    const items = dashboardActions({ signedIn: false, user: { kind: 'signed-out' } });
    expect(actionForKey('c', items)).toBe('schedule');
    expect(actionForKey('L', items)).toBe('list');
    expect(actionForKey('r', items)).toBeUndefined();
    expect(footerHints(items)).toEqual(['s setup', 'c schedule', 'l list', 'f refresh', 'q back']);
  });
});

describe('run progress', () => {
  it('walks through request, download, write and retention', () => {
    let p = initialProgress(true);
    expect(p).toMatchObject({ request: 'active', download: 'pending', retention: 'pending' });
    p = applyProgress(p, { phase: 'download', bytes: 10, total: 100 });
    expect(p).toMatchObject({ request: 'done', download: 'active', bytes: 10, total: 100 });
    p = applyProgress(p, { phase: 'write', bytes: 100 });
    expect(p).toMatchObject({ download: 'done', write: 'done' });
    p = applyProgress(p, { phase: 'retention' });
    expect(p.retention).toBe('active');
    expect(finishProgress(p, true)).toMatchObject({ request: 'done', download: 'done', write: 'done', retention: 'done' });
  });

  it('marks the active step failed and keeps retention skipped when off', () => {
    const p = applyProgress(initialProgress(false), { phase: 'download', bytes: 5, total: null });
    expect(finishProgress(p, false)).toMatchObject({ request: 'done', download: 'failed', write: 'pending', retention: 'skipped' });
    expect(applyProgress(initialProgress(false), { phase: 'retention' }).retention).toBe('skipped');
  });
});

describe('schedule screen', () => {
  it('gives live feedback on a cron field', () => {
    expect(cronFieldFeedback('', NOW)).toMatchObject({ ok: false });
    expect(cronFieldFeedback('61 * * * *', NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/minute/) });
    expect(cronFieldFeedback('0 */6 * * *', NOW)).toMatchObject({ ok: true, description: 'Every 6 hours' });
  });

  it('previews the exact line, the next three runs and whether issues block', () => {
    const p = schedulePreview({ kind: 'daily', hour: 2, minute: 30 }, "'/usr/bin/node' '/opt/vault/dist/cli.js' backup --json", [
      { level: 'warning', scope: 'schedule', message: 'w' },
      { level: 'error', scope: 'schedule', message: 'e' },
    ], NOW);
    expect(p.cron).toBe('30 2 * * *');
    expect(p.line).toBe("30 2 * * * '/usr/bin/node' '/opt/vault/dist/cli.js' backup --json");
    expect(p.next).toHaveLength(3);
    expect(p.description).toBe('Every day at 02:30');
    expect(p.blocking).toBe(true);
    expect(p.issues[0]!.level).toBe('error');
  });
});

describe('file list', () => {
  it('lists newest first, relative to the root, marking what retention deletes', () => {
    const files = [
      { path: '/b/2026/vault-1.zip', mtimeMs: NOW.getTime() - 2 * 86_400_000, size: 1024 },
      { path: '/b/2026/vault-2.zip', mtimeMs: NOW.getTime() - 3_600_000, size: 2048 },
    ];
    const rows = fileRows('/b', files, new Set(['/b/2026/vault-1.zip']), NOW.getTime());
    expect(rows).toEqual([
      { path: '/b/2026/vault-2.zip', name: '2026/vault-2.zip', size: '2.0 KB', age: '1h', doomed: false },
      { path: '/b/2026/vault-1.zip', name: '2026/vault-1.zip', size: '1.0 KB', age: '2d', doomed: true },
    ]);
  });
});

describe('server runs', () => {
  const base: AdminBackupRun = {
    id: 'run-1',
    status: 'succeeded',
    trigger: 'manual',
    triggeredBy: null,
    sizeBytes: 4096,
    userCount: 2,
    secretCount: 10,
    attachmentCount: 1,
    warningCount: 0,
    error: null,
    startedAt: '2026-03-10T02:30:00.000Z',
    finishedAt: '2026-03-10T02:31:00.000Z',
    deletedAt: null,
    downloadable: true,
  };
  it('colours a run by its status', () => {
    expect(adminRunRow(base)).toMatchObject({ status: 'succeeded', tone: 'green', size: '4.0 KB', counts: '2 users, 10 secrets, 1 attachments' });
    expect(adminRunRow({ ...base, status: 'failed', error: 'storage is not configured', sizeBytes: null })).toMatchObject({
      tone: 'red',
      size: '-',
      counts: 'storage is not configured',
    });
    expect(adminRunRow({ ...base, deletedAt: '2026-03-11T00:00:00.000Z' })).toMatchObject({ tone: 'gray', status: 'succeeded (deleted)' });
  });
});
