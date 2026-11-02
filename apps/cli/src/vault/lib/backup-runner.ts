/**
 * Shared backup execution for the `vault backup` command and the TUI:
 * password resolution, the streamed download, and post-backup retention.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { chmod, link, rename, unlink } from 'fs/promises';
import { homedir, hostname } from 'os';
import { dirname, resolve as resolvePath } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { exportSecretsBackup, getCurrentUser } from './api-client.js';
import { hasStoredToken } from '../utils/config.js';
import { expandBackupFilename, templateUsesUser, withCollisionSuffix } from './backup-filename.js';
import {
  DEFAULT_PASSWORD_ENV,
  buildExportBody,
  contentKeys,
  type BackupContentKey,
  type BackupContents,
  type PasswordSource,
  type ResolvedBackupSettings,
} from './backup-settings.js';
import {
  applyRetention,
  listBackupCandidates,
  planRetention,
  retentionEnabled,
  templateToMatcher,
  type BackupFileInfo,
  type PlannedFile,
  type RetentionPlan,
  type RetentionResult,
} from './backup-retention.js';

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 256;
const MAX_SUFFIX_ATTEMPTS = 10_000;

export function validatePassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (pw.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

export interface ResolvePasswordHooks {
  /** Whether a hidden prompt may be shown (stdin is a TTY). */
  interactive: boolean;
  /** Ask for a new password (hidden, with confirmation). */
  prompt: () => Promise<string>;
  /** Non-fatal notices (e.g. --password visibility, saved source unresolved). */
  warn?: (message: string) => void;
}

function describeSource(source: PasswordSource): string {
  switch (source.kind) {
    case 'literal':
      return '--password';
    case 'file':
      return source.from === 'flag' ? '--password-file' : `saved passwordFile ${source.path}`;
    case 'env':
      return source.from === 'flag' ? `$${source.name} (from --password-env)` : `$${source.name}`;
    case 'prompt':
      return 'prompt';
  }
}

/**
 * Turn a {@link PasswordSource} into the password. Explicit (flag) sources
 * that cannot be read are errors; a saved source that cannot be read falls
 * back to the prompt when interactive, else errors. Never prompts when not
 * interactive.
 */
