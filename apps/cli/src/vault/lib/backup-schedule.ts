// =============================================================================
// Scheduled backups: a managed block in the user's crontab
// =============================================================================
//
// `vault backup schedule install` (and the TUI's Backups → Schedule) write ONE
// marked block into the user's crontab:
//
//   # >>> vault backup (managed by vault CLI) >>>
//   # Every day at 02:30 · installed 2026-11-13T10:00:00.000Z
//   30 2 * * * HOME='/home/a' PATH='…' '/usr/bin/node' '/…/dist/cli.js' backup --json --scheduled >> '/home/a/.vault/backup.log' 2>&1
//   # <<< vault backup <<<
//
// Every other line of the crontab is left exactly as it was. The job runs
// `vault backup` with the saved settings (backup.json), so the password comes
// from the saved password file; nothing secret is ever written to the crontab
// (no token, no password, no password variable).
//
// The pure parts (block editing, command line, presets, preflight) are tested
// directly; the crontab is read and written through an injected runner.
// =============================================================================

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PASSWORD_ENV, PASSWORD_ENV_ALIAS, type BackupSettings } from './backup-settings.js';
import { describeCron, nextRuns, parseCron, parseWeekday, validateCron } from './cron.js';
import { EXPIRY_WARNING_DAYS } from './tokens.js';
import { parseTimeOfDay, scheduleWarnings } from '../interactive/logic.js';

export const BLOCK_BEGIN = '# >>> vault backup (managed by vault CLI) >>>';
export const BLOCK_END = '# <<< vault backup <<<';

/** The flag the cron line passes so the run is recorded as scheduled. */
export const SCHEDULED_FLAG = '--scheduled';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type SchedulePreset =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'hourly'; every: number }
  | { kind: 'weekly'; day: number; hour: number; minute: number }
  | { kind: 'cron'; expression: string };

export const EVERY_HOURS_CHOICES = [1, 2, 3, 4, 6, 8, 12] as const;
export const DEFAULT_TIME = '02:30';

function assertInt(n: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
}

/** The 5-field cron expression of a preset (validated). Pure. */
export function presetToCron(p: SchedulePreset): string {
  switch (p.kind) {
    case 'daily':
      assertInt(p.hour, 0, 23, 'Hour');
      assertInt(p.minute, 0, 59, 'Minute');
      return `${p.minute} ${p.hour} * * *`;
    case 'hourly':
      assertInt(p.every, 1, 23, 'Every N hours');
      return p.every === 1 ? '0 * * * *' : `0 */${p.every} * * *`;
    case 'weekly':
      assertInt(p.day, 0, 6, 'Day of week');
      assertInt(p.hour, 0, 23, 'Hour');
      assertInt(p.minute, 0, 59, 'Minute');
      return `${p.minute} ${p.hour} * * ${p.day}`;
    case 'cron':
      return parseCron(p.expression).expression;
  }
}

/** Parse "HH:MM" or throw. */
export function parseTimeOrThrow(raw: string, label = 'time'): { hour: number; minute: number } {
  const t = parseTimeOfDay(raw);
  if (!t) throw new Error(`Invalid ${label} "${raw}": use HH:MM (24h), e.g. 02:30`);
  return t;
}

export interface ScheduleFlags {
  daily?: string;
  everyHours?: string;
  weekly?: string;
  at?: string;
  cron?: string;
}

/**
 * The preset named by `--daily HH:MM`, `--every-hours N`, `--weekly <day>
 * [--at HH:MM]` or `--cron "<expr>"`. Exactly one is required. Pure.
 */
