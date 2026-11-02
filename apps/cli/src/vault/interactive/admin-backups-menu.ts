/** "Admin backups" menu: the server's scheduled backups of every user (system_settings permission). */
import { resolve as resolvePath } from 'path';
import chalk from 'chalk';
import { checkbox, confirm, input, number, select } from '@inquirer/prompts';
import {
  deleteAdminBackupRun,
  getAdminBackupSchedule,
  listAdminBackupRuns,
  putAdminBackupSchedule,
  startAdminBackupRun,
} from '../lib/api-client.js';
import {
  KEEP_COUNT_MAX,
  KEEP_COUNT_MIN,
  PASSWORD_LOSS_WARNING,
  PASSWORD_WARNING,
  SCHEDULE_INTERVAL_HOURS,
  WEEKDAY_NAMES,
  isValidTimeZone,
  localTimeZone,
  parseTimeOfDayFlag,
  scheduleContents,
  scheduleToBody,
  shouldWarnSchedulePassword,
  validateScheduleBody,
  type AdminContentKey,
  type ScheduleFrequency,
} from '../lib/admin-backups.js';
import { adminCall, downloadAdminBackup, waitForRun } from '../lib/admin-backups-runner.js';
import { assertAuthenticated, formatBytes } from '../lib/backup-runner.js';
import { printRun, printRunList, printSchedule } from '../commands/admin-backups.js';
import {
  ADMIN_BACKUPS_MENU,
  FREQUENCY_CHOICES,
  adminContentChoices,
  buildWizardBody,
  deletableRuns,
  downloadableRuns,
  runChoiceLabel,
  validateAdminContentSelection,
  wizardSummaryLines,
  type PasswordAction,
} from './admin-backups-logic.js';
import { askNewPassword, errorLine, heading, isPromptExit } from './ui.js';

async function viewSchedule(): Promise<void> {
  heading('Server backup schedule');
  const s = await adminCall(() => getAdminBackupSchedule());
  printSchedule(s);
}

async function setupSchedule(): Promise<void> {
  heading('Set up the server backup schedule');
  const current = await adminCall(() => getAdminBackupSchedule());
  const currentBody = scheduleToBody(current);
  const isNew = current.updatedAt === null;

  const frequency = await select<ScheduleFrequency>({
    message: 'How often?',
    default: current.frequency,
    choices: FREQUENCY_CHOICES.map((c) => ({ ...c })),
  });

  let intervalHours: number | undefined;
  let timeOfDay: string | undefined;
  let dayOfWeek: number | undefined;
  let dayOfMonth: number | undefined;
  if (frequency === 'hourly') {
    intervalHours = await select<number>({
      message: 'Every how many hours? (counted from local midnight)',
      default: current.intervalHours ?? 6,
      choices: SCHEDULE_INTERVAL_HOURS.map((h) => ({ name: h === 1 ? 'Every hour' : `Every ${h} hours`, value: h })),
    });
  } else {
    if (frequency === 'weekly') {
      dayOfWeek = await select<number>({
        message: 'On which day?',
        default: current.dayOfWeek ?? 0,
        choices: WEEKDAY_NAMES.map((d, i) => ({ name: d, value: i })),
      });
    }
    if (frequency === 'monthly') {
      dayOfMonth =
        (await number({
          message: 'On which day of the month? (1-28)',
          default: current.dayOfMonth ?? 1,
          min: 1,
          max: 28,
          required: true,
        })) ?? 1;
    }
    const at = await input({
      message: 'At what time? (HH:mm, 24h)',
      default: current.timeOfDay,
      validate: (v) => {
        try {
          parseTimeOfDayFlag(v);
          return true;
        } catch {
          return 'Use HH:mm, e.g. 03:00';
        }
      },
    });
    timeOfDay = parseTimeOfDayFlag(at);
  }

  const timezone = (
    await input({
      message: 'Time zone (IANA, e.g. America/Chicago)',
      default: isNew ? localTimeZone() : current.timezone,
      validate: (v) => (isValidTimeZone(v.trim()) ? true : 'Not a valid IANA time zone (e.g. Europe/Madrid, UTC)'),
    })
  ).trim();

  const keepCount =
    (await number({
      message: `How many successful backups to keep? (${KEEP_COUNT_MIN}-${KEEP_COUNT_MAX})`,
      default: current.keepCount,
      min: KEEP_COUNT_MIN,
      max: KEEP_COUNT_MAX,
      required: true,
    })) ?? current.keepCount;

  const contents = await checkbox<AdminContentKey>({
    message: 'What to back up? (space to toggle, enter to confirm)',
    choices: adminContentChoices(scheduleContents(current)),
    validate: (items) => validateAdminContentSelection(items.map((i) => i.value)),
  });

  // Password: never shown, never prefilled.
  let passwordAction: PasswordAction;
  if (current.passwordConfigured) {
    passwordAction = await select<PasswordAction>({
      message: 'Backup password',
      choices: [
        { name: 'Keep the current password', value: 'keep' },
        { name: 'Set a new password', value: 'set' },
      ],
    });
  } else {
    passwordAction = await select<PasswordAction>({
      message: 'Backup password (needed to enable scheduled backups and to open them)',
      choices: [
        { name: 'Set a password now', value: 'set' },
        { name: 'Leave it unset for now (the schedule stays disabled)', value: 'unset' },
      ],
    });
  }
  let password: string | undefined;
  if (passwordAction === 'set') {
    console.log(chalk.yellow(PASSWORD_LOSS_WARNING));
    password = await askNewPassword('Backup password');
    if (shouldWarnSchedulePassword(password)) console.log(chalk.yellow(PASSWORD_WARNING));
  }

  const hasPassword = current.passwordConfigured || password !== undefined;
  let enabled = false;
  if (!current.storageConfigured) {
    console.log(chalk.yellow('Object storage is not configured on the server, so the schedule is saved disabled.'));
  } else if (!hasPassword) {
    console.log(chalk.yellow('No password is set, so the schedule is saved disabled.'));
  } else {
    enabled = await confirm({ message: 'Enable scheduled backups?', default: current.enabled || isNew });
  }

  const body = buildWizardBody(currentBody, {
    frequency,
    intervalHours,
    timeOfDay,
    dayOfWeek,
    dayOfMonth,
    timezone,
    keepCount,
    contents,
    enabled,
    password,
  });
  const errors = validateScheduleBody(body, { passwordConfigured: current.passwordConfigured, storageConfigured: current.storageConfigured });
  if (errors.length) throw new Error(errors[0]);

  console.log('');
  for (const line of wizardSummaryLines(body, passwordAction, current.passwordUpdatedAt)) console.log(`  ${line}`);
  if (!(await confirm({ message: 'Save this schedule?', default: true }))) {
    console.log('Nothing saved.');
    return;
  }
  const saved = await adminCall(() => putAdminBackupSchedule(body));
  console.log(chalk.green('Schedule saved.'));
  printSchedule(saved);
}