export async function resolvePassword(source: PasswordSource, hooks: ResolvePasswordHooks): Promise<string> {
  let pw: string | undefined;
  let problem: string | undefined;

  if (source.kind === 'literal') {
    hooks.warn?.(
      'Warning: a password given with --password is visible in the process list and shell history. ' +
        `Prefer --password-file or ${DEFAULT_PASSWORD_ENV}.`,
    );
    pw = source.value;
  } else if (source.kind === 'file') {
    try {
      const content = readFileSync(source.path, 'utf-8');
      pw = (content.split(/\r?\n/, 1)[0] ?? '').trim();
      if (!pw) {
        pw = undefined;
        problem = `Password file ${source.path} is empty (the first line is used)`;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      problem = `Cannot read password file ${source.path}${code ? ` (${code})` : ''}`;
    }
  } else if (source.kind === 'env') {
    const v = process.env[source.name];
    if (v) pw = v;
    else problem = `Environment variable ${source.name}${source.from === 'flag' ? ' (from --password-env)' : ''} is not set or empty`;
  }

  if (pw === undefined) {
    const explicit = source.kind !== 'prompt' && (source as { from?: string }).from === 'flag';
    if (problem && (explicit || !hooks.interactive)) throw new Error(problem);
    if (!hooks.interactive) {
      throw new Error(
        'No backup password provided and stdin is not a terminal. ' +
          `Set ${DEFAULT_PASSWORD_ENV}, or use --password-env <VAR>, --password-file <path> or --password <pw> ` +
          '(or save a source with: vault backup config set --password-file <path>).',
      );
    }
    if (problem) hooks.warn?.(`${problem}; asking instead.`);
    return hooks.prompt();
  }

  const invalid = validatePassword(pw);
  if (invalid) throw new Error(`${invalid} (from ${describeSource(source)})`);
  return pw;
}

/** Fail fast before prompting when no token is stored. */
export function assertAuthenticated(): void {
  if (!hasStoredToken()) throw new Error('Not authenticated. Run: vault login');
}

export interface BackupResult {
  path: string;
  size: number;
  secrets: number | null;
  attachments: number | null;
  /** Media files in the zip (0 when media was not included or the server sent no count). */
  mediaFiles: number;
  /** Selected content keys, e.g. ["secrets", "attachments", "media"]. */
  contents: BackupContentKey[];
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
  overwritten: boolean;
}

export interface PerformBackupInput {
  settings: ResolvedBackupSettings;
  /**
   * What to request (from {@link effectiveContents}). Defaults to the
   * settings' own content flags, with attachments / versions dropped when
   * secrets are off.
   */
  contents?: BackupContents;
  password: string;
  overwrite: boolean;
  /** Fixed time for template tokens (default: now). */
  now?: Date;
  /** Already-known user email for `{user}` (otherwise fetched when needed). */
  userEmail?: string;
  progress?: (message: string) => void;
  verbose?: (message: string) => void;
  /** Called after the partial file is removed on SIGINT/SIGTERM. Default: exit 130. */
  onInterrupt?: (signal: NodeJS.Signals) => void;
}

function parseCountHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function firstFreePath(target: string, startAttempt = 0): { path: string; attempt: number } {
  for (let attempt = startAttempt; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = withCollisionSuffix(target, attempt);
    if (!existsSync(candidate)) return { path: candidate, attempt };
  }
  throw new Error(`Could not find a free file name for ${target}`);
}

/**
 * Move the finished partial into place. With overwrite: rename. Without: hard
 * link to the first free name (atomic EEXIST → next suffix), falling back to
 * check-then-rename on filesystems without hard links.
 */
export async function commitPartial(partial: string, target: string, overwrite: boolean): Promise<string> {
  if (overwrite) {
    await rename(partial, target);
    return target;
  }
  let attempt = 0;
  for (;;) {
    const next = firstFreePath(target, attempt);
    try {
      await link(partial, next.path);
      await unlink(partial);
      return next.path;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        attempt = next.attempt + 1;
        continue;
      }
      await rename(partial, next.path);
      return next.path;
    }
  }
}

function unlinkSyncSafe(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

/** Expand the output template for `now` (fetching the user only when needed). */
export async function resolveTargetPath(
  settings: Pick<ResolvedBackupSettings, 'output' | 'utc'>,
  now: Date,
  userEmail?: string,
): Promise<string> {
  let user = userEmail;
  if (user === undefined && templateUsesUser(settings.output)) user = (await getCurrentUser()).email;
  return resolvePath(
    expandBackupFilename(settings.output, now, { utc: settings.utc, host: hostname(), homeDir: homedir(), user }),
  );
}

/** Download the encrypted backup to the expanded output path. */
export async function performBackup(input: PerformBackupInput): Promise<BackupResult> {
  const { settings, password, overwrite } = input;
  const now = input.now ?? new Date();

  if (templateUsesUser(settings.output) && input.userEmail === undefined) {
    input.verbose?.('Looking up the signed-in user for {user}');
  }
  const target = await resolveTargetPath(settings, now, input.userEmail);

  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && statSync(target).isDirectory()) {
    throw new Error(`Output path ${target} is a directory`);
  }

  const contents: BackupContents = input.contents ?? {
    includeSecrets: settings.includeSecrets,
    includeAttachments: settings.includeSecrets && settings.includeAttachments,
    includeVersions: settings.includeSecrets && settings.includeVersions,
    includeMedia: settings.includeMedia,
  };

  input.progress?.('Requesting encrypted backup from the server...');
  const res = await exportSecretsBackup(buildExportBody(contents, password));

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('zip') && !contentType.includes('octet-stream')) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Unexpected response from server (Content-Type: ${contentType || 'none'}); expected a zip file`);
  }
  if (!res.body) throw new Error('Server returned an empty response body');

  const secretCount = parseCountHeader(res, 'x-vault-export-secrets');
  const attachmentCount = parseCountHeader(res, 'x-vault-export-attachments');
  // Older servers do not send it: treat a missing header as 0.
  const mediaFileCount = parseCountHeader(res, 'x-vault-export-media-files') ?? 0;

  const partial = `${target}.partial`;
  let partialCreated = false;
  const cleanup = (): void => {
    if (partialCreated) unlinkSyncSafe(partial);
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    cleanup();
    if (input.onInterrupt) input.onInterrupt(signal);
    else {
      process.stderr.write(`Backup interrupted (${signal}); partial file removed\n`);
      process.exit(130);
    }
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const ws = createWriteStream(partial, { flags: 'w', mode: 0o600 });
    partialCreated = true;
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>), ws);
    await chmod(partial, 0o600);

    const size = statSync(partial).size;
    if (size === 0) throw new Error('Server returned an empty backup file');

    const finalPath = await commitPartial(partial, target, overwrite);
    partialCreated = false;
    return {
      path: finalPath,
      size,
      secrets: secretCount,
      attachments: attachmentCount,
      mediaFiles: mediaFileCount,
      contents: contentKeys(contents),
      includeSecrets: contents.includeSecrets,
      includeAttachments: contents.includeAttachments,
      includeVersions: contents.includeVersions,
      includeMedia: contents.includeMedia,
      overwritten: overwrite && finalPath === target,
    };
  } catch (err) {
    cleanup();
    let message = err instanceof Error ? err.message : String(err);
    if (message === 'terminated' || (err as NodeJS.ErrnoException)?.code === 'ECONNRESET') {
      message = 'the connection closed before the download finished';
    }
    throw new Error(message.startsWith('Backup failed') ? message : `Backup failed (partial file removed): ${message}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface PruneInput {
  template: string;
  keepDays?: number;
  keepLast?: number;
  /** Never delete these (the file just written). */
  protect?: string[];
  dryRun: boolean;
  now?: number;
}

