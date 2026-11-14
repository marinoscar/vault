import { homedir } from 'os';
import { Command } from 'commander';
import chalk from 'chalk';

import { info, keyValue, success, warn } from '../utils/output.js';
import { config } from '../utils/config.js';
import { promptConfirm } from '../lib/password-prompt.js';
import {
  buildCronLine,
  getScheduleStatus,
  hasBlockingIssue,
  installSchedule,
  presetFromFlags,
  presetToCron,
  removeSchedule,
  schedulePreflight,
  supportsCrontab,
  type PreflightIssue,
  type ScheduleFlags,
} from '../lib/backup-schedule.js';
import { describeCron, nextRuns } from '../lib/cron.js';
import {
  ago,
  collectBackupStatus,
  collectPreflightInput,
  currentCronCommand,
  ensureLogFile,
  formatBytes,
  getBackupLogPath,
  inTime,
  localStamp,
  type BackupStatus,
} from '../lib/backup-status.js';
import { DEFAULT_PASSWORD_ENV, PASSWORD_ENV_ALIAS, loadBackupSettings, resolveBackupSettings } from '../lib/backup-settings.js';
import { buildScheduleInstructions, describeRetention } from '../interactive/logic.js';
import { assertOnlyOptions, getOutput } from './backup.js';

// =============================================================================
// vault backup status · vault backup schedule status|install|remove
// =============================================================================

function printIssues(issues: readonly PreflightIssue[]): void {
  for (const i of issues) {
    console.log(i.level === 'error' ? chalk.red(`  ✖ ${i.message}`) : chalk.yellow(`  ! ${i.message}`));
  }
}

function printStatus(s: BackupStatus): void {
  const now = new Date(s.generatedAt);
  info('Backups');
  const last = s.runs.last;
  if (!last) keyValue('Last backup', chalk.dim('no runs recorded yet'));
  else if (last.outcome === 'success') {
    keyValue(
      'Last backup',
      `${chalk.green('✔ succeeded')} ${ago(last.at, now)} ${chalk.dim(`(${localStamp(last.at)}, ${formatBytes(last.size ?? 0)}, ${last.trigger})`)}`,
    );
  } else {
    keyValue('Last backup', `${chalk.red('✖ failed')} ${ago(last.at, now)} ${chalk.dim(`(${localStamp(last.at)}, ${last.trigger})`)}`);
    if (s.runs.lastSuccess) keyValue('Last success', `${ago(s.runs.lastSuccess.at, now)} ${chalk.dim(`(${localStamp(s.runs.lastSuccess.at)})`)}`);
  }
  if (s.runs.recent.length > 0) {
    const marks = [...s.runs.recent].reverse().map((r) => (r.outcome === 'success' ? chalk.green('●') : chalk.red('●'))).join('');
    keyValue('Recent runs', `${marks} ${chalk.dim(`(${s.runs.recent.length} newest, oldest left)`)}`);
  }
  if (!s.schedule.supported) keyValue('Schedule', chalk.dim('not available on this OS (see vault backup schedule install)'));
  else if (!s.schedule.installed) keyValue('Schedule', chalk.yellow('not scheduled'));
  else {
    const next = s.schedule.next[0];
    keyValue('Schedule', `${s.schedule.installed.description}${next ? chalk.dim(` · next ${localStamp(next)} (${inTime(next, now)})`) : ''}`);
  }
  const f = s.files;
  if (f.count === 0) keyValue('On disk', chalk.dim(`no backups found${f.root ? ` in ${f.root}` : ''}`));
  else {
    keyValue('On disk', `${f.count} backup(s), ${formatBytes(f.totalBytes)} ${chalk.dim(`in ${f.root}`)}`);
    keyValue('Newest', `${ago(f.newest?.mtimeMs, now)}  ${chalk.dim(`oldest ${ago(f.oldest?.mtimeMs, now)}`)}`);
  }
  const { settings } = resolveBackupSettings({}, loadBackupSettings());
  keyValue(
    'Retention',
    `${describeRetention(settings)}${f.retentionOn && f.retentionWouldDelete.length ? chalk.yellow(` · ${f.retentionWouldDelete.length} would be deleted now`) : ''}`,
  );
  const tokenColor = s.token.level === 'ok' ? chalk.green : s.token.level === 'warning' ? chalk.yellow : s.token.level === 'expired' ? chalk.red : chalk.dim;
  keyValue('Token', tokenColor(s.token.expiresAt ? `${s.token.text} (${s.token.expiresAt.slice(0, 10)})` : s.token.text));
  keyValue('Log', chalk.dim(s.logFile));
  if (s.issues.length) {
    console.log('');
    printIssues(s.issues);
  }
}

