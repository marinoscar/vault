import { homedir } from 'os';
import { isAbsolute, resolve as resolvePath } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { OutputManager, keyValue, success, warn, info } from '../utils/output.js';
import { BACKUP_FILENAME_TOKENS, DEFAULT_BACKUP_TEMPLATE, expandBackupFilename } from '../lib/backup-filename.js';
import { promptConfirm, promptNewPassword } from '../lib/password-prompt.js';
import {
  BACKUP_SETTING_KEYS,
  DEFAULT_PASSWORD_ENV,
  assertValidTemplate,
  choosePasswordSource,
  getBackupSettingsPath,
  loadBackupSettings,
  normalizeSettingKey,
  parsePositiveInt,
  resetBackupSettings,
  resolveBackupSettings,
  saveBackupSettings,
  unsetBackupSettings,
  type BackupSettingKey,
  type BackupSettings,
} from '../lib/backup-settings.js';
import {
  assertAuthenticated,
  formatBytes,
  performBackup,
  resolvePassword,
  runPrune,
  validatePassword,
  type BackupResult,
  type PruneOutcome,
} from '../lib/backup-runner.js';
import { formatAge, retentionEnabled } from '../lib/backup-retention.js';
import type { OutputMode } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

/**
 * Value of an option only when it was given on the command line. Looks at the
 * command and then `backup` above it: commander lets the parent `backup`
 * command consume options it shares with `backup prune` / `backup config set`
 * (the root program is not positional, so global flags work anywhere).
 */
function fromCli<T>(cmd: Command, name: string): T | undefined {
  for (let c: Command | null = cmd; c; c = c.parent) {
    if (c.getOptionValueSource(name) === 'cli') return c.getOptionValue(name) as T;
    if (c.name() === 'backup') break;
  }
  return undefined;
}

/**
 * Reject options typed for a subcommand that only `backup` itself accepts
 * (e.g. `backup prune --password x`), since the parent consumed them.
 */
function assertOnlyOptions(cmd: Command, allowed: string[]): void {
  let parent: Command | null = cmd.parent;
  while (parent && parent.name() !== 'backup') parent = parent.parent;
  if (!parent || parent === cmd) return;
  const allowedSet = new Set([...allowed, 'json']);
  for (const opt of parent.options) {
    const key = opt.attributeName();
    if (parent.getOptionValueSource(key) === 'cli' && !allowedSet.has(key)) {
      const names: string[] = [];
      for (let c: Command | null = cmd; c && c !== parent; c = c.parent) names.unshift(c.name());
      throw new Error(`Option ${opt.long ?? opt.flags} is not valid for "vaultcli backup ${names.join(' ')}" (see --help)`);
    }
  }
}

function expandHome(p: string): string {
  return p === '~' || /^~[\\/]/.test(p) ? homedir() + p.slice(1) : p;
}

/**
 * Settings given as flags on `backup`, `backup prune` or `backup config set`.
 * Only options actually typed are returned, so saved settings can fill the rest.
 */
function settingsFlags(cmd: Command): BackupSettings {
  const flags: BackupSettings = {};
  const output = fromCli<string>(cmd, 'output');
  if (output !== undefined) {
    assertValidTemplate(output);
    flags.output = output;
  }
  const passwordEnv = fromCli<string>(cmd, 'passwordEnv');
  if (passwordEnv !== undefined) flags.passwordEnv = passwordEnv;
  const passwordFile = fromCli<string>(cmd, 'passwordFile');
  if (passwordFile !== undefined) flags.passwordFile = passwordFile;
  const attachments = fromCli<boolean>(cmd, 'attachments');
  if (attachments !== undefined) flags.includeAttachments = attachments;
  const includeVersions = fromCli<boolean>(cmd, 'includeVersions');
  if (includeVersions !== undefined) flags.includeVersions = includeVersions;
  const utc = fromCli<boolean>(cmd, 'utc');
  if (utc !== undefined) flags.utc = utc;
  const keepDays = fromCli<string>(cmd, 'keepDays');
  if (keepDays !== undefined) flags.keepDays = parsePositiveInt(keepDays, '--keep-days');
  const keepLast = fromCli<string>(cmd, 'keepLast');
  if (keepLast !== undefined) flags.keepLast = parsePositiveInt(keepLast, '--keep-last');
  return flags;
}

