// =============================================================================
// The "Backups" TUI screen's logic, kept free of ink so it is testable
// =============================================================================

import { relative } from 'node:path';

import {
  describeRunCounts,
  describeSchedule,
  formatWhen,
  runStatusLabel,
  showAdminBackupsEntry,
  type AdminBackupRun,
  type AdminBackupSchedule,
  type MenuUserState,
} from '../lib/admin-backups.js';
import { formatAge } from '../lib/backup-retention.js';
import type { BackupProgressEvent } from '../lib/backup-runner.js';
import {
  EVERY_HOURS_CHOICES,
  hasBlockingIssue,
  presetToCron,
  type PreflightIssue,
  type SchedulePreset,
} from '../lib/backup-schedule.js';
import {
  ago,
  formatBytes,
  formatDuration,
  inTime,
  localStamp,
  type BackupRunRecord,
  type BackupStatus,
} from '../lib/backup-status.js';
import { WEEKDAY_LONG, describeCron, nextRuns, validateCron } from '../lib/cron.js';
import { parseTimeOfDay } from '../interactive/logic.js';

export type Tone = 'green' | 'red' | 'yellow' | 'cyan' | 'gray';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Cut to `max` characters with an ellipsis. Pure. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return max === 1 ? '…' : `${s.slice(0, max - 1)}…`;
}

/** Keep the start and the end of a long path: `/home/a/…/vault-2026.zip`. Pure. */
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return truncate(s, max);
  const tail = Math.ceil((max - 1) * 0.6);
  const head = max - 1 - tail;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/** `[██████░░░░] 60%`, or a bouncing block when the size is unknown. Pure. */
export function progressBar(bytes: number, total: number | null, width: number, tick = 0): string {
  const w = Math.max(4, width);
  if (total && total > 0) {
    const ratio = Math.min(1, bytes / total);
    const full = Math.round(ratio * w);
    return `${'█'.repeat(full)}${'░'.repeat(w - full)} ${String(Math.floor(ratio * 100)).padStart(3)}%`;
  }
  const pos = tick % (w * 2 - 2 || 1);
  const at = pos < w ? pos : w * 2 - 2 - pos;
  return Array.from({ length: w }, (_, i) => (i === at ? '█' : '░')).join('');
}

/**
 * An error for the screen: Node's bare "fetch failed" names the server instead.
 * Never includes a token or a password (the inputs never carry one). Pure.
 */
export function friendlyError(err: unknown, serverUrl: string): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\bfetch failed\b/, `cannot reach the server ${serverUrl}`);
}

// ---------------------------------------------------------------------------
// Dashboard cards
// ---------------------------------------------------------------------------

export interface Card {
  title: string;
  value: string;
  detail: string;
  tone: Tone;
}

export function lastBackupCard(s: BackupStatus, now: Date): Card {
  const last = s.runs.last;
  if (!last) return { title: 'Last backup', value: 'never', detail: 'no runs recorded yet', tone: 'yellow' };
  if (last.outcome === 'success') {
    return { title: 'Last backup', value: `✔ ${ago(last.at, now)}`, detail: `${formatBytes(last.size ?? 0)} · ${last.trigger}`, tone: 'green' };
  }
  const n = s.runs.consecutiveFailures;
  return {
    title: 'Last backup',
    value: `✖ failed ${ago(last.at, now)}`,
    detail: n > 1 ? `${n} failures in a row` : s.runs.lastSuccess ? `last ok ${ago(s.runs.lastSuccess.at, now)}` : 'no successful run yet',
    tone: 'red',
  };
}

export function nextRunCard(s: BackupStatus, now: Date): Card {
  if (!s.schedule.supported) return { title: 'Next run', value: 'manual', detail: 'no cron on this OS', tone: 'gray' };
  if (s.schedule.error) return { title: 'Next run', value: 'unknown', detail: 'crontab unreadable', tone: 'yellow' };
  if (!s.schedule.installed) return { title: 'Next run', value: 'not scheduled', detail: 'press c to schedule', tone: 'yellow' };
  const next = s.schedule.next[0];
  return {
    title: 'Next run',
    value: next ? inTime(next, now) : 'never',
    detail: s.schedule.installed.description,
    tone: next ? 'cyan' : 'yellow',
  };
}

export function filesCard(s: BackupStatus): Card {
  const f = s.files;
  if (f.count === 0) return { title: 'On disk', value: 'none', detail: 'no backups found', tone: 'gray' };
  const doomed = f.retentionOn && f.retentionWouldDelete.length ? ` · ${f.retentionWouldDelete.length} to prune` : '';
  return { title: 'On disk', value: `${f.count} · ${formatBytes(f.totalBytes)}`, detail: `newest ${ago(f.newest?.mtimeMs, new Date(s.generatedAt))}${doomed}`, tone: 'cyan' };
}

