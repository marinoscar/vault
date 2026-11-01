import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { chmod, link, rename, unlink } from 'fs/promises';
import { homedir, hostname } from 'os';
import { dirname, resolve as resolvePath } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { Command } from 'commander';
import chalk from 'chalk';
import { OutputManager, keyValue, success, warn } from '../utils/output.js';
import { exportSecretsBackup, getCurrentUser } from '../lib/api-client.js';
import {
  BACKUP_FILENAME_TOKENS,
  DEFAULT_BACKUP_TEMPLATE,
  expandBackupFilename,
  templateUsesUser,
  withCollisionSuffix,
} from '../lib/backup-filename.js';
import { promptNewPassword } from '../lib/password-prompt.js';
import { loadAuth } from '../lib/auth-store.js';
import type { OutputMode } from '../utils/types.js';

const DEFAULT_PASSWORD_ENV = 'VAULTCLI_BACKUP_PASSWORD';
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 256;
const MAX_SUFFIX_ATTEMPTS = 10_000;

interface BackupOptions {
  output: string;
  passwordEnv?: string;
  passwordFile?: string;
  password?: string;
  attachments: boolean;
  includeVersions?: boolean;
  overwrite?: boolean;
  utc?: boolean;
  json?: boolean;
  verbose?: boolean;
}

export interface BackupResult {
  path: string;
  size: number;
  secrets: number | null;
  attachments: number | null;
  includeAttachments: boolean;
  includeVersions: boolean;
  overwritten: boolean;
}

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function validatePassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (pw.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/**
 * Resolve the backup password: --password, then --password-file, then the
 * environment variable (--password-env or VAULTCLI_BACKUP_PASSWORD), then a
 * hidden interactive prompt when stdin is a TTY. Never hangs when non-interactive.
 */
async function resolvePassword(opts: BackupOptions, output: OutputManager): Promise<string> {
  let pw: string | undefined;
  let source: string;

  if (opts.password !== undefined) {
    source = '--password';
    pw = opts.password;
    output.humanOnly(() =>
      warn('Warning: a password given with --password is visible in the process list and shell history. ' +
        `Prefer --password-file or ${DEFAULT_PASSWORD_ENV}.`),
    );
  } else if (opts.passwordFile !== undefined) {
    source = '--password-file';
    let content: string;
    try {
      content = readFileSync(opts.passwordFile, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(`Cannot read password file ${opts.passwordFile}${code ? ` (${code})` : ''}`);
    }
    pw = (content.split(/\r?\n/, 1)[0] ?? '').trim();
    if (!pw) throw new Error(`Password file ${opts.passwordFile} is empty (the first line is used)`);
  } else {
    const envName = opts.passwordEnv ?? DEFAULT_PASSWORD_ENV;
    source = `$${envName}`;
    const envValue = process.env[envName];
    if (envValue) {
      pw = envValue;
    } else if (opts.passwordEnv !== undefined) {
      throw new Error(`Environment variable ${envName} (from --password-env) is not set or empty`);
    }
  }

  if (pw === undefined) {
    if (!process.stdin.isTTY) {
      throw new Error(
        'No backup password provided and stdin is not a terminal. ' +
          `Set ${DEFAULT_PASSWORD_ENV}, or use --password-env <VAR>, --password-file <path> or --password <pw>.`,
      );
    }
    output.humanOnly(() =>
      process.stderr.write(
        chalk.dim('Choose a password for the backup file (at least 6 characters). ' +
          'Without it the file cannot be opened; there is no recovery.\n'),
      ),
    );
    return promptNewPassword(validatePassword);
  }

  const problem = validatePassword(pw);
  if (problem) throw new Error(`${problem} (from ${source})`);
  return pw;
}

function parseCountHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function formatBytes(bytes: number): string {
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

/** First free candidate (`name.zip`, `name-1.zip`, ...) that does not exist yet. */
function firstFreePath(target: string, startAttempt = 0): { path: string; attempt: number } {
  for (let attempt = startAttempt; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = withCollisionSuffix(target, attempt);
    if (!existsSync(candidate)) return { path: candidate, attempt };
  }
  throw new Error(`Could not find a free file name for ${target}`);
}

/**
 * Move the finished partial file into place. With overwrite, a plain rename.
 * Without, a hard link (fails atomically with EEXIST if a file appeared in the
 * meantime, in which case the next suffix is tried); filesystems without hard
 * links fall back to check-then-rename.
 */
async function commitPartial(
  partial: string,
  target: string,
  overwrite: boolean,
): Promise<string> {
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
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        attempt = next.attempt + 1;
        continue;
      }
      // No hard-link support (e.g. FAT, some network shares): best effort.
      await rename(partial, next.path);
      return next.path;
    }
  }
}