export function presetFromFlags(f: ScheduleFlags): SchedulePreset {
  const given = (['daily', 'everyHours', 'weekly', 'cron'] as const).filter((k) => f[k] !== undefined);
  if (given.length === 0) throw new Error('Choose when to run: --daily HH:MM, --every-hours N, --weekly <day> [--at HH:MM] or --cron "<expr>"');
  if (given.length > 1) throw new Error('Use only one of --daily, --every-hours, --weekly and --cron');
  if (f.at !== undefined && f.weekly === undefined) throw new Error('--at goes with --weekly (use --daily HH:MM for a daily time)');
  if (f.daily !== undefined) return { kind: 'daily', ...parseTimeOrThrow(f.daily, '--daily') };
  if (f.everyHours !== undefined) {
    const s = String(f.everyHours).trim();
    const n = /^\d+$/.test(s) ? Number(s) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 23) throw new Error(`--every-hours must be a whole number from 1 to 23 (got "${f.everyHours}")`);
    return { kind: 'hourly', every: n };
  }
  if (f.weekly !== undefined) {
    return { kind: 'weekly', day: parseWeekday(f.weekly), ...parseTimeOrThrow(f.at ?? DEFAULT_TIME, '--at') };
  }
  const v = validateCron(f.cron!);
  if (!v.ok) throw new Error(`Invalid --cron: ${v.error}`);
  return { kind: 'cron', expression: v.schedule.expression };
}

// ---------------------------------------------------------------------------
// The command line cron runs
// ---------------------------------------------------------------------------