export function tokenCard(s: BackupStatus): Card {
  const t = s.token;
  if (t.source === undefined) return { title: 'Token', value: 'signed out', detail: 'choose Login', tone: 'red' };
  if (t.source === 'environment') return { title: 'Token', value: 'VAULT_TOKEN', detail: 'cron will not see it', tone: 'yellow' };
  const tone: Tone = t.level === 'ok' ? 'green' : t.level === 'warning' ? 'yellow' : t.level === 'expired' ? 'red' : 'gray';
  return { title: 'Token', value: t.level === 'expired' ? 'expired' : t.text.replace(/^in /, ''), detail: t.expiresAt ? `until ${t.expiresAt.slice(0, 10)}` : 'expiry unknown', tone };
}

export function dashboardCards(s: BackupStatus, now: Date = new Date()): Card[] {
  return [lastBackupCard(s, now), nextRunCard(s, now), filesCard(s), tokenCard(s)];
}

export interface RunRow {
  mark: string;
  tone: Tone;
  when: string;
  ago: string;
  trigger: string;
  detail: string;
}

/** Recent runs for the table (newest first). Pure. */
export function recentRunRows(runs: readonly BackupRunRecord[], now: Date, limit = 5): RunRow[] {
  return runs.slice(0, limit).map((r) => ({
    mark: r.outcome === 'success' ? '✔' : '✖',
    tone: r.outcome === 'success' ? 'green' : 'red',
    when: localStamp(r.at),
    ago: ago(r.at, now),
    trigger: r.trigger,
    detail:
      r.outcome === 'success'
        ? `${formatBytes(r.size ?? 0)} in ${formatDuration(r.durationMs)}${r.retentionDeleted ? ` · pruned ${r.retentionDeleted}` : ''}`
        : (r.error ?? 'failed'),
  }));
}

