// =============================================================================
// Backup history (backup.log) and the "how are my backups doing" summary
// =============================================================================
//
// Every `vault backup` run (command line, scheduled, TUI) appends ONE JSON line
// to `<config dir>/backup.log` (mode 0600):
//
//   {"type":"vault.backup.run","v":1,"at":"…","startedAt":"…","durationMs":1234,
//    "trigger":"schedule","outcome":"success","path":"/…/vault-backup-….zip",
//    "size":12345,"contents":["secrets","attachments"],"retentionDeleted":2}
//
// A failure carries `"outcome":"failure","error":"…"` instead of the file. The
// password never appears in it. The scheduled job also redirects its `--json`
// output and stderr into the same file; those lines are not records and are
// skipped by the parser.
//
// `buildBackupStatus` combines the history, the crontab schedule, the files on
// disk, retention and the token into one summary (pure); `collectBackupStatus`
// gathers the inputs (I/O). `vault backup status` and the TUI dashboard use them.
// =============================================================================

import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import { getConfigDir, getStoredTokenMeta, getTokenSource, loadPlatformConfig } from '../utils/config.js';
import { formatAge, retentionEnabled } from './backup-retention.js';
import { formatBytes, planBackupRetention } from './backup-runner.js';
import {
  backupLogPathIn,
  buildCronCommand,
  getScheduleStatus,
  hasBlockingIssue,
  resolveCliEntry,
  schedulePreflight,
  type CrontabRunner,
  type PreflightInput,
  type PreflightIssue,
  type ScheduleStatus,
} from './backup-schedule.js';
import { getBackupSettingsPath, loadBackupSettings, resolveBackupSettings, type BackupSettings } from './backup-settings.js';
import { describeExpiry, type ExpiryLevel } from './tokens.js';

export const RUN_RECORD_TYPE = 'vault.backup.run';

export type RunTrigger = 'cli' | 'schedule' | 'tui';

export interface BackupRunRecord {
  type: typeof RUN_RECORD_TYPE;
  v: 1;
  /** When the run finished (ISO). */
  at: string;
  startedAt: string;
  durationMs: number;
  trigger: RunTrigger;
  outcome: 'success' | 'failure';
  path?: string;
  size?: number;
  contents?: string[];
  /** Files retention deleted after the backup (0 when off). */
  retentionDeleted?: number;
  error?: string;
}

export function getBackupLogPath(): string {
  return backupLogPathIn(getConfigDir());
}

/** Build a record. `error` messages are cut to one line of 500 characters. Pure. */
export function makeRunRecord(input: {
  startedAt: Date;
  finishedAt: Date;
  trigger: RunTrigger;
  outcome: 'success' | 'failure';
  path?: string;
  size?: number;
  contents?: string[];
  retentionDeleted?: number;
  error?: string;
}): BackupRunRecord {
  const rec: BackupRunRecord = {
    type: RUN_RECORD_TYPE,
    v: 1,
    at: input.finishedAt.toISOString(),
    startedAt: input.startedAt.toISOString(),
    durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    trigger: input.trigger,
    outcome: input.outcome,
  };
  if (input.path !== undefined) rec.path = input.path;
  if (input.size !== undefined) rec.size = input.size;
  if (input.contents !== undefined) rec.contents = input.contents;
  if (input.retentionDeleted !== undefined) rec.retentionDeleted = input.retentionDeleted;
  if (input.error !== undefined) rec.error = input.error.replace(/\s+/g, ' ').trim().slice(0, 500);
  return rec;
}

/**
 * Append a record to backup.log (created 0600). Never throws: a history that
 * cannot be written must not fail a backup.
 */
export function appendRunRecord(record: BackupRunRecord, file: string = getBackupLogPath()): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const existed = existsSync(file);
    appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
    if (!existed) chmodSync(file, 0o600);
    return true;
  } catch {
    return false;
  }
}

/** Create backup.log with mode 0600 when missing (before cron's `>>` would create it 0644). */
export function ensureLogFile(file: string = getBackupLogPath()): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (!existsSync(file)) {
    appendFileSync(file, '', { mode: 0o600 });
    chmodSync(file, 0o600);
  }
}

function isRecord(v: unknown): v is BackupRunRecord {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    r.type === RUN_RECORD_TYPE &&
    typeof r.at === 'string' &&
    !Number.isNaN(Date.parse(r.at)) &&
    (r.outcome === 'success' || r.outcome === 'failure')
  );
}