/** "Next runs: <date> (in 4h)", later ones aligned under the first. */
function nextRunLine(i: number, d: Date): void {
  const text = `${localStamp(d)} ${chalk.dim(`(${inTime(d)})`)}`;
  if (i === 0) keyValue('Next runs', text);
  else console.log(`  ${' '.repeat('Next runs: '.length)}${text}`);
}

function scheduleFlags(opts: Record<string, unknown>): ScheduleFlags {
  const f: ScheduleFlags = {};
  for (const k of ['daily', 'everyHours', 'weekly', 'at', 'cron'] as const) {
    if (typeof opts[k] === 'string') f[k] = opts[k] as string;
  }
  return f;
}

function windowsInstructions(flags: ScheduleFlags): void {
  const preset = presetFromFlags(flags);
  if (preset.kind !== 'daily') {
    throw new Error('On Windows only a daily schedule can be printed (--daily HH:MM); add it to Task Scheduler yourself.');
  }
  const env: Record<string, string> = {};
  for (const k of ['VAULT_CONFIG_DIR', 'VAULTCLI_CONFIG_DIR', 'VAULT_SERVER_URL', 'VAULTCLI_SERVER_URL']) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  const ins = buildScheduleInstructions({
    platform: process.platform,
    nodePath: process.execPath,
    cliPath: process.argv[1] ?? 'vault',
    hour: preset.hour,
    minute: preset.minute,
    env,
    logPath: getBackupLogPath(),
    homeDir: homedir(),
    saved: loadBackupSettings(),
    defaultEnvSet: Boolean(process.env[DEFAULT_PASSWORD_ENV] || process.env[PASSWORD_ENV_ALIAS]),
  });
  info(ins.title);
  for (const w of ins.warnings) warn(`  ! ${w}`);
  ins.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  console.log('');
  console.log(ins.content);
}

