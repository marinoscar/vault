/**
 * `vaultcli admin backups ...`: the admin-scheduled system backups of the
 * server (`/api/admin/backups`). Reads need `system_settings:read`; changes,
 * runs, downloads and deletes need `system_settings:write`.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { OutputManager, info, keyValue, success, warn } from '../utils/output.js';
import type { OutputMode } from '../utils/types.js';
import {
  deleteAdminBackupRun,
  findAdminBackupRun,
  getAdminBackupSchedule,
  listAdminBackupRuns,
  putAdminBackupSchedule,
  startAdminBackupRun,
} from '../lib/api-client.js';
import {
  ADMIN_CONTENT_KEYS,
  PASSWORD_LOSS_WARNING,
  PASSWORD_WARNING,
  SCHEDULE_INTERVAL_HOURS,
  describeAdminContents,
  describeRunContents,
  describeRunCounts,
  describeSchedule,
  formatWhen,
  hasScheduleFlags,
  mergeScheduleFlags,
  runStatusLabel,
  scheduleContents,
  scheduleDetails,
  scheduleToBody,
  shouldWarnSchedulePassword,
  validateScheduleBody,
  type AdminBackupRun,
  type AdminBackupRunList,
  type AdminBackupSchedule,
  type ScheduleFlags,
} from '../lib/admin-backups.js';
import { adminCall, downloadAdminBackup, waitForRun } from '../lib/admin-backups-runner.js';
import { assertAuthenticated, formatBytes, resolvePassword, validatePassword } from '../lib/backup-runner.js';
import { promptConfirm, promptNewPassword } from '../lib/password-prompt.js';
import { parsePositiveInt, type PasswordSource } from '../lib/backup-settings.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

/** Value of an option only when it was typed on the command line. */
function fromCli<T>(cmd: Command, name: string): T | undefined {
  return cmd.getOptionValueSource(name) === 'cli' ? (cmd.getOptionValue(name) as T) : undefined;
}

