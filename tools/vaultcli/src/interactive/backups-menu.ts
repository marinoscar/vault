/** "Backups" menu: run, set up, view, list, clean up, schedule. */
import { homedir, hostname } from 'os';
import { join, relative, resolve as resolvePath } from 'path';
import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';
import { config } from '../utils/config.js';
import {
  BACKUP_SETTING_KEYS,
  DEFAULT_PASSWORD_ENV,
  choosePasswordSource,
  describeContents,
  effectiveContents,
  getBackupSettingsPath,
  loadBackupSettings,
  resolveBackupSettings,
} from '../lib/backup-settings.js';
import {
  assertAuthenticated,
  formatBytes,
  performBackup,
  planBackupRetention,
  resolvePassword,
  runPrune,
} from '../lib/backup-runner.js';
import { formatAge, retentionEnabled } from '../lib/backup-retention.js';
import { printBackupResult, printPruneOutcome } from '../commands/backup.js';
import { setupWizard } from './setup-wizard.js';
import { buildScheduleInstructions, describePasswordSetting, describeRetention, parseTimeOfDay, previewTemplate } from './logic.js';
import { askNewPassword, errorLine, heading } from './ui.js';

async function runNow(): Promise<void> {
  heading('Run a backup now');
  const saved = loadBackupSettings();
  const { settings, sources } = resolveBackupSettings({}, saved);
  const contents = effectiveContents(settings, sources);
  assertAuthenticated();
  const source = choosePasswordSource({}, saved, process.env);
  const pw = await resolvePassword(source, {
    interactive: true,
    prompt: () => askNewPassword(),
    warn: (m) => console.log(chalk.yellow(m)),
  });
  const result = await performBackup({
    settings,
    contents,
    password: pw,
    overwrite: false,
    progress: (m) => console.log(chalk.dim(m)),
  });
  printBackupResult(result);
  if (retentionEnabled(settings)) {
    try {
      printPruneOutcome(
        runPrune({ template: settings.output, keepDays: settings.keepDays, keepLast: settings.keepLast, protect: [result.path], dryRun: false }),
      );
    } catch (err) {
      console.log(chalk.yellow(`Retention failed (backup kept): ${err instanceof Error ? err.message : String(err)}`));
    }
  } else {
    console.log(chalk.dim('Retention is off; old backups are kept.'));
  }
  console.log(chalk.yellow('Keep the password safe: without it the file cannot be opened. There is no recovery.'));
}

function viewSettings(): void {
  heading('Backup settings');
  const saved = loadBackupSettings();
  const { settings, sources } = resolveBackupSettings({}, saved);
  console.log(chalk.dim(`  File: ${getBackupSettingsPath()}${Object.keys(saved).length ? '' : ' (not saved yet; showing defaults)'}`));
  const preview = previewTemplate(settings.output, new Date(), { utc: settings.utc, host: hostname(), homeDir: homedir() });
  console.log(`  Output:      ${settings.output}`);
  if (preview.ok) console.log(`  Next file:   ${chalk.dim(resolvePath(preview.path))}`);
  console.log(`  Password:    ${describePasswordSetting(saved, process.env)}`);
  console.log(`  Contents:    ${describeContents(settings)}`);
  console.log(`  Time zone:   ${settings.utc ? 'UTC' : 'local time'}`);
  console.log(`  Retention:   ${describeRetention(settings)}`);
  const savedKeys = BACKUP_SETTING_KEYS.filter((k) => sources[k] === 'saved');
  console.log(chalk.dim(`  Saved keys:  ${savedKeys.length ? savedKeys.join(', ') : 'none'}`));
}