function pruneJson(p: PruneOutcome | { error: string } | null) {
  if (!p) return null;
  if ('error' in p) return { dryRun: false, deleted: [], wouldDelete: [], kept: 0, errors: [{ path: null, error: p.error }] };
  return {
    dryRun: p.dryRun,
    root: p.root,
    keepDays: p.keepDays,
    keepLast: p.keepLast,
    deleted: p.deleted,
    wouldDelete: p.dryRun ? p.planned.map((f) => f.path) : [],
    kept: p.kept,
    errors: p.errors,
  };
}

/** Print a retention outcome for humans. */
export function printPruneOutcome(p: PruneOutcome, now = Date.now()): void {
  const limits = [
    p.keepDays !== null ? `older than ${p.keepDays} day(s)` : null,
    p.keepLast !== null ? `beyond the newest ${p.keepLast}` : null,
  ]
    .filter(Boolean)
    .join(' or ');
  if (p.planned.length === 0) {
    info(`Retention: nothing to delete (${limits}); ${p.kept} backup(s) kept in ${p.root}`);
    return;
  }
  if (p.dryRun) {
    info(`Retention (dry run): would delete ${p.planned.length} backup(s) ${limits}:`);
    for (const f of p.planned) console.log(`  ${f.path}  ${chalk.dim(`${formatBytes(f.size)}, ${formatAge(now - f.mtimeMs)} old`)}`);
  } else {
    if (p.deleted.length) {
      success(`Retention: deleted ${p.deleted.length} old backup(s) ${limits}:`);
      for (const d of p.deleted) console.log(`  ${d}`);
    }
  }
  console.log(`  ${chalk.dim(`${p.kept} backup(s) kept`)}`);
  for (const e of p.errors) warn(`  Could not delete ${e.path}: ${e.error}`);
}

interface RunOutput {
  backup: BackupResult;
  prune: ReturnType<typeof pruneJson>;
}