export interface PruneOutcome {
  root: string;
  dryRun: boolean;
  keepDays: number | null;
  keepLast: number | null;
  /** Planned (dry run) or attempted deletions. */
  planned: PlannedFile<BackupFileInfo>[];
  deleted: string[];
  kept: number;
  errors: { path: string; error: string }[];
}

/**
 * Build the matcher for a template. `{host}` matches this machine's name only
 * (backups from other hosts in a shared folder are left alone); `{user}`
 * matches any safe value (no network lookup during prune).
 */
export function matcherForTemplate(template: string) {
  return templateToMatcher(template, { homeDir: homedir(), host: hostname() });
}

/** Plan retention for a template on the local filesystem (no deletion). */
export function planBackupRetention(
  template: string,
  opts: { keepDays?: number; keepLast?: number; protect?: string[]; now?: number },
): { root: string; files: BackupFileInfo[]; plan: RetentionPlan<BackupFileInfo> } {
  const matcher = matcherForTemplate(template);
  const files = listBackupCandidates(matcher);
  const plan = planRetention(files, {
    keepDays: opts.keepDays,
    keepLast: opts.keepLast,
    protect: opts.protect,
    now: opts.now ?? Date.now(),
  });
  return { root: matcher.root, files, plan };
}

/** List, plan and (unless dryRun) delete. Never throws for a delete error; see `errors`. */
export function runPrune(input: PruneInput): PruneOutcome {
  if (!retentionEnabled(input)) {
    throw new Error(
      'No retention limits set. Use --keep-days <n> / --keep-last <n>, or save them with: ' +
        'vault backup config set --keep-days 30',
    );
  }
  const matcher = matcherForTemplate(input.template);
  const files = listBackupCandidates(matcher);
  const plan = planRetention(files, {
    keepDays: input.keepDays,
    keepLast: input.keepLast,
    protect: input.protect,
    now: input.now ?? Date.now(),
  });
  let result: RetentionResult = { deleted: [], kept: plan.keep.length, errors: [] };
  if (!input.dryRun) result = applyRetention(plan, matcher);
  return {
    root: matcher.root,
    dryRun: input.dryRun,
    keepDays: input.keepDays ?? null,
    keepLast: input.keepLast ?? null,
    planned: plan.delete,
    deleted: result.deleted,
    kept: result.kept,
    errors: result.errors,
  };
}