function listBackups(): void {
  heading('Backups');
  const { settings } = resolveBackupSettings({}, loadBackupSettings());
  const { root, files, plan } = planBackupRetention(settings.output, { keepDays: settings.keepDays, keepLast: settings.keepLast });
  console.log(chalk.dim(`  Matching ${settings.output} under ${root}`));
  if (files.length === 0) {
    console.log('  No backups found.');
    return;
  }
  const doomed = new Set(plan.delete.map((f) => f.path));
  const now = Date.now();
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of sorted) {
    const name = relative(root, f.path) || f.path;
    const mark = doomed.has(f.path) ? chalk.red(' would be deleted') : '';
    console.log(`  ${name.padEnd(48)} ${formatBytes(f.size).padStart(9)}  ${formatAge(now - f.mtimeMs).padStart(7)} old${mark}`);
  }
  console.log(chalk.dim(`  ${files.length} backup(s); retention: ${describeRetention(settings)}`));
}

async function cleanUp(): Promise<void> {
  heading('Clean up old backups');
  const { settings } = resolveBackupSettings({}, loadBackupSettings());
  if (!retentionEnabled(settings)) {
    console.log('Retention is off. Set keep days / keep last in "Set up backups" first.');
    return;
  }
  const preview = runPrune({ template: settings.output, keepDays: settings.keepDays, keepLast: settings.keepLast, dryRun: true });
  printPruneOutcome(preview);
  if (preview.planned.length === 0) return;
  if (!(await confirm({ message: `Delete ${preview.planned.length} backup(s)?`, default: false }))) {
    console.log('Nothing deleted.');
    return;
  }
  printPruneOutcome(runPrune({ template: settings.output, keepDays: settings.keepDays, keepLast: settings.keepLast, dryRun: false }));
}

async function schedule(): Promise<void> {
  heading('Schedule backups');
  console.log(chalk.dim('This shows the entry to add for your system; nothing is installed for you.'));
  const time = await input({
    message: 'Daily at (HH:MM, 24h)',
    default: '02:30',
    validate: (v) => (parseTimeOfDay(v) ? true : 'Use HH:MM, e.g. 02:30'),
  });
  const t = parseTimeOfDay(time)!;
  const env: Record<string, string> = {};
  if (process.env.VAULTCLI_CONFIG_DIR) env.VAULTCLI_CONFIG_DIR = process.env.VAULTCLI_CONFIG_DIR;
  if (process.env.VAULTCLI_SERVER_URL) env.VAULTCLI_SERVER_URL = process.env.VAULTCLI_SERVER_URL;
  const instructions = buildScheduleInstructions({
    platform: process.platform,
    nodePath: process.execPath,
    cliPath: resolvePath(process.argv[1] ?? 'vaultcli'),
    hour: t.hour,
    minute: t.minute,
    env,
    logPath: join(config.configDir, 'backup.log'),
    homeDir: homedir(),
    saved: loadBackupSettings(),
    defaultEnvSet: Boolean(process.env[DEFAULT_PASSWORD_ENV]),
  });
  console.log('');
  console.log(chalk.bold(instructions.title));
  for (const w of instructions.warnings) console.log(chalk.yellow(`  ! ${w}`));
  instructions.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log('');
  console.log(instructions.content);
  console.log('');
  console.log(chalk.dim('Each run uses your saved settings and appends a JSON result to the log file.'));
}

export async function backupsMenu(): Promise<void> {
  for (;;) {
    const choice = await select({
      message: 'Backups',
      loop: false,
      choices: [
        { name: 'Run a backup now', value: 'run' },
        { name: 'Set up backups', value: 'setup' },
        { name: 'View backup settings', value: 'view' },
        { name: 'List backups', value: 'list' },
        { name: 'Clean up old backups now', value: 'clean' },
        { name: 'Schedule backups', value: 'schedule' },
        { name: '◂ Back', value: 'back' },
      ],
    });
    if (choice === 'back') return;
    try {
      if (choice === 'run') await runNow();
      else if (choice === 'setup') await setupWizard();
      else if (choice === 'view') viewSettings();
      else if (choice === 'list') listBackups();
      else if (choice === 'clean') await cleanUp();
      else if (choice === 'schedule') await schedule();
    } catch (err) {
      if (err instanceof Error && (err.name === 'ExitPromptError' || err.name === 'AbortPromptError')) throw err;
      errorLine(err);
    }
  }
}