/** Single-quote for sh, then escape `%` (cron turns a bare `%` into a newline). */
export function cronQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`.replace(/%/g, '\\%');
}

/** Variables passed through to the job when set (never a token or a password). */
export const PASSTHROUGH_ENV = ['VAULT_CONFIG_DIR', 'VAULTCLI_CONFIG_DIR', 'VAULT_SERVER_URL', 'VAULTCLI_SERVER_URL'] as const;

export interface CronCommandInput {
  /** Absolute path of node (process.execPath). */
  nodePath: string;
  /** Absolute, real path of the CLI entry (dist/cli.js). */
  cliPath: string;
  homeDir: string;
  /** Where the job appends its output (the config dir's backup.log). */
  logPath: string;
  /** The current environment; only {@link PASSTHROUGH_ENV} is copied. */
  env: Record<string, string | undefined>;
}

/** PATH for the job: node's folder first, then the usual system folders. Pure. */
export function cronPath(nodePath: string): string {
  const parts = [dirname(nodePath), '/usr/local/bin', '/usr/bin', '/bin'];
  return [...new Set(parts)].join(':');
}

/** The job's command (everything after the 5 schedule fields). Pure. */
export function buildCronCommand(input: CronCommandInput): string {
  const vars: [string, string][] = [
    ['HOME', input.homeDir],
    ['PATH', cronPath(input.nodePath)],
  ];
  for (const key of PASSTHROUGH_ENV) {
    const v = input.env[key];
    if (v) vars.push([key, v]);
  }
  const prefix = vars.map(([k, v]) => `${k}=${cronQuote(v)}`).join(' ');
  return (
    `${prefix} ${cronQuote(input.nodePath)} ${cronQuote(input.cliPath)} backup --json ${SCHEDULED_FLAG} ` +
    `>> ${cronQuote(input.logPath)} 2>&1`
  );
}

/** The full crontab line. Pure. */
export function buildCronLine(cron: string, command: string): string {
  return `${parseCron(cron).expression} ${command}`;
}

/**
 * The CLI entry cron should run: `dist/cli.js` of this package (resolved from
 * this module, so an npm-link or bin symlink does not matter), else the real
 * path of the running script when it is JavaScript. Throws when neither exists.
 */
export function resolveCliEntry(
  argv1: string | undefined = process.argv[1],
  deps: { exists: (p: string) => boolean; realpath: (p: string) => string; moduleDir: string } = {
    exists: existsSync,
    realpath: realpathSync,
    moduleDir: dirname(fileURLToPath(import.meta.url)),
  },
): string {
  // src/vault/lib or dist/vault/lib → <package>/dist/cli.js
  const candidate = resolvePath(deps.moduleDir, '..', '..', '..', 'dist', 'cli.js');
  if (deps.exists(candidate)) {
    try {
      return deps.realpath(candidate);
    } catch {
      return candidate;
    }
  }
  if (argv1) {
    try {
      const real = deps.realpath(resolvePath(argv1));
      if (/\.(c|m)?js$/.test(real) && deps.exists(real)) return real;
    } catch {
      // fall through
    }
  }
  throw new Error('Cannot find the built vault CLI (dist/cli.js). Build it first: npm run build --workspace=cli');
}

// ---------------------------------------------------------------------------
// The marked block (pure)
// ---------------------------------------------------------------------------

export interface InstalledSchedule {
  cron: string;
  command: string;
  /** The whole crontab line. */
  line: string;
  description: string;
  installedAt?: string;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line indexes of the managed block, or null. Throws on a half block. */
export function findBlock(text: string): { start: number; end: number } | null {
  const lines = splitLines(text);
  const start = lines.findIndex((l) => l.trim() === BLOCK_BEGIN);
  const endIdx = lines.findIndex((l, i) => i > start && l.trim() === BLOCK_END);
  if (start < 0) {
    if (lines.some((l) => l.trim() === BLOCK_END)) throw new Error('Your crontab has a vault backup end marker without a start; fix it with crontab -e');
    return null;
  }
  if (endIdx < 0) throw new Error('Your crontab has a vault backup start marker without an end; fix it with crontab -e');
  if (lines.slice(endIdx + 1).some((l) => l.trim() === BLOCK_BEGIN)) {
    throw new Error('Your crontab has more than one vault backup block; fix it with crontab -e');
  }
  return { start, end: endIdx };
}

/** The installed schedule in a crontab's text, or null. Pure. */
export function parseInstalled(text: string): InstalledSchedule | null {
  const block = findBlock(text);
  if (!block) return null;
  const lines = splitLines(text).slice(block.start + 1, block.end);
  const job = lines.find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (!job) return null;
  const fields = job.trim().split(/\s+/);
  let cron: string;
  let command: string;
  if (fields[0]?.startsWith('@')) {
    cron = fields[0];
    command = fields.slice(1).join(' ');
  } else {
    cron = fields.slice(0, 5).join(' ');
    command = job.trim().replace(/^(\S+\s+){5}/, '');
  }
  const meta = lines.find((l) => /installed \S+/.test(l) && l.trim().startsWith('#'));
  const installedAt = meta ? /installed (\S+)/.exec(meta)?.[1] : undefined;
  return { cron, command, line: job.trim(), description: describeCron(cron), ...(installedAt ? { installedAt } : {}) };
}

/** The block's lines. Pure. */
export function renderBlock(cron: string, command: string, installedAt: Date): string[] {
  return [BLOCK_BEGIN, `# ${describeCron(cron)} · installed ${installedAt.toISOString()}`, buildCronLine(cron, command), BLOCK_END];
}

/**
 * The crontab with the managed block added or replaced in place. Other lines
 * are untouched; the result always ends with a newline (cron needs it). Pure.
 */
export function applyInstall(text: string, block: string[]): string {
  const lines = splitLines(text);
  const found = findBlock(text);
  let next: string[];
  if (found) {
    next = [...lines.slice(0, found.start), ...block, ...lines.slice(found.end + 1)];
  } else {
    next = [...lines];
    if (next.length > 0 && next[next.length - 1]!.trim() !== '') next.push('');
    next.push(...block);
  }
  return next.join('\n') + '\n';
}

/** The crontab without the managed block. Pure. */
export function applyRemove(text: string): { text: string; removed: boolean } {
  const found = findBlock(text);
  if (!found) return { text, removed: false };
  const lines = splitLines(text);
  const before = lines.slice(0, found.start);
  const after = lines.slice(found.end + 1);
  // Drop the blank separator line install added.
  if (before.length > 0 && before[before.length - 1]!.trim() === '' && (after.length === 0 || after[0]!.trim() === '')) before.pop();
  const next = [...before, ...after];
  return { text: next.length ? next.join('\n') + '\n' : '', removed: true };
}

