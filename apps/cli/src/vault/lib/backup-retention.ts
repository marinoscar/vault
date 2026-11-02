/**
 * Retention (pruning) for `vault backup`.
 *
 * Safety model:
 * - Only files whose full path matches the output TEMPLATE are candidates
 *   ({@link templateToMatcher}); everything else, including `.partial` files,
 *   is never touched.
 * - The scan starts at the deepest token-free directory of the template and
 *   descends exactly as many levels as the template has; symlinks are never
 *   followed and only regular files are considered.
 * - {@link planRetention} always keeps the newest matching backup and every
 *   protected path (the file the current run just wrote).
 *
 * `templateToMatcher` and `planRetention` are pure; the fs layer is
 * {@link listBackupCandidates} and {@link applyRetention}.
 */
import { lstatSync, readdirSync, unlinkSync } from 'fs';
import { isAbsolute, join, resolve as resolvePath, sep } from 'path';
import { assertValidTemplate } from './backup-settings.js';
import type { BackupFilenameToken } from './backup-filename.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Strict pattern for each token's expanded value (see expandBackupFilename). */
const TOKEN_PATTERNS: Record<BackupFilenameToken, string> = {
  date: '\\d{4}-\\d{2}-\\d{2}',
  time: '\\d{6}',
  datetime: '\\d{4}-\\d{2}-\\d{2}_\\d{6}',
  timestamp: '\\d{1,12}',
  year: '\\d{4}',
  month: '\\d{2}',
  day: '\\d{2}',
  hour: '\\d{2}',
  minute: '\\d{2}',
  second: '\\d{2}',
  host: '[A-Za-z0-9._-]+',
  user: '[A-Za-z0-9._-]+',
};

const TOKEN_RE = /\{([^{}]*)\}/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TemplateMatcherOptions {
  /** Home directory for a leading `~`. */
  homeDir?: string;
  /** Base for a relative template (default: process.cwd()). */
  cwd?: string;
  /** Match `{host}` literally (sanitized value) instead of the generic pattern. */
  host?: string;
  /** Match `{user}` literally (sanitized value) instead of the generic pattern. */
  user?: string;
  /** Path separator of the target platform (default: path.sep). */
  separator?: string;
}

export interface TemplateMatcher {
  /** Directory the scan starts at (absolute, token-free). */
  root: string;
  /** Number of path levels below `root` (1 = files directly in root). */
  depth: number;
  /** One anchored regex per level below root (the last one matches file names). */
  segments: RegExp[];
  /** True when an absolute path is a file this template could have produced. */
  matches(path: string): boolean;
}

function compileSegment(
  segment: string,
  isLast: boolean,
  literal: { host?: string; user?: string },
): RegExp {
  const toPattern = (part: string): string => {
    let out = '';
    let last = 0;
    for (const m of part.matchAll(TOKEN_RE)) {
      out += escapeRegex(part.slice(last, m.index));
      const token = m[1] as BackupFilenameToken;
      const lit = token === 'host' ? literal.host : token === 'user' ? literal.user : undefined;
      out += lit !== undefined ? escapeRegex(lit) : `(?:${TOKEN_PATTERNS[token]})`;
      last = (m.index ?? 0) + m[0].length;
    }
    return out + escapeRegex(part.slice(last));
  };

  if (!isLast) return new RegExp(`^${toPattern(segment)}$`);

  // Collision suffix `-N` goes before the extension (see withCollisionSuffix):
  // the extension is the part after the last literal dot, when no token follows it.
  const dot = segment.lastIndexOf('.');
  const ext = dot > 0 ? segment.slice(dot) : '';
  if (ext && !ext.includes('{') && !ext.includes('}')) {
    return new RegExp(`^${toPattern(segment.slice(0, dot))}(?:-\\d+)?${escapeRegex(ext)}$`);
  }
  return new RegExp(`^${toPattern(segment)}(?:-\\d+)?$`);
}

function sanitize(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'unknown';
}

/**
 * Build a matcher for every path an output template can expand to. Pure
 * (no filesystem access; `cwd`/`homeDir` are inputs).
 */
export function templateToMatcher(template: string, opts: TemplateMatcherOptions = {}): TemplateMatcher {
  assertValidTemplate(template);
  const separator = opts.separator ?? sep;

  let t = template;
  if (opts.homeDir !== undefined && (t === '~' || /^~[\\/]/.test(t))) t = opts.homeDir + t.slice(1);
  const base = opts.cwd ?? process.cwd();
  const absolute = isAbsolute(t) ? resolvePath(t) : resolvePath(base, t);

  const parts = absolute.split(/[\\/]/);
  const firstTokenIdx = parts.findIndex((p) => p.includes('{'));
  const splitAt = firstTokenIdx === -1 ? parts.length - 1 : Math.min(firstTokenIdx, parts.length - 1);
  const rootParts = parts.slice(0, splitAt);
  const rest = parts.slice(splitAt);
  if (rest.length === 0 || rest[rest.length - 1] === '') {
    throw new Error('Output template must end with a file name');
  }
  let root = rootParts.length === 1 && rootParts[0] === '' ? separator : rootParts.join(separator) || separator;
  if (/^[A-Za-z]:$/.test(root)) root += separator; // Windows drive root

  const literal = {
    host: opts.host !== undefined ? sanitize(opts.host) : undefined,
    user: opts.user !== undefined ? sanitize(opts.user.includes('@') ? opts.user.split('@')[0] : opts.user) : undefined,
  };
  const segments = rest.map((s, i) => compileSegment(s, i === rest.length - 1, literal));

  const rootNorm = root.replace(/[\\/]+$/, '');
  return {
    root,
    depth: segments.length,
    segments,
    matches(path: string): boolean {
      const parts2 = resolvePath(path).split(/[\\/]/);
      const rootParts2 = rootNorm === '' ? [''] : rootNorm.split(/[\\/]/);
      if (parts2.length !== rootParts2.length + segments.length) return false;
      for (let i = 0; i < rootParts2.length; i++) if (parts2[i] !== rootParts2[i]) return false;
      return segments.every((re, i) => re.test(parts2[rootParts2.length + i]));
    },
  };
}