export function registerBackupScheduleCommands(backup: Command): void {
  backup
    .command('status')
    .description('How backups are doing: last run, schedule and next run, files on disk, retention, token expiry, warnings')
    .option('--json', 'Machine-readable result')
    .action(async (_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        const status = await collectBackupStatus();
        output.result(status, printStatus, (s) => {
          const last = s.runs.last;
          console.log(last ? `${last.outcome} ${last.at}` : 'none');
        });
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'status_failed');
        process.exit(1);
      }
    });

  const schedule = backup
    .command('schedule')
    .description('Install, show or remove a scheduled backup in your crontab (Linux and macOS)')
    .addHelpText(
      'after',
      `
The schedule is one marked block in your crontab:
  # >>> vault backup (managed by vault CLI) >>>  …  # <<< vault backup <<<
Other crontab lines are never touched. The job runs "vault backup --json" with
your saved settings (vault backup config ...), using absolute paths to node and
the CLI, and appends to <config dir>/backup.log. No token or password is written
into the crontab: the run reads the saved password file and the stored token.

Examples:
  $ vault backup schedule install --daily 02:30
  $ vault backup schedule install --every-hours 6 --yes
  $ vault backup schedule install --weekly sun --at 03:00
  $ vault backup schedule install --cron "15 1 * * 1-5"
  $ vault backup schedule status
  $ vault backup schedule remove --yes
`,
    );

  schedule
    .command('status')
    .description('Show the installed schedule, its next runs and anything that would make it fail')
    .option('--json', 'Machine-readable result')
    .action(async (_opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        const status = await getScheduleStatus();
        const issues = status.installed ? schedulePreflight(collectPreflightInput(status.next[0])) : [];
        output.result(
          { ...status, next: status.next.map((d) => d.toISOString()), issues, logFile: getBackupLogPath() },
          () => {
            if (!status.supported) {
              info('Scheduling is not installed automatically on this OS; use: vault backup schedule install --daily HH:MM (prints the entry).');
              return;
            }
            if (status.error) throw new Error(status.error);
            if (!status.installed) {
              info('No backup is scheduled. Install one with: vault backup schedule install --daily 02:30');
              return;
            }
            success(`Scheduled: ${status.installed.description}`);
            if (status.installed.installedAt) keyValue('Installed', localStamp(status.installed.installedAt));
            status.next.forEach((d, i) => nextRunLine(i, d));
            keyValue('Cron', status.installed.cron);
            keyValue('Log', getBackupLogPath());
            console.log(chalk.dim(`  ${status.installed.line}`));
            if (issues.length) {
              console.log('');
              printIssues(issues);
            }
          },
          () => console.log(status.installed ? status.installed.cron : 'none'),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'schedule_failed');
        process.exit(1);
      }
    });

  schedule
    .command('install')
    .description('Install or replace the scheduled backup in your crontab')
    .option('--daily <HH:MM>', 'Every day at this time (24h, local time)')
    .option('--every-hours <n>', 'Every n hours, on the hour (1-23)')
    .option('--weekly <day>', 'Once a week on this day (sun, mon, ... or 0-6); time from --at')
    .option('--at <HH:MM>', 'Time for --weekly (default 02:30)')
    .option('--cron <expr>', 'A 5-field cron expression, e.g. "30 2 * * *"')
    .option('-y, --yes', 'Do not ask for confirmation (required when not run in a terminal)')
    .option('--force', 'Install even when the preflight finds a problem that will make the runs fail')
    .option('--json', 'Machine-readable result')
    .action(async (opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        const flags = scheduleFlags(opts as Record<string, unknown>);
        if (!supportsCrontab()) {
          windowsInstructions(flags);
          return;
        }
        const cron = presetToCron(presetFromFlags(flags));
        const command = currentCronCommand();
        const line = buildCronLine(cron, command);
        const next = nextRuns(cron, new Date(), 3);
        const issues = schedulePreflight(collectPreflightInput(next[0]));
        const blocking = hasBlockingIssue(issues);

        output.humanOnly(() => {
          info(`Schedule: ${describeCron(cron)}`);
          next.forEach((d, i) => nextRunLine(i, d));
          console.log(chalk.dim('  Crontab line:'));
          console.log(`  ${line}`);
          if (issues.length) {
            console.log('');
            printIssues(issues);
          }
          console.log('');
        });
        if (blocking && opts.force !== true) {
          throw new Error('The scheduled runs would fail (see above). Fix the problems first, or pass --force to install anyway.');
        }
        if (opts.yes !== true) {
          if (!process.stdin.isTTY || output.mode !== 'human') {
            throw new Error('Refusing to change your crontab without confirmation: pass --yes.');
          }
          const existing = await getScheduleStatus();
          const verb = existing.installed ? 'Replace the scheduled backup' : 'Install this schedule';
          if (!(await promptConfirm(`${verb} in your crontab? [y/N] `))) {
            info('Cancelled; your crontab was not changed.');
            return;
          }
        }
        ensureLogFile();
        const installed = await installSchedule(cron, command);
        output.result(
          { installed, next: next.map((d) => d.toISOString()), issues, logFile: getBackupLogPath(), configDir: config.configDir },
          () => success(`Installed: ${installed.description}. Each run appends to ${getBackupLogPath()}`),
          () => console.log(installed.cron),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'schedule_failed');
        process.exit(1);
      }
    });

  schedule
    .command('remove')
    .description('Remove the scheduled backup from your crontab (other lines are kept)')
    .option('-y, --yes', 'Do not ask for confirmation (required when not run in a terminal)')
    .option('--json', 'Machine-readable result')
    .action(async (opts, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        assertOnlyOptions(cmd, []);
        if (!supportsCrontab()) throw new Error('Nothing to remove: schedules are not installed automatically on this OS.');
        const status = await getScheduleStatus();
        if (status.error) throw new Error(status.error);
        if (!status.installed) {
          output.result({ removed: false }, () => info('No backup is scheduled.'), () => console.log('none'));
          return;
        }
        if (opts.yes !== true) {
          if (!process.stdin.isTTY || output.mode !== 'human') {
            throw new Error('Refusing to change your crontab without confirmation: pass --yes.');
          }
          if (!(await promptConfirm(`Remove the scheduled backup (${status.installed.description})? [y/N] `))) {
            info('Cancelled; your crontab was not changed.');
            return;
          }
        }
        const removed = await removeSchedule();
        output.result({ removed }, () => success('Removed the scheduled backup.'), () => console.log('removed'));
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'schedule_failed');
        process.exit(1);
      }
    });
}