function fail(output: OutputManager, err: unknown, code: string): never {
  output.fail(err instanceof Error ? err.message : String(err), code);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

export function printSchedule(s: AdminBackupSchedule): void {
  for (const [label, value] of scheduleDetails(s)) console.log(`  ${chalk.dim((label + ':').padEnd(10))}${value}`);
}

function runSize(r: AdminBackupRun): string {
  return r.sizeBytes === null ? '-' : formatBytes(r.sizeBytes);
}

/** One table row per run, plus the error of a failed run underneath. */
export function printRunList(list: AdminBackupRunList): void {
  if (list.items.length === 0) {
    info('No backups yet.');
    return;
  }
  const head = ['ID'.padEnd(36), 'Started'.padEnd(16), 'Trigger'.padEnd(8), 'Status'.padEnd(19), 'Size'.padStart(9), 'Counts / contents'];
  console.log('  ' + chalk.dim(head.join('  ')));
  for (const r of list.items) {
    const status = runStatusLabel(r).padEnd(19);
    const coloured = r.status === 'failed' ? chalk.red(status) : r.status === 'running' ? chalk.yellow(status) : r.deletedAt ? chalk.dim(status) : chalk.green(status);
    console.log(
      `  ${r.id}  ${formatWhen(r.startedAt).padEnd(16)}  ${r.trigger.padEnd(8)}  ${coloured}  ${runSize(r).padStart(9)}  ` +
        `${describeRunCounts(r)} ${chalk.dim('· ' + describeRunContents(r.contents))}`,
    );
    if (r.error) console.log(`  ${''.padEnd(36)}  ${chalk.red(r.error)}`);
  }
  console.log(chalk.dim(`  Page ${list.page} of ${Math.max(1, list.totalPages)} · ${list.total} backup(s)`));
}

export function printRun(r: AdminBackupRun): void {
  keyValue('ID', r.id);
  keyValue('Status', runStatusLabel(r));
  keyValue('Trigger', r.trigger + (r.triggeredBy ? ` by ${r.triggeredBy.email}` : ''));
  keyValue('Started', formatWhen(r.startedAt));
  keyValue('Finished', formatWhen(r.finishedAt));
  keyValue('Size', runSize(r));
  keyValue('Counts', describeRunCounts(r));
  keyValue('Contents', describeRunContents(r.contents));
  if (r.error) keyValue('Error', chalk.red(r.error));
}

// ---------------------------------------------------------------------------
// schedule set
// ---------------------------------------------------------------------------

function scheduleFlags(cmd: Command): ScheduleFlags {
  const enable = fromCli<boolean>(cmd, 'enable');
  const disable = fromCli<boolean>(cmd, 'disable');
  if (enable && disable) throw new Error('Use either --enable or --disable, not both');
  const flags: ScheduleFlags = {
    enabled: enable ? true : disable ? false : undefined,
    frequency: fromCli<string>(cmd, 'frequency'),
    every: fromCli<string>(cmd, 'every'),
    at: fromCli<string>(cmd, 'at'),
    day: fromCli<string>(cmd, 'day'),
    dayOfMonth: fromCli<string>(cmd, 'dayOfMonth'),
    timezone: fromCli<string>(cmd, 'timezone'),
    keep: fromCli<string>(cmd, 'keep'),
    contents: fromCli<string>(cmd, 'contents'),
    secrets: fromCli<boolean>(cmd, 'secrets'),
    attachments: fromCli<boolean>(cmd, 'attachments'),
    includeVersions: fromCli<boolean>(cmd, 'includeVersions'),
    media: fromCli<boolean>(cmd, 'media'),
    system: fromCli<boolean>(cmd, 'system'),
  };
  return flags;
}

function schedulePasswordSource(cmd: Command): PasswordSource | null {
  const prompt = fromCli<boolean>(cmd, 'passwordPrompt') === true;
  const env = fromCli<string>(cmd, 'passwordEnv');
  const file = fromCli<string>(cmd, 'passwordFile');
  const given = [prompt, env !== undefined, file !== undefined].filter(Boolean).length;
  if (given > 1) throw new Error('Use only one of --password-prompt, --password-env and --password-file');
  if (prompt) return { kind: 'prompt' };
  if (env !== undefined) return { kind: 'env', name: env, from: 'flag' };
  if (file !== undefined) return { kind: 'file', path: file, from: 'flag' };
  return null;
}

async function scheduleSet(cmd: Command, output: OutputManager): Promise<void> {
  const flags = scheduleFlags(cmd);
  const pwSource = schedulePasswordSource(cmd);
  if (!hasScheduleFlags(flags) && !pwSource) {
    throw new Error('Nothing to change. Pass at least one option (see: vaultcli admin backups schedule set --help)');
  }
  if (pwSource?.kind === 'prompt' && !process.stdin.isTTY) {
    throw new Error('--password-prompt needs a terminal; use --password-env VAR or --password-file <path> instead');
  }
  assertAuthenticated();

  const current = await adminCall(() => getAdminBackupSchedule());
  const body = mergeScheduleFlags(scheduleToBody(current), flags);
  const ctx = { passwordConfigured: current.passwordConfigured, storageConfigured: current.storageConfigured };

  // Check everything but the password before asking for one.
  const pre = validateScheduleBody(pwSource ? { ...body, password: 'x'.repeat(6) } : body, ctx);
  if (pre.length) throw new Error(pre.length === 1 ? pre[0] : `Invalid schedule:\n  - ${pre.join('\n  - ')}`);

  if (pwSource) {
    if (pwSource.kind === 'prompt') {
      output.humanOnly(() =>
        process.stderr.write(chalk.dim(`Choose the password for scheduled backups (at least 6 characters). ${PASSWORD_LOSS_WARNING}\n`)),
      );
    }
    body.password = await resolvePassword(pwSource, {
      interactive: process.stdin.isTTY === true,
      prompt: () => promptNewPassword(validatePassword),
      warn: (m) => output.humanOnly(() => warn(m)),
    });
    if (shouldWarnSchedulePassword(body.password)) output.humanOnly(() => warn(PASSWORD_WARNING));
    const post = validateScheduleBody(body, ctx);
    if (post.length) throw new Error(post[0]);
  }

  const saved = await adminCall(() => putAdminBackupSchedule(body));
  output.result(
    { schedule: saved, summary: describeSchedule(saved), passwordChanged: body.password !== undefined },
    () => {
      success('Backup schedule saved.');
      printSchedule(saved);
      if (body.password !== undefined) {
        console.log('');
        warn(PASSWORD_LOSS_WARNING);
      }
    },
    () => console.log(describeSchedule(saved)),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAdminCommands(program: Command): void {
  const admin = program.command('admin').description('Administrator commands (need an administrator account)');

  const backups = admin
    .command('backups')
    .description(
      'Server backups of every user\'s vault data: the schedule, run now, history, download and delete. ' +
        'Reads need system_settings:read; everything else needs system_settings:write.',
    )
    .addHelpText(
      'after',
      `
Examples:
  $ vaultcli admin backups schedule show
  $ vaultcli admin backups schedule set --enable --frequency daily --at 03:00 --timezone America/Chicago --keep 14
  $ vaultcli admin backups schedule set --frequency weekly --day sun --at 02:30 --password-prompt
  $ vaultcli admin backups schedule set --contents secrets,attachments,system
  $ vaultcli admin backups run --wait
  $ vaultcli admin backups list
  $ vaultcli admin backups download <id> -o ~/backups/
  $ vaultcli admin backups delete <id> --yes
`,
    );

  // ---- schedule ------------------------------------------------------------
  const schedule = backups.command('schedule').description('Show or change the server backup schedule');

  schedule
    .command('show')
    .description('Show the schedule in plain words, the next and last run, and whether a password and storage are configured')
    .option('--json', 'Machine-readable result')
    .action(async (_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertAuthenticated();
        const s = await adminCall(() => getAdminBackupSchedule());
        output.result(
          { schedule: s, summary: describeSchedule(s), contents: describeAdminContents(scheduleContents(s)) },
          () => {
            info('Server backup schedule');
            printSchedule(s);
          },
          () => console.log(describeSchedule(s)),
        );
      } catch (err) {
        fail(output, err, 'admin_backups_failed');
      }
    });

  schedule
    .command('set')
    .description('Change the schedule: reads the current one, applies the options given, saves the whole schedule')
    .option('--enable', 'Turn scheduled backups on (needs a password and configured storage)')
    .option('--disable', 'Turn scheduled backups off')
    .option('--frequency <f>', 'hourly | daily | weekly | monthly')
    .option('--every <hours>', `Hourly only: run every N hours (${SCHEDULE_INTERVAL_HOURS.join(', ')})`)
    .option('--at <HH:mm>', 'Daily, weekly, monthly: local time of day (24h)')
    .option('--day <day>', 'Weekly only: mon..sun or 0-6 (0 = Sunday)')
    .option('--day-of-month <n>', 'Monthly only: 1-28')
    .option('--timezone <IANA>', 'Time zone of the schedule, e.g. America/Chicago or UTC')
    .option('--keep <n>', 'How many successful backups to keep (1-365)')
    .option('--contents <list>', `What to back up, comma separated: ${ADMIN_CONTENT_KEYS.join('|')} (overrides the flags below)`)
    .option('--secrets', 'Include every user\'s secrets')
    .option('--no-secrets', 'Exclude secrets (and their attachments and versions)')
    .option('--attachments', 'Include secret attachments (needs secrets)')
    .option('--no-attachments', 'Exclude secret attachments')
    .option('--include-versions', 'Include old secret versions (needs secrets)')
    .option('--no-include-versions', 'Only current secret versions')
    .option('--media', 'Include every user\'s media library')
    .option('--no-media', 'Exclude the media library')
    .option('--system', 'Include system configuration (users and roles, allowlist, custom secret types, settings)')
    .option('--no-system', 'Exclude system configuration')
    .option('--password-prompt', 'Set a new backup password, typed twice at a hidden prompt')
    .option('--password-env <VAR>', 'Set a new backup password read from this environment variable')
    .option('--password-file <path>', 'Set a new backup password read from a file (first line, trimmed)')
    .option('--json', 'Machine-readable result')
    .addHelpText(
      'after',
      `
Only the options given change; the rest keep their current values. Fields a
frequency does not use are cleared. The password is sent only when a password
option is given; otherwise the stored one is kept. It is never shown again.

Contents (default for a new schedule: secrets with attachments):
  secrets      every user's current secret values
  attachments  files attached to secrets (needs secrets)
  versions     old secret versions (needs secrets)
  media        every user's media library
  system       users and roles, allowlist, custom secret types, system settings
  At least one of secrets, media or system must be selected.

Examples:
  $ vaultcli admin backups schedule set --enable --frequency hourly --every 6
  $ vaultcli admin backups schedule set --frequency monthly --day-of-month 1 --at 04:00
  $ VAULT_BACKUP_PW=... vaultcli admin backups schedule set --password-env VAULT_BACKUP_PW --enable
  $ vaultcli admin backups schedule set --media --system --keep 30
`,
    )
    .action(async (_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        await scheduleSet(cmd, output);
      } catch (err) {
        fail(output, err, 'admin_backups_failed');
      }
    });

  // ---- run -----------------------------------------------------------------
  backups
    .command('run')
    .description('Start a backup now (with --wait, follow it until it finishes; exit 1 if it fails)')
    .option('--wait', 'Poll every 5 seconds until the backup finishes')
    .option('--json', 'Machine-readable result')
    .action(async (opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertAuthenticated();
        let run = await adminCall(() => startAdminBackupRun(), 'run');
        if (!opts.wait) {
          output.result(
            run,
            () => {
              success('Backup started.');
              keyValue('ID', run.id);
              console.log(chalk.dim(`  Follow it with: vaultcli admin backups list (or run again with --wait)`));
            },
            () => console.log(run.id),
          );
          return;
        }
        output.humanOnly(() => process.stderr.write(chalk.dim(`Backup ${run.id} started; checking every 5 s...\n`)));
        run = await waitForRun(run.id, {
          onTick: (r, ms) => {
            if (r.status === 'running') output.humanOnly(() => process.stderr.write(chalk.dim(`  running (${Math.round(ms / 1000)} s)\n`)));
          },
        });
        const ok = run.status === 'succeeded';
        if (output.mode === 'json') {
          process.stdout.write(JSON.stringify({ success: ok, data: run }) + '\n');
        } else if (output.mode === 'quiet') {
          console.log(`${run.id} ${run.status}`);
        } else {
          if (ok) success('Backup finished.');
          else console.log(chalk.red('Backup failed.'));
          printRun(run);
        }
        if (!ok) process.exit(1);
      } catch (err) {
        fail(output, err, 'admin_backups_failed');
      }
    });

  // ---- list ----------------------------------------------------------------
  backups
    .command('list')
    .description('List backups, newest first: started, trigger, status, size, counts and contents')
    .option('--page <n>', 'Page number (default 1)')
    .option('--page-size <n>', 'Backups per page (1-100, default 20)')
    .option('--json', 'Machine-readable result')
    .action(async (opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const page = opts.page !== undefined ? parsePositiveInt(opts.page, '--page') : undefined;
        const pageSize = opts.pageSize !== undefined ? parsePositiveInt(opts.pageSize, '--page-size') : undefined;
        if (pageSize !== undefined && pageSize > 100) throw new Error('--page-size must be at most 100');
        assertAuthenticated();
        const list = await adminCall(() => listAdminBackupRuns({ page, pageSize }));
        output.result(list, () => printRunList(list), () => list.items.forEach((r) => console.log(r.id)));
      } catch (err) {
        fail(output, err, 'admin_backups_failed');
      }
    });

  // ---- download ------------------------------------------------------------
  backups
    .command('download')
    .description('Download a backup archive (AES-256 zip) to a file with mode 0600')
    .argument('<id>', 'Backup id (from: vaultcli admin backups list)')
    .option('-o, --output <path>', 'File to write, or a folder to put it in (default: the server\'s file name in the current folder)')
    .option('--overwrite', 'Replace an existing file instead of adding a -1, -2 ... suffix')
    .option('--json', 'Machine-readable result')
    .addHelpText(
      'after',
      `
The archive is written to <path>.partial and renamed when complete; an
interrupted download leaves nothing behind. Open it with 7-Zip or Keka using the
schedule's backup password.
`,
    )
    .action(async (id: string, opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertAuthenticated();
        const result = await downloadAdminBackup({
          id,
          output: opts.output,
          overwrite: opts.overwrite === true,
          progress: (m) => output.humanOnly(() => process.stderr.write(chalk.dim(m + '\n'))),
        });
        output.result(
          result,
          () => {
            success('Backup downloaded.');
            keyValue('Path', result.path);
            keyValue('Size', `${formatBytes(result.size)} (${result.size} bytes)`);
          },
          () => console.log(result.path),
        );
      } catch (err) {
        fail(output, err, 'admin_backups_failed');
      }
    });

  // ---- delete --------------------------------------------------------------
  backups
    .command('delete')
    .description('Delete a backup archive from storage (the run stays in the history)')
    .argument('<id>', 'Backup id (from: vaultcli admin backups list)')
    .option('-y, --yes', 'Do not ask for confirmation (required when not run in a terminal)')
    .option('--json', 'Machine-readable result')
    .action(async (id: string, opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertAuthenticated();
        if (opts.yes !== true) {
          if (!process.stdin.isTTY) {
            throw new Error('Refusing to delete a backup without confirmation: not a terminal. Pass --yes.');
          }
          const run = await adminCall(() => findAdminBackupRun(id)).catch(() => null);
          if (run) {
            process.stderr.write(
              `Backup ${run.id}: ${formatWhen(run.startedAt)}, ${runStatusLabel(run)}, ${runSize(run)}\n`,
            );
          }
          const ok = await promptConfirm('Delete this backup from storage? It cannot be undone. [y/N] ');
          if (!ok) {
            output.result({ id, deleted: false, cancelled: true }, () => info('Cancelled; nothing deleted.'), () => undefined);
            return;
          }
        }
        await adminCall(() => deleteAdminBackupRun(id), 'delete');
        output.result({ id, deleted: true }, () => success(`Backup ${id} deleted.`), () => console.log(id));
      } catch (err) {
        fail(output, err, 'admin_backups_failed');
      }
    });
}