export interface RetentionFile {
  path: string;
  mtimeMs: number;
}

export interface RetentionOptions {
  /** Delete files older than this many days. */
  keepDays?: number;
  /** Keep at most this many newest files. */
  keepLast?: number;
  /** Reference time (ms). */
  now: number;
  /** Paths that are never deleted (e.g. the backup just written). */
  protect?: string[];
}

export type RetentionReason = 'age' | 'count';

export type PlannedFile<T extends RetentionFile> = T & { reasons: RetentionReason[] };

export interface RetentionPlan<T extends RetentionFile> {
  /** Files to delete, newest first, with why. */
  delete: PlannedFile<T>[];
  /** Files to keep, newest first. */
  keep: T[];
}

/** True when a retention plan would ever delete something. */
export function retentionEnabled(opts: { keepDays?: number; keepLast?: number }): boolean {
  return (opts.keepDays ?? 0) >= 1 || (opts.keepLast ?? 0) >= 1;
}

/**
 * Decide which backups to delete. Pure.
 *
 * A file is deleted when it is older than `keepDays` OR outside the
 * `keepLast` newest. The single newest file and every protected path are
 * always kept. With no limits nothing is deleted.
 */
export function planRetention<T extends RetentionFile>(files: T[], opts: RetentionOptions): RetentionPlan<T> {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  const protect = new Set((opts.protect ?? []).map((p) => resolvePath(p)));
  const keepDays = opts.keepDays !== undefined && opts.keepDays >= 1 ? opts.keepDays : undefined;
  const keepLast = opts.keepLast !== undefined && opts.keepLast >= 1 ? opts.keepLast : undefined;

  const plan: RetentionPlan<T> = { delete: [], keep: [] };
  sorted.forEach((file, index) => {
    const reasons: RetentionReason[] = [];
    if (keepDays !== undefined && opts.now - file.mtimeMs > keepDays * DAY_MS) reasons.push('age');
    if (keepLast !== undefined && index >= keepLast) reasons.push('count');
    const isNewest = index === 0;
    if (reasons.length === 0 || isNewest || protect.has(resolvePath(file.path))) {
      plan.keep.push(file);
    } else {
      plan.delete.push({ ...file, reasons });
    }
  });
  return plan;
}

// ---------------------------------------------------------------------------
// File layer
// ---------------------------------------------------------------------------

export interface BackupFileInfo extends RetentionFile {
  size: number;
}

/**
 * List regular files matching the template, without following symlinks.
 * Missing directories yield an empty list.
 */
export function listBackupCandidates(matcher: TemplateMatcher): BackupFileInfo[] {
  const results: BackupFileInfo[] = [];
  const walk = (dir: string, level: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const re = matcher.segments[level];
    const isLast = level === matcher.depth - 1;
    for (const e of entries) {
      if (!re.test(e.name)) continue;
      const full = join(dir, e.name);
      if (isLast) {
        if (!e.isFile()) continue; // Dirent reports symlinks as symlinks, not files.
        try {
          const st = lstatSync(full);
          if (!st.isFile()) continue;
          if (matcher.matches(full)) results.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // vanished; ignore
        }
      } else if (e.isDirectory()) {
        walk(full, level + 1);
      }
    }
  };
  walk(matcher.root, 0);
  return results;
}

export interface RetentionResult {
  deleted: string[];
  kept: number;
  errors: { path: string; error: string }[];
}

/** Delete the planned files (re-checking each is still a matching regular file). */
export function applyRetention(
  plan: RetentionPlan<RetentionFile>,
  matcher: TemplateMatcher,
): RetentionResult {
  const result: RetentionResult = { deleted: [], kept: plan.keep.length, errors: [] };
  for (const file of plan.delete) {
    try {
      const st = lstatSync(file.path);
      if (!st.isFile() || !matcher.matches(file.path)) {
        result.errors.push({ path: file.path, error: 'no longer a matching regular file; skipped' });
        continue;
      }
      unlinkSync(file.path);
      result.deleted.push(file.path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      result.errors.push({ path: file.path, error: code ?? (err instanceof Error ? err.message : String(err)) });
    }
  }
  return result;
}

/** Human-readable age such as "3d 4h", "5h", "12m". Pure. */
export function formatAge(ms: number): string {
  if (ms < 0) ms = 0;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}