/** Errors first, then warnings. Pure. */
export function sortIssues(issues: readonly PreflightIssue[]): PreflightIssue[] {
  return [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Dashboard actions
// ---------------------------------------------------------------------------

export type DashboardAction = 'run' | 'setup' | 'schedule' | 'list' | 'admin' | 'refresh' | 'back';

export interface ActionItem {
  key: string;
  label: string;
  value: DashboardAction;
  hotkey: string;
  /** Short footer word. */
  hint: string;
}

export function dashboardActions(ctx: { signedIn: boolean; user: MenuUserState }): ActionItem[] {
  const items: ActionItem[] = [];
  if (ctx.signedIn) items.push({ key: 'run', label: 'Run backup now', value: 'run', hotkey: 'r', hint: 'run' });
  items.push(
    { key: 'setup', label: 'Set up backups', value: 'setup', hotkey: 's', hint: 'setup' },
    { key: 'schedule', label: 'Schedule', value: 'schedule', hotkey: 'c', hint: 'schedule' },
    { key: 'list', label: 'List backups', value: 'list', hotkey: 'l', hint: 'list' },
  );
  if (ctx.signedIn && showAdminBackupsEntry(ctx.user)) {
    items.push({ key: 'admin', label: 'Server backups (admin)', value: 'admin', hotkey: 'a', hint: 'server' });
  }
  items.push(
    { key: 'refresh', label: 'Refresh', value: 'refresh', hotkey: 'f', hint: 'refresh' },
    { key: 'back', label: 'Back', value: 'back', hotkey: 'q', hint: 'back' },
  );
  return items;
}

/** The action a key press selects, if any. Pure. */
export function actionForKey(input: string, items: readonly ActionItem[]): DashboardAction | undefined {
  const k = input.toLowerCase();
  return items.find((i) => i.hotkey === k)?.value;
}

export function footerHints(items: readonly ActionItem[]): string[] {
  return items.map((i) => `${i.hotkey} ${i.hint}`);
}

// ---------------------------------------------------------------------------
// Run progress
// ---------------------------------------------------------------------------

export type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface RunProgress {
  request: StepState;
  download: StepState;
  write: StepState;
  retention: StepState;
  bytes: number;
  total: number | null;
}

export function initialProgress(retentionOn: boolean): RunProgress {
  return { request: 'active', download: 'pending', write: 'pending', retention: retentionOn ? 'pending' : 'skipped', bytes: 0, total: null };
}

/** Fold a runner event into the progress state. Pure. */
export function applyProgress(p: RunProgress, e: BackupProgressEvent | { phase: 'retention' }): RunProgress {
  switch (e.phase) {
    case 'request':
      return { ...p, request: 'active' };
    case 'download':
      return { ...p, request: 'done', download: 'active', bytes: e.bytes, total: e.total };
    case 'write':
      return { ...p, request: 'done', download: 'done', write: 'done', bytes: e.bytes };
    case 'retention':
      return { ...p, request: 'done', download: 'done', write: 'done', retention: p.retention === 'skipped' ? 'skipped' : 'active' };
  }
}

/** Mark everything finished (or the active step failed). Pure. */
export function finishProgress(p: RunProgress, ok: boolean): RunProgress {
  const end = (s: StepState): StepState => (s === 'skipped' ? 'skipped' : ok ? 'done' : s === 'active' ? 'failed' : s);
  return { ...p, request: end(p.request), download: end(p.download), write: end(p.write), retention: end(p.retention) };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export type PresetKind = SchedulePreset['kind'];

export const PRESET_CHOICES: readonly { key: string; label: string; value: PresetKind | 'back' }[] = [
  { key: 'daily', label: 'Every day at a time', value: 'daily' },
  { key: 'hourly', label: 'Every N hours', value: 'hourly' },
  { key: 'weekly', label: 'Once a week', value: 'weekly' },
  { key: 'cron', label: 'Custom cron expression', value: 'cron' },
  { key: 'back', label: 'Back', value: 'back' },
];

export function everyHoursChoices(): { key: string; label: string; value: string }[] {
  return EVERY_HOURS_CHOICES.map((n) => ({ key: String(n), label: n === 1 ? 'Every hour' : `Every ${n} hours`, value: String(n) }));
}

export function weekdayChoices(): { key: string; label: string; value: string }[] {
  return WEEKDAY_LONG.map((d, i) => ({ key: d, label: d, value: String(i) }));
}

/** A time field: the preset, or the message to show. Pure. */
export function parseTimeField(text: string): { ok: true; hour: number; minute: number } | { ok: false; error: string } {
  const t = parseTimeOfDay(text);
  return t ? { ok: true, ...t } : { ok: false, error: 'Use HH:MM (24h), e.g. 02:30' };
}

/** The cron field's live feedback. Pure. */
export function cronFieldFeedback(text: string, now: Date): { ok: true; description: string; next: string } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: 'minute hour day-of-month month day-of-week, e.g. 30 2 * * *' };
  const v = validateCron(text);
  if (!v.ok) return v;
  const next = nextRuns(v.schedule, now, 1)[0];
  return { ok: true, description: describeCron(v.schedule.expression), next: next ? `${localStamp(next)} (${inTime(next, now)})` : 'never' };
}

export interface SchedulePreview {
  cron: string;
  description: string;
  command: string;
  line: string;
  next: string[];
  issues: PreflightIssue[];
  blocking: boolean;
}

/** Everything shown before "Install". Pure. */
export function schedulePreview(preset: SchedulePreset, command: string, issues: PreflightIssue[], now: Date): SchedulePreview {
  const cron = presetToCron(preset);
  return {
    cron,
    description: describeCron(cron),
    command,
    line: `${cron} ${command}`,
    next: nextRuns(cron, now, 3).map((d) => `${localStamp(d)}  (${inTime(d, now)})`),
    issues: sortIssues(issues),
    blocking: hasBlockingIssue(issues),
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface FileRow {
  path: string;
  name: string;
  size: string;
  age: string;
  doomed: boolean;
}

/** Files newest first, named relative to the scan root. Pure. */
export function fileRows(
  root: string,
  files: readonly { path: string; mtimeMs: number; size: number }[],
  doomed: ReadonlySet<string>,
  now: number,
): FileRow[] {
  return [...files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((f) => ({
      path: f.path,
      name: relative(root, f.path) || f.path,
      size: formatBytes(f.size),
      age: formatAge(now - f.mtimeMs),
      doomed: doomed.has(f.path),
    }));
}

// ---------------------------------------------------------------------------
// Server (admin) backups
// ---------------------------------------------------------------------------

export function adminScheduleRows(s: AdminBackupSchedule): { label: string; value: string; tone?: Tone }[] {
  return [
    { label: 'Status', value: s.enabled ? 'enabled' : 'disabled', tone: s.enabled ? 'green' : 'yellow' },
    { label: 'Schedule', value: describeSchedule(s) },
    { label: 'Next run', value: s.enabled ? formatWhen(s.nextRunAt) : '-' },
    { label: 'Last run', value: formatWhen(s.lastRunAt) },
    { label: 'Password', value: s.passwordConfigured ? 'set' : 'not set', tone: s.passwordConfigured ? 'green' : 'red' },
    { label: 'Storage', value: s.storageConfigured ? 'configured' : 'not configured', tone: s.storageConfigured ? 'green' : 'red' },
  ];
}

export function adminRunRow(r: AdminBackupRun): { when: string; trigger: string; status: string; tone: Tone; size: string; counts: string } {
  const tone: Tone = r.deletedAt ? 'gray' : r.status === 'succeeded' ? 'green' : r.status === 'failed' ? 'red' : 'cyan';
  return {
    when: formatWhen(r.startedAt),
    trigger: r.trigger,
    status: runStatusLabel(r),
    tone,
    size: r.sizeBytes === null ? '-' : formatBytes(r.sizeBytes),
    counts: r.status === 'failed' ? (r.error ?? 'failed') : describeRunCounts(r),
  };
}

/** "running for 12s". Pure. */
export function elapsedText(ms: number): string {
  return ms < 60_000 ? `${Math.floor(ms / 1000)}s` : formatAge(ms);
}