/** The run records in a log's text, oldest first. Other lines are skipped. Pure. */
export function parseBackupLog(text: string): BackupRunRecord[] {
  const out: BackupRunRecord[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.includes(RUN_RECORD_TYPE)) continue;
    try {
      const parsed: unknown = JSON.parse(t);
      if (isRecord(parsed)) out.push(parsed);
    } catch {
      // a partial or foreign line
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The last `maxBytes` of the log ('' when missing). The first partial line is dropped. */
export function readLogTail(file: string = getBackupLogPath(), maxBytes = 512 * 1024): string {
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

export interface RunSummary {
  total: number;
  /** Newest first. */
  recent: BackupRunRecord[];
  last?: BackupRunRecord;
  lastSuccess?: BackupRunRecord;
  lastFailure?: BackupRunRecord;
  /** Failures since the last success (0 when the last run succeeded). */
  consecutiveFailures: number;
}

/** Summarise records (any order). Pure. */
export function summarizeRuns(records: readonly BackupRunRecord[], recentCount = 10): RunSummary {
  const sorted = [...records].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let consecutiveFailures = 0;
  for (const r of sorted) {
    if (r.outcome === 'success') break;
    consecutiveFailures++;
  }
  const s: RunSummary = { total: sorted.length, recent: sorted.slice(0, recentCount), consecutiveFailures };
  if (sorted[0]) s.last = sorted[0];
  const ok = sorted.find((r) => r.outcome === 'success');
  if (ok) s.lastSuccess = ok;
  const bad = sorted.find((r) => r.outcome === 'failure');
  if (bad) s.lastFailure = bad;
  return s;
}

// ---------------------------------------------------------------------------
// The status summary
// ---------------------------------------------------------------------------

export interface FileSummary {
  root: string;
  count: number;
  totalBytes: number;
  newest?: { path: string; mtimeMs: number; size: number };
  oldest?: { path: string; mtimeMs: number; size: number };
  /** What retention would delete now. */
  retentionWouldDelete: { path: string; size: number; mtimeMs: number }[];
  retentionOn: boolean;
}

export interface TokenSummary {
  source: 'environment' | 'config' | 'legacy' | undefined;
  expiresAt?: string;
  level: ExpiryLevel;
  text: string;
}

export interface BackupStatus {
  generatedAt: string;
  settingsFile: string;
  settingsSaved: boolean;
  logFile: string;
  runs: RunSummary;
  schedule: ScheduleStatus & { nextRunAt?: string };
  files: FileSummary;
  token: TokenSummary;
  issues: PreflightIssue[];
}

/** Files on disk summary from a listing and a retention plan. Pure. */
export function summarizeFiles(
  root: string,
  files: readonly { path: string; mtimeMs: number; size: number }[],
  wouldDelete: readonly { path: string; mtimeMs: number; size: number }[],
  retentionOn: boolean,
): FileSummary {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const s: FileSummary = {
    root,
    count: sorted.length,
    totalBytes: sorted.reduce((n, f) => n + f.size, 0),
    retentionWouldDelete: wouldDelete.map((f) => ({ path: f.path, size: f.size, mtimeMs: f.mtimeMs })),
    retentionOn,
  };
  if (sorted[0]) s.newest = { ...sorted[0] };
  const last = sorted[sorted.length - 1];
  if (last) s.oldest = { ...last };
  return s;
}

/** Only the issues that matter when nothing is scheduled: drop the unattended-only ones. Pure. */
export function relevantIssues(issues: PreflightIssue[], scheduled: boolean): PreflightIssue[] {
  return scheduled ? issues : issues.filter((i) => i.scope === 'always');
}

export interface StatusDeps {
  run?: CrontabRunner;
  platform?: NodeJS.Platform;
  now?: Date;
  env?: Record<string, string | undefined>;
}

/** Stat the saved password file for the preflight. */
export function passwordFileState(path: string | undefined): PreflightInput['passwordFile'] {
  if (!path) return undefined;
  try {
    const st = statSync(path);
    return { exists: true, mode: st.mode, empty: st.size === 0 };
  } catch {
    return { exists: false };
  }
}

/** The stored (file) token's expiry, whatever `VAULT_TOKEN` says. */
function fileTokenInfo(): { present: boolean; expiresAt?: string } {
  const source = getTokenSource();
  if (source === 'config' || source === 'legacy') {
    const exp = getStoredTokenMeta().expiresAt;
    return { present: true, ...(exp ? { expiresAt: exp } : {}) };
  }
  const cfg = loadPlatformConfig();
  if (typeof cfg.token === 'string' && cfg.token) {
    return { present: true, ...(typeof cfg.expiresAt === 'string' ? { expiresAt: cfg.expiresAt } : {}) };
  }
  return { present: false };
}

/** The preflight input for the current machine (I/O: settings, files, token). */
export function collectPreflightInput(nextRunAt: Date | undefined, deps: StatusDeps = {}): PreflightInput {
  const saved: BackupSettings = loadBackupSettings();
  const file = fileTokenInfo();
  return {
    platform: deps.platform ?? process.platform,
    hasSavedSettings: Object.keys(saved).length > 0,
    saved,
    env: deps.env ?? process.env,
    passwordFile: passwordFileState(saved.passwordFile),
    tokenSource: getTokenSource(),
    fileTokenPresent: file.present,
    ...(file.expiresAt ? { tokenExpiresAt: file.expiresAt } : {}),
    ...(nextRunAt ? { nextRunAt } : {}),
    now: deps.now ?? new Date(),
  };
}

/** The job command for this machine (node, the real cli.js, HOME, PATH, config dir, log). */
export function currentCronCommand(env: Record<string, string | undefined> = process.env): string {
  return buildCronCommand({
    nodePath: process.execPath,
    cliPath: resolveCliEntry(),
    homeDir: homedir(),
    logPath: getBackupLogPath(),
    env,
  });
}

/** Gather everything `vault backup status` and the dashboard show. */
export async function collectBackupStatus(deps: StatusDeps = {}): Promise<BackupStatus> {
  const now = deps.now ?? new Date();
  const saved = loadBackupSettings();
  const { settings } = resolveBackupSettings({}, saved);
  const logFile = getBackupLogPath();
  const runs = summarizeRuns(parseBackupLog(readLogTail(logFile)));
  const schedule = await getScheduleStatus({ ...(deps.run ? { run: deps.run } : {}), ...(deps.platform ? { platform: deps.platform } : {}), now });

  let files: FileSummary;
  try {
    const { root, files: list, plan } = planBackupRetention(settings.output, {
      ...(settings.keepDays !== undefined ? { keepDays: settings.keepDays } : {}),
      ...(settings.keepLast !== undefined ? { keepLast: settings.keepLast } : {}),
      now: now.getTime(),
    });
    files = summarizeFiles(root, list, plan.delete, retentionEnabled(settings));
  } catch {
    files = summarizeFiles('', [], [], retentionEnabled(settings));
  }

  const source = getTokenSource();
  const file = fileTokenInfo();
  const expiresAt = source === 'environment' ? undefined : file.expiresAt;
  const exp = describeExpiry(expiresAt, now);
  const token: TokenSummary = {
    source,
    ...(expiresAt ? { expiresAt } : {}),
    level: source === undefined ? 'expired' : exp.level,
    text: source === undefined ? 'not signed in' : source === 'environment' ? 'from VAULT_TOKEN' : exp.level === 'unknown' ? 'expiry unknown' : exp.text,
  };

  const nextRunAt = schedule.next[0];
  const issues = schedulePreflight(collectPreflightInput(nextRunAt, { ...deps, now }));
  if (runs.consecutiveFailures > 0 && runs.lastFailure) {
    issues.unshift({
      level: 'error',
      scope: 'always',
      message: `The last ${runs.consecutiveFailures === 1 ? 'backup' : `${runs.consecutiveFailures} backups`} failed: ${runs.lastFailure.error ?? 'unknown error'}`,
    });
  }
  if (schedule.error) issues.push({ level: 'warning', scope: 'always', message: `Could not read the crontab: ${schedule.error}` });

  return {
    generatedAt: now.toISOString(),
    settingsFile: getBackupSettingsPath(),
    settingsSaved: Object.keys(saved).length > 0,
    logFile,
    runs,
    schedule: { ...schedule, ...(nextRunAt ? { nextRunAt: nextRunAt.toISOString() } : {}) },
    files,
    token,
    issues: relevantIssues(issues, schedule.installed !== null),
  };
}

// ---------------------------------------------------------------------------
// Display helpers (pure)
// ---------------------------------------------------------------------------

/** "3h ago", "2d 4h ago", "just now". Pure. */
export function ago(iso: string | number | undefined, now: Date = new Date()): string {
  if (iso === undefined) return '-';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '-';
  const ms = now.getTime() - t;
  if (ms < 60_000) return 'just now';
  return `${formatAge(ms)} ago`;
}

/** "in 3h", "in 2d 4h". Pure. */
export function inTime(at: Date | string | undefined, now: Date = new Date()): string {
  if (at === undefined) return '-';
  const t = typeof at === 'string' ? Date.parse(at) : at.getTime();
  if (Number.isNaN(t)) return '-';
  const ms = t - now.getTime();
  if (ms < 60_000) return 'in <1m';
  return `in ${formatAge(ms)}`;
}

/** "2026-11-13 02:30" in local time. Pure (the local zone is the machine's). */
export function localStamp(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "1.2s", "3m 04s". Pure. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export { formatBytes, hasBlockingIssue };