// ---------------------------------------------------------------------------
// Reading and writing the crontab (injected runner)
// ---------------------------------------------------------------------------

export interface CrontabResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `crontab <args>`, feeding `input` to stdin. */
export type CrontabRunner = (args: string[], input?: string) => Promise<CrontabResult>;

export const systemCrontab: CrontabRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn('crontab', args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'ENOENT' ? new Error('The crontab command is not installed on this machine (install cron, e.g. the "cron" or "cronie" package)') : err),
    );
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined); // an early exit is reported by 'close'
      child.stdin.end(input);
    }
  });

/** The current crontab text; '' when the user has none. */
export async function readCrontab(run: CrontabRunner = systemCrontab): Promise<string> {
  const r = await run(['-l']);
  if (r.code === 0) return r.stdout;
  if (/no crontab/i.test(r.stderr)) return '';
  throw new Error(`crontab -l failed: ${r.stderr.trim() || `exit ${r.code}`}`);
}

export async function writeCrontab(text: string, run: CrontabRunner = systemCrontab): Promise<void> {
  const r = await run(['-'], text);
  if (r.code !== 0) throw new Error(`crontab - failed: ${r.stderr.trim() || `exit ${r.code}`}`);
}

/** Whether this OS gets a crontab install (else: printed instructions). */
export function supportsCrontab(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

export interface ScheduleStatus {
  supported: boolean;
  installed: InstalledSchedule | null;
  /** Next runs (local time), up to three. */
  next: Date[];
  /** Set when the crontab could not be read. */
  error?: string;
}

export async function getScheduleStatus(
  opts: { run?: CrontabRunner; platform?: NodeJS.Platform; now?: Date } = {},
): Promise<ScheduleStatus> {
  if (!supportsCrontab(opts.platform)) return { supported: false, installed: null, next: [] };
  try {
    const installed = parseInstalled(await readCrontab(opts.run));
    const v = installed ? validateCron(installed.cron) : undefined;
    const next = v?.ok ? nextRuns(v.schedule, opts.now ?? new Date(), 3) : [];
    return { supported: true, installed, next };
  } catch (err) {
    return { supported: true, installed: null, next: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Install or replace the block. Returns the installed schedule. */
export async function installSchedule(
  cron: string,
  command: string,
  opts: { run?: CrontabRunner; now?: Date } = {},
): Promise<InstalledSchedule> {
  const current = await readCrontab(opts.run);
  const next = applyInstall(current, renderBlock(cron, command, opts.now ?? new Date()));
  await writeCrontab(next, opts.run);
  const installed = parseInstalled(next);
  if (!installed) throw new Error('The schedule was written but could not be read back');
  return installed;
}

/** Remove the block. Returns false when nothing was installed. */
export async function removeSchedule(opts: { run?: CrontabRunner } = {}): Promise<boolean> {
  const current = await readCrontab(opts.run);
  const { text, removed } = applyRemove(current);
  if (removed) await writeCrontab(text, opts.run);
  return removed;
}

// ---------------------------------------------------------------------------
// Preflight: will an unattended run work?
// ---------------------------------------------------------------------------

export type IssueLevel = 'error' | 'warning';

export interface PreflightIssue {
  level: IssueLevel;
  message: string;
  /** `always`: matters for a manual run too; `schedule`: only for unattended runs. */
  scope: 'always' | 'schedule';
}

export interface PreflightInput {
  platform: NodeJS.Platform;
  /** Whether backup.json exists with at least one key. */
  hasSavedSettings: boolean;
  saved: BackupSettings;
  env: Record<string, string | undefined>;
  /** The saved password file, when one is configured (stat injected). */
  passwordFile?: { exists: boolean; mode?: number; empty?: boolean };
  /** Where `getToken()` reads from right now. */
  tokenSource: 'environment' | 'config' | 'legacy' | undefined;
  /** Whether a token is stored in a file (config.json or the legacy auth.json). */
  fileTokenPresent: boolean;
  /** Expiry of the stored (file) token, when known. */
  tokenExpiresAt?: string;
  /** The next scheduled run, when known. */
  nextRunAt?: Date;
  now: Date;
}

const TOKEN_HINT = 'Create a longer-lived token in the TUI\'s "Access token" screen or with: vault auth token create --duration 12 --unit months --store';

/** Everything that would make a scheduled run fail or misbehave. Pure. */
export function schedulePreflight(input: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const { saved } = input;
  if (!input.hasSavedSettings) {
    issues.push({ level: 'warning', scope: 'schedule', message: 'No saved backup settings: a scheduled run would use the defaults. Run "Set up" (or vault backup config set) first.' });
  }
  const defaultEnvSet = Boolean(input.env[DEFAULT_PASSWORD_ENV] || input.env[PASSWORD_ENV_ALIAS]);
  const base = scheduleWarnings({ saved, defaultEnvSet, platform: input.platform });
  const noSource = !saved.passwordFile && !saved.passwordEnv;
  base.forEach((message, i) => issues.push({ level: noSource && i === 0 ? 'error' : 'warning', scope: 'schedule', message }));

  if (saved.passwordFile && input.passwordFile) {
    const pf = input.passwordFile;
    if (!pf.exists) issues.push({ level: 'error', scope: 'always', message: `The password file ${saved.passwordFile} does not exist.` });
    else if (pf.empty) issues.push({ level: 'error', scope: 'always', message: `The password file ${saved.passwordFile} is empty.` });
    else if (pf.mode !== undefined && (pf.mode & 0o077) !== 0) {
      issues.push({
        level: 'warning',
        scope: 'always',
        message: `The password file ${saved.passwordFile} can be read by other users (mode ${(pf.mode & 0o777).toString(8)}); run: chmod 600 ${saved.passwordFile}`,
      });
    }
  }

  if (input.tokenSource === undefined) {
    issues.push({ level: 'error', scope: 'always', message: 'Not signed in: a scheduled run has no token. Sign in first (Login, or vault login).' });
  } else if (input.tokenSource === 'environment' && !input.fileTokenPresent) {
    issues.push({
      level: 'error',
      scope: 'schedule',
      message: `The token comes only from VAULT_TOKEN in your shell, which cron does not see. Store one: ${TOKEN_HINT}`,
    });
  } else if (input.tokenSource === 'environment') {
    issues.push({ level: 'warning', scope: 'schedule', message: 'VAULT_TOKEN is set in your shell; scheduled runs use the stored token instead.' });
  }

  if (input.fileTokenPresent && input.tokenExpiresAt) {
    const at = Date.parse(input.tokenExpiresAt);
    if (!Number.isNaN(at)) {
      const days = Math.floor((at - input.now.getTime()) / 86_400_000);
      if (at <= input.now.getTime()) {
        issues.push({ level: 'error', scope: 'always', message: `The stored token has expired. ${TOKEN_HINT}` });
      } else if (input.nextRunAt && at <= input.nextRunAt.getTime()) {
        issues.push({ level: 'error', scope: 'schedule', message: `The stored token expires before the next scheduled run. ${TOKEN_HINT}` });
      } else if (days < EXPIRY_WARNING_DAYS) {
        issues.push({
          level: 'warning',
          scope: 'always',
          message: `The stored token expires in ${days < 1 ? 'less than a day' : `${days} day(s)`}; scheduled backups will then fail. ${TOKEN_HINT}`,
        });
      }
    }
  }
  return issues;
}

/** Whether any issue blocks an unattended run. Pure. */
export function hasBlockingIssue(issues: readonly PreflightIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/** The config dir's backup.log path (the same file `vault menu` pointed cron at). */
export function backupLogPathIn(configDir: string): string {
  return join(configDir, 'backup.log');
}