async function runBackup(opts: BackupOptions, output: OutputManager): Promise<BackupResult> {
  const now = new Date();
  const template = opts.output || DEFAULT_BACKUP_TEMPLATE;
  const usesUser = templateUsesUser(template);
  const expandOpts = { utc: opts.utc === true, host: hostname(), homeDir: homedir() };

  // Validate the template (unknown tokens) before asking for a password.
  expandBackupFilename(template, now, { ...expandOpts, user: usesUser ? 'user' : undefined });

  // Fail before prompting for a password when there is no stored token.
  if (!loadAuth()) throw new Error('Not authenticated. Run: vaultcli auth login');

  const password = await resolvePassword(opts, output);

  let user: string | undefined;
  if (usesUser) {
    if (opts.verbose) output.verbose('Looking up the signed-in user for {user}');
    user = (await getCurrentUser()).email;
  }

  const target = resolvePath(expandBackupFilename(template, now, { ...expandOpts, user }));
  const overwrite = opts.overwrite === true;

  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && statSync(target).isDirectory()) {
    throw new Error(`Output path ${target} is a directory`);
  }

  const includeAttachments = opts.attachments !== false;
  const includeVersions = opts.includeVersions === true;

  output.humanOnly(() => process.stderr.write(chalk.dim('Requesting encrypted backup from the server...\n')));
  const res = await exportSecretsBackup({ password, includeAttachments, includeVersions });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('zip') && !contentType.includes('octet-stream')) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Unexpected response from server (Content-Type: ${contentType || 'none'}); expected a zip file`);
  }
  if (!res.body) throw new Error('Server returned an empty response body');

  const secretCount = parseCountHeader(res, 'x-vault-export-secrets');
  const attachmentCount = parseCountHeader(res, 'x-vault-export-attachments');

  const partial = `${target}.partial`;
  let partialCreated = false;
  const cleanup = (): void => {
    if (partialCreated) {
      unlinkSyncSafe(partial);
    }
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    cleanup();
    output.fail(`Backup interrupted (${signal}); partial file removed`, 'interrupted');
    process.exit(130);
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
      includeAttachments,
      includeVersions,
      overwritten: overwrite && finalPath === target,
    };
  } catch (err) {
    cleanup();
    let message = err instanceof Error ? err.message : String(err);
    if (message === 'terminated' || (err as NodeJS.ErrnoException)?.code === 'ECONNRESET') {
      message = 'the connection closed before the download finished';
    }
    throw new Error(
      message.startsWith('Backup failed') ? message : `Backup failed (partial file removed): ${message}`,
    );
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

/** Remove a file if present; synchronous so it is safe in a signal handler. */
function unlinkSyncSafe(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

export function registerBackupCommands(program: Command): void {
  const tokenList = BACKUP_FILENAME_TOKENS.map((t) => `{${t}}`).join(' ');

  program
    .command('backup')
    .description(
      'Download a password-protected (AES-256 zip) backup of the secrets you own, ' +
        'including decrypted values and attachments. Open it with 7-Zip (Windows), ' +
        'Keka / The Unarchiver (macOS) or 7z / file-roller (Linux).',
    )
    .option('-o, --output <template>', `Output path template. Tokens: ${tokenList}`, DEFAULT_BACKUP_TEMPLATE)
    .option('--password-env <VAR>', `Read the password from this environment variable (default ${DEFAULT_PASSWORD_ENV})`)
    .option('--password-file <path>', 'Read the password from a file (first line, trimmed)')
    .option('-p, --password <pw>', 'Password on the command line (visible in the process list and shell history)')
    .option('--no-attachments', 'Exclude attachments')
    .option('--include-versions', 'Include all versions, not only the current one')
    .option('--overwrite', 'Replace an existing file instead of adding a -1, -2 ... suffix')
    .option('--utc', 'Use UTC for date/time tokens (default: local time)')
    .option('--json', 'Machine-readable result')
    .addHelpText(
      'after',
      `
Password resolution order:
  --password, --password-file, --password-env / $${DEFAULT_PASSWORD_ENV},
  then a hidden prompt (with confirmation) when stdin is a terminal.
  Non-interactive runs without a password fail instead of waiting.
  Minimum ${MIN_PASSWORD_LENGTH} characters.

Template tokens:
  {date} YYYY-MM-DD   {time} HHmmss   {datetime} YYYY-MM-DD_HHmmss
  {timestamp} unix seconds   {year} {month} {day} {hour} {minute} {second}
  {host} this machine's host name   {user} local part of your email
  A leading ~ expands to your home directory; missing folders are created.

An existing file is never replaced unless --overwrite is given; otherwise
-1, -2, ... is added before the extension. The file is written with mode 0600.
Exit code is 0 on success and 1 on any failure.

Examples:
  $ vaultcli backup
  $ vaultcli backup -o "~/backups/{year}/{month}/vault-{datetime}.zip"
  $ VAULTCLI_BACKUP_PASSWORD=... vaultcli backup -o "/srv/backups/vault-{host}-{date}.zip" --json
  $ vaultcli backup --password-file ~/.vault-backup-pw --include-versions --no-attachments
`,
    )
    .action(async (opts: BackupOptions, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const result = await runBackup({ ...opts, verbose: cmd.optsWithGlobals().verbose === true }, output);
        output.result(
          result,
          (r) => {
            success('Backup saved.');
            keyValue('Path', r.path);
            keyValue('Size', `${formatBytes(r.size)} (${r.size} bytes)`);
            keyValue('Secrets', r.secrets === null ? 'unknown' : String(r.secrets));
            keyValue(
              'Attachments',
              r.includeAttachments ? (r.attachments === null ? 'unknown' : String(r.attachments)) : 'excluded',
            );
            keyValue('Versions', r.includeVersions ? 'all' : 'current only');
            console.log('');
            warn('Keep the password safe: without it the file cannot be opened. There is no recovery.');
          },
          (r) => console.log(r.path),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'backup_failed');
        process.exit(1);
      }
    });
}