async function runNow(): Promise<void> {
  heading('Run a server backup now');
  const started = await adminCall(() => startAdminBackupRun(), 'run');
  console.log(chalk.dim(`Backup ${started.id} started. Checking every 5 s (Ctrl+C stops watching; the backup keeps running).`));
  const onSigint = (): void => {
    console.log('\nStopped watching. The backup keeps running on the server; see "List backups".');
    process.exit(0);
  };
  process.once('SIGINT', onSigint);
  try {
    const run = await waitForRun(started.id, {
      onTick: (r, ms) => {
        if (r.status === 'running') process.stdout.write(chalk.dim(`\r  running... ${Math.round(ms / 1000)} s `));
      },
    });
    process.stdout.write('\n');
    if (run.status === 'succeeded') console.log(chalk.green('Backup finished.'));
    else console.log(chalk.red('Backup failed.'));
    printRun(run);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function listBackups(): Promise<void> {
  heading('Server backups');
  printRunList(await adminCall(() => listAdminBackupRuns({ page: 1, pageSize: 20 })));
}

async function pickRun(message: string, filter: typeof downloadableRuns, emptyText: string) {
  const list = await adminCall(() => listAdminBackupRuns({ page: 1, pageSize: 50 }));
  const runs = filter(list.items);
  if (runs.length === 0) {
    console.log(emptyText);
    return null;
  }
  const id = await select<string>({
    message,
    loop: false,
    choices: [...runs.map((r) => ({ name: runChoiceLabel(r, formatBytes), value: r.id })), { name: '◂ Back', value: '' }],
  });
  return runs.find((r) => r.id === id) ?? null;
}

async function downloadBackup(): Promise<void> {
  heading('Download a server backup');
  const run = await pickRun('Which backup?', downloadableRuns, 'No backups can be downloaded.');
  if (!run) return;
  const output = (
    await input({
      message: 'Save to (a folder, or a file name)',
      default: process.cwd(),
      validate: (v) => (v.trim() ? true : 'Enter a path'),
    })
  ).trim();
  const result = await downloadAdminBackup({
    id: run.id,
    output,
    overwrite: false,
    progress: (m) => console.log(chalk.dim(m)),
  });
  console.log(chalk.green(`Saved ${resolvePath(result.path)} (${formatBytes(result.size)}, mode 0600).`));
  console.log(chalk.dim('Open it with 7-Zip or Keka using the schedule\'s backup password.'));
}

async function deleteBackup(): Promise<void> {
  heading('Delete a server backup');
  const run = await pickRun('Which backup?', deletableRuns, 'No backups can be deleted.');
  if (!run) return;
  const ok = await confirm({
    message: `Delete the backup of ${runChoiceLabel(run, formatBytes)}? It cannot be undone.`,
    default: false,
  });
  if (!ok) {
    console.log('Nothing deleted.');
    return;
  }
  await adminCall(() => deleteAdminBackupRun(run.id), 'delete');
  console.log(chalk.green('Backup deleted. The run stays in the history.'));
}

export async function adminBackupsMenu(): Promise<void> {
  assertAuthenticated();
  for (;;) {
    const choice = await select({ message: 'Admin backups', loop: false, choices: ADMIN_BACKUPS_MENU.map((c) => ({ ...c })) });
    if (choice === 'back') return;
    try {
      if (choice === 'view') await viewSchedule();
      else if (choice === 'setup') await setupSchedule();
      else if (choice === 'run') await runNow();
      else if (choice === 'list') await listBackups();
      else if (choice === 'download') await downloadBackup();
      else if (choice === 'delete') await deleteBackup();
    } catch (err) {
      if (isPromptExit(err)) throw err;
      errorLine(err);
    }
  }
}