async function runBackupCommand(cmd: Command, output: OutputManager): Promise<boolean> {
  const opts = cmd.opts();
  const flags = settingsFlags(cmd);
  const saved = loadBackupSettings();
  const { settings } = resolveBackupSettings(flags, saved);
  const verbose = cmd.optsWithGlobals().verbose === true;

  const now = new Date();
  // Validate the template (unknown tokens) before asking for a password.
  expandBackupFilename(settings.output, now, { utc: settings.utc, host: 'h', user: 'u', homeDir: homedir() });
  assertAuthenticated();

  const source = choosePasswordSource({ ...flags, password: opts.password as string | undefined }, saved, process.env);
  if (source.kind === 'prompt' && process.stdin.isTTY) {
    output.humanOnly(() =>
      process.stderr.write(
        chalk.dim('Choose a password for the backup file (at least 6 characters). ' +
          'Without it the file cannot be opened; there is no recovery.\n'),
      ),
    );
  }
  const password = await resolvePassword(source, {
    interactive: process.stdin.isTTY === true,
    prompt: () => promptNewPassword(validatePassword),
    warn: (m) => output.humanOnly(() => warn(m)),
  });

  const result = await performBackup({
    settings,
    password,
    overwrite: opts.overwrite === true,
    now,
    progress: (m) => output.humanOnly(() => process.stderr.write(chalk.dim(m + '\n'))),
    verbose: (m) => {
      if (verbose) output.verbose(m);
    },
    onInterrupt: (signal) => {
      output.fail(`Backup interrupted (${signal}); partial file removed`, 'interrupted');
      process.exit(130);
    },
  });

  // Retention runs only after a successful backup and never fails the run.
  let prune: PruneOutcome | { error: string } | null = null;
  const pruneDisabled = opts.prune === false;
  if (!pruneDisabled && retentionEnabled(settings)) {
    try {
      prune = runPrune({
        template: settings.output,
        keepDays: settings.keepDays,
        keepLast: settings.keepLast,
        protect: [result.path],
        dryRun: opts.pruneDryRun === true,
      });
    } catch (err) {
      prune = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  output.result<RunOutput>(
    { backup: result, prune: pruneJson(prune) },
    () => {
      printBackupResult(result);
      if (prune && 'error' in prune) warn(`Retention failed (backup kept): ${prune.error}`);
      else if (prune) printPruneOutcome(prune);
      else if (pruneDisabled && retentionEnabled(settings)) info('Retention skipped (--no-prune).');
      console.log('');
      warn('Keep the password safe: without it the file cannot be opened. There is no recovery.');
    },
    () => console.log(result.path),
  );
  if (output.mode === 'quiet' && prune) {
    if ('error' in prune) process.stderr.write(`Retention failed: ${prune.error}\n`);
    else for (const e of prune.errors) process.stderr.write(`Retention: could not delete ${e.path}: ${e.error}\n`);
  }
  return true;
}

export function printBackupResult(r: BackupResult): void {
  success('Backup saved.');
  keyValue('Path', r.path);
  keyValue('Size', `${formatBytes(r.size)} (${r.size} bytes)`);
  keyValue('Secrets', r.secrets === null ? 'unknown' : String(r.secrets));
  keyValue('Attachments', r.includeAttachments ? (r.attachments === null ? 'unknown' : String(r.attachments)) : 'excluded');
  keyValue('Versions', r.includeVersions ? 'all' : 'current only');
}

function describeValue(key: BackupSettingKey, value: unknown): string {
  if (value === undefined) {
    if (key === 'keepDays' || key === 'keepLast') return chalk.dim('off');
    if (key === 'passwordEnv') return chalk.dim(`(${DEFAULT_PASSWORD_ENV} if set)`);
    return chalk.dim('-');
  }
  return String(value);
}

export function registerBackupCommands(program: Command): void {
  const tokenList = BACKUP_FILENAME_TOKENS.map((t) => `{${t}}`).join(' ');

  const backup = program
    .command('backup')
    .description(
      'Download a password-protected (AES-256 zip) backup of the secrets you own, ' +
        'including decrypted values and attachments. Open it with 7-Zip (Windows), ' +
        'Keka / The Unarchiver (macOS) or 7z / file-roller (Linux).',
    )
    .option('-o, --output <template>', `Output path template (default "${DEFAULT_BACKUP_TEMPLATE}"). Tokens: ${tokenList}`)
    .option('--password-env <VAR>', `Read the password from this environment variable (default ${DEFAULT_PASSWORD_ENV})`)
    .option('--password-file <path>', 'Read the password from a file (first line, trimmed)')
    .option('-p, --password <pw>', 'Password on the command line (visible in the process list and shell history)')
    .option('--attachments', 'Include attachments (default)')
    .option('--no-attachments', 'Exclude attachments')
    .option('--include-versions', 'Include all versions, not only the current one')
    .option('--no-include-versions', 'Only current versions (overrides a saved setting)')
    .option('--overwrite', 'Replace an existing file instead of adding a -1, -2 ... suffix')
    .option('--utc', 'Use UTC for date/time tokens (default: local time)')
    .option('--no-utc', 'Use local time (overrides a saved setting)')
    .option('--keep-days <n>', 'After a successful backup, delete backups older than n days')
    .option('--keep-last <n>', 'After a successful backup, keep only the n newest backups')
    .option('--no-prune', 'Skip retention for this run, even if saved settings enable it')
    .option('--prune-dry-run', 'Show what retention would delete, without deleting')
    .option('--json', 'Machine-readable result')
    .addHelpText(
      'after',
      `
Settings: flags override saved settings (vaultcli backup config ...), which
override the defaults. Saved settings live in ${'<config dir>'}/backup.json.

Password resolution order:
  --password, --password-file, --password-env, saved passwordFile, saved
  passwordEnv, $${DEFAULT_PASSWORD_ENV}, then a hidden prompt (with confirmation)
  when stdin is a terminal. Non-interactive runs without a password fail instead
  of waiting. Minimum 6 characters. The password is never saved in settings.

Template tokens:
  {date} YYYY-MM-DD   {time} HHmmss   {datetime} YYYY-MM-DD_HHmmss
  {timestamp} unix seconds   {year} {month} {day} {hour} {minute} {second}
  {host} this machine's host name   {user} local part of your email
  A leading ~ expands to your home directory; missing folders are created.

Retention (off unless --keep-days / --keep-last or saved settings set it):
  runs only after a successful backup; a backup is deleted when it is older
  than keep-days OR outside the keep-last newest. Only files matching the
  output template are considered; the newest backup and the one just written
  are always kept. A failed cleanup is reported but does not fail the backup.

An existing file is never replaced unless --overwrite is given; otherwise
-1, -2, ... is added before the extension. The file is written with mode 0600.
Exit code: 0 on success, 1 on failure, 130 when interrupted.

Examples:
  $ vaultcli backup
  $ vaultcli backup -o "~/backups/{year}/{month}/vault-{datetime}.zip" --keep-days 30
  $ VAULTCLI_BACKUP_PASSWORD=... vaultcli backup -o "/srv/backups/vault-{host}-{date}.zip" --json
  $ vaultcli backup config set --output "~/backups/vault-{datetime}.zip" --password-file ~/.vault-pw --keep-last 10
  $ vaultcli backup prune --dry-run
`,
    )
    .action(async (_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        await runBackupCommand(cmd, output);
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'backup_failed');
        process.exit(1);
      }
    });

  // vaultcli backup prune
  backup
    .command('prune')
    .description('Delete old backups by the retention rules, without making a new backup')
    .option('-o, --output <template>', 'Output path template the backups were written with (default: saved setting)')
    .option('--keep-days <n>', 'Delete backups older than n days')
    .option('--keep-last <n>', 'Keep only the n newest backups')
    .option('--dry-run', 'Only show what would be deleted')
    .option('-y, --yes', 'Do not ask for confirmation (required when not run in a terminal)')
    .option('--json', 'Machine-readable result')
    .addHelpText(
      'after',
      `
Only regular files whose path matches the output template are considered
(other files, .partial downloads and symlinks are never touched). The newest
matching backup is always kept. Limits default to the saved settings.
Exit code is 1 if any file could not be deleted.

Examples:
  $ vaultcli backup prune --keep-days 30 --dry-run
  $ vaultcli backup prune --yes        ${chalk.dim('# scheduled, using saved settings')}
`,
    )
    .action(async (opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, ['output', 'keepDays', 'keepLast']);
        const flags = settingsFlags(cmd);
        const { settings } = resolveBackupSettings(flags, loadBackupSettings());
        const dryRun = opts.dryRun === true;

        if (!dryRun && opts.yes !== true) {
          // Preview first, then confirm (or refuse when nobody can answer).
          const preview = runPrune({ template: settings.output, keepDays: settings.keepDays, keepLast: settings.keepLast, dryRun: true });
          if (preview.planned.length === 0) {
            output.result(pruneJson(preview), () => printPruneOutcome(preview), () => undefined);
            return;
          }
          if (!process.stdin.isTTY) {
            throw new Error(
              `Refusing to delete ${preview.planned.length} backup(s) without confirmation: not a terminal. ` +
                'Pass --yes (or --dry-run to preview).',
            );
          }
          output.humanOnly(() => printPruneOutcome(preview));
          const ok = await promptConfirm(`Delete ${preview.planned.length} backup(s)? [y/N] `);
          if (!ok) {
            output.result({ ...pruneJson(preview), cancelled: true }, () => info('Cancelled; nothing deleted.'), () => undefined);
            return;
          }
        }

        const outcome = runPrune({ template: settings.output, keepDays: settings.keepDays, keepLast: settings.keepLast, dryRun });
        if (output.mode === 'json') {
          const envelope = { success: outcome.errors.length === 0, data: pruneJson(outcome) };
          process.stdout.write(JSON.stringify(envelope) + '\n');
        } else if (output.mode === 'quiet') {
          for (const p of dryRun ? outcome.planned.map((f) => f.path) : outcome.deleted) console.log(p);
          for (const e of outcome.errors) process.stderr.write(`could not delete ${e.path}: ${e.error}\n`);
        } else {
          printPruneOutcome(outcome);
        }
        if (outcome.errors.length > 0) process.exit(1);
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'prune_failed');
        process.exit(1);
      }
    });

  // vaultcli backup config ...
  const cfg = backup.command('config').description('Show or change saved backup settings (backup.json)');

  cfg
    .command('show')
    .description('Show saved and effective backup settings')
    .option('--json', 'Machine-readable result')
    .action((_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        const saved = loadBackupSettings();
        const { settings, sources } = resolveBackupSettings({}, saved);
        const file = getBackupSettingsPath();
        output.result(
          { file, saved, effective: settings, sources },
          () => {
            info(`Backup settings (${file}${Object.keys(saved).length ? '' : ', not saved yet'})`);
            for (const key of BACKUP_SETTING_KEYS) {
              const src = sources[key] === 'saved' ? chalk.green('saved') : chalk.dim(sources[key] === 'default' ? 'default' : '');
              console.log(`  ${chalk.dim((key + ':').padEnd(20))} ${describeValue(key, settings[key])} ${src}`);
            }
            console.log('');
            info(`Retention: ${retentionEnabled(settings) ? 'on' : 'off'}`);
          },
          () => console.log(JSON.stringify(saved)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'config_failed');
        process.exit(1);
      }
    });

  cfg
    .command('set')
    .description('Save backup settings (only the options given are changed; the password is never saved)')
    .option('-o, --output <template>', 'Output path template')
    .option('--password-env <VAR>', 'Read the password from this environment variable')
    .option('--password-file <path>', 'Read the password from this file (stored as an absolute path)')
    .option('--attachments', 'Include attachments')
    .option('--no-attachments', 'Exclude attachments')
    .option('--include-versions', 'Include all versions')
    .option('--no-include-versions', 'Only current versions')
    .option('--utc', 'Use UTC for date/time tokens')
    .option('--no-utc', 'Use local time for date/time tokens')
    .option('--keep-days <n>', 'Retention: delete backups older than n days (unset to turn off)')
    .option('--keep-last <n>', 'Retention: keep only the n newest backups (unset to turn off)')
    .option('--json', 'Machine-readable result')
    .action((_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, ['output', 'passwordEnv', 'passwordFile', 'attachments', 'includeVersions', 'utc', 'keepDays', 'keepLast']);
        const changes = settingsFlags(cmd);
        if (Object.keys(changes).length === 0) {
          throw new Error('Nothing to set. Pass at least one option (see: vaultcli backup config set --help)');
        }
        if (changes.passwordFile !== undefined) changes.passwordFile = resolvePath(expandHome(changes.passwordFile));
        let next: BackupSettings = { ...loadBackupSettings(), ...changes };
        // One password source at a time: setting one replaces the other.
        if (changes.passwordFile !== undefined && changes.passwordEnv === undefined) next = unsetBackupSettings(next, ['passwordEnv']);
        if (changes.passwordEnv !== undefined && changes.passwordFile === undefined) next = unsetBackupSettings(next, ['passwordFile']);
        const file = saveBackupSettings(next);
        output.result(
          { file, saved: next },
          () => {
            success(`Saved ${Object.keys(changes).join(', ')} to ${file}`);
            if (changes.output && !isAbsolute(expandHome(changes.output))) {
              warn('Note: the output path is relative; it is resolved against the folder vaultcli runs in.');
            }
          },
          () => console.log(file),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'config_failed');
        process.exit(1);
      }
    });

  cfg
    .command('unset')
    .description(`Remove saved settings. Keys: ${BACKUP_SETTING_KEYS.join(', ')} (kebab-case also accepted)`)
    .argument('<key...>', 'Setting keys to remove')
    .option('--json', 'Machine-readable result')
    .action((keys: string[], _opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        const normalized: BackupSettingKey[] = [];
        for (const k of keys) {
          const n = normalizeSettingKey(k);
          if (!n) throw new Error(`Unknown setting "${k}". Valid keys: ${BACKUP_SETTING_KEYS.join(', ')}`);
          normalized.push(n);
        }
        const next = unsetBackupSettings(loadBackupSettings(), normalized);
        const file = saveBackupSettings(next);
        output.result({ file, saved: next }, () => success(`Removed ${normalized.join(', ')} from ${file}`), () => console.log(file));
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'config_failed');
        process.exit(1);
      }
    });

  cfg
    .command('reset')
    .description('Delete all saved backup settings')
    .option('--json', 'Machine-readable result')
    .action((_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        const removed = resetBackupSettings();
        const file = getBackupSettingsPath();
        output.result(
          { file, removed },
          () => success(removed ? `Removed ${file}` : 'No saved backup settings.'),
          () => console.log(removed ? 'removed' : 'none'),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'config_failed');
        process.exit(1);
      }
    });
}

