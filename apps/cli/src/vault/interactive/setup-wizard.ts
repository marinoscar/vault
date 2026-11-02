/** "Set up backups" wizard: builds a BackupSettings object and saves backup.json. */
import { existsSync } from 'fs';
import { homedir, hostname } from 'os';
import { resolve as resolvePath } from 'path';
import chalk from 'chalk';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import {
  DEFAULT_BACKUP_SETTINGS,
  contentsFromKeys,
  describeContents,
  resolveBackupSettings,
  DEFAULT_PASSWORD_ENV,
  SUGGESTED_KEEP_DAYS,
  getDefaultPasswordFilePath,
  loadBackupSettings,
  saveBackupSettings,
  writePasswordFile,
  type BackupSettings,
} from '../lib/backup-settings.js';
import { hasStoredToken } from '../utils/config.js';
import { getCurrentUser } from '../lib/api-client.js';
import {
  backupContentChoices,
  describePasswordSetting,
  describeRetention,
  parseRetentionInput,
  previewTemplate,
  tokenHelp,
  validateContentSelection,
} from './logic.js';
import { askNewPassword, heading } from './ui.js';

const SUGGESTED_TEMPLATE = '~/vault-backups/vault-backup-{datetime}.zip';

async function signedInEmail(): Promise<string | undefined> {
  if (!hasStoredToken()) return undefined;
  try {
    return (await getCurrentUser()).email;
  } catch {
    return undefined;
  }
}

export async function setupWizard(): Promise<void> {
  heading('Set up backups');
  const current = loadBackupSettings();
  const next: BackupSettings = { ...current };

  const utc = await confirm({ message: 'Use UTC for dates and times in file names? (No = local time)', default: current.utc ?? false });
  next.utc = utc;

  const email = await signedInEmail();
  const now = new Date();
  const previewOpts = { utc, host: hostname(), homeDir: homedir(), userEmail: email };
  console.log(chalk.dim(`Tokens: ${tokenHelp()}`));
  console.log(chalk.dim('Folders are allowed (e.g. ~/backups/{year}/{month}/vault-{datetime}.zip) and are created as needed.'));
  next.output = await input({
    message: 'Output file name template',
    default: current.output ?? SUGGESTED_TEMPLATE,
    prefill: 'editable',
    transformer: (value, { isFinal }) => {
      if (isFinal) return value;
      const p = previewTemplate(value, now, previewOpts);
      return `${value}\n  ${p.ok ? chalk.dim('Preview: ') + chalk.green(resolvePath(p.path)) : chalk.red(p.error)}`;
    },
    validate: (value) => {
      const p = previewTemplate(value, now, previewOpts);
      return p.ok ? true : p.error;
    },
  });

  // Password source (the password itself is never stored in backup.json).
  const defaultFile = getDefaultPasswordFilePath();
  const sourceChoice = await select({
    message: 'Where should backups get their password?',
    default: current.passwordFile ? 'file' : current.passwordEnv ? 'env' : 'ask',
    choices: [
      {
        name: `Create a password file in the config folder (${defaultFile}, mode 0600)`,
        value: 'create',
        description: 'Best for scheduled backups. Anyone who can read this file can open your backups.',
      },
      { name: 'Use an existing password file', value: 'file' },
      { name: 'Read it from an environment variable', value: 'env' },
      { name: 'Ask every time (scheduled backups will not work)', value: 'ask' },
    ],
  });
  delete next.passwordEnv;
  delete next.passwordFile;
  if (sourceChoice === 'create') {
    let write = true;
    if (existsSync(defaultFile)) {
      write = await confirm({ message: `${defaultFile} already exists. Replace the password in it?`, default: false });
    }
    if (write) {
      const pw = await askNewPassword('Password for your backups');
      writePasswordFile(defaultFile, pw);
      console.log(chalk.green(`Saved password file ${defaultFile} (mode 0600). Write the password down too: there is no recovery.`));
    }
    next.passwordFile = defaultFile;
  } else if (sourceChoice === 'file') {
    const p = await input({
      message: 'Path to the password file (first line is used)',
      default: current.passwordFile,
      validate: (v) => {
        if (!v.trim()) return 'Enter a path';
        const abs = resolvePath(v.replace(/^~(?=$|[\\/])/, homedir()));
        return existsSync(abs) ? true : `File not found: ${abs}`;
      },
    });
    next.passwordFile = resolvePath(p.replace(/^~(?=$|[\\/])/, homedir()));
  } else if (sourceChoice === 'env') {
    next.passwordEnv = await input({
      message: 'Environment variable name',
      default: current.passwordEnv ?? DEFAULT_PASSWORD_ENV,
      validate: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? true : 'Use letters, digits and _ only'),
    });
    if (!process.env[next.passwordEnv]) console.log(chalk.yellow(`Note: ${next.passwordEnv} is not set in this shell right now.`));
  }

  const { settings: effective } = resolveBackupSettings({}, current);
  const picked = await checkbox({
    message: 'What do you want to back up?',
    instructions: ' (space to toggle, enter to confirm)',
    choices: backupContentChoices(effective),
    validate: (items) => validateContentSelection(items.map((i) => i.value)),
  });
  Object.assign(next, contentsFromKeys(picked, 'selection'));

  console.log(chalk.dim('Retention deletes old backups after each successful backup. Only files matching the template are touched; the newest is always kept.'));
  const days = await input({
    message: 'Delete backups older than how many days? (blank or 0 = never)',
    default: String(current.keepDays ?? SUGGESTED_KEEP_DAYS),
    validate: (v) => {
      const r = parseRetentionInput(v);
      return r.ok ? true : r.error;
    },
  });
  const last = await input({
    message: 'Keep at most how many backups? (blank or 0 = no limit)',
    default: current.keepLast !== undefined ? String(current.keepLast) : '',
    validate: (v) => {
      const r = parseRetentionInput(v);
      return r.ok ? true : r.error;
    },
  });
  const d = parseRetentionInput(days);
  const l = parseRetentionInput(last);
  next.keepDays = d.ok ? d.value : undefined;
  next.keepLast = l.ok ? l.value : undefined;
  if (next.keepDays === undefined) delete next.keepDays;
  if (next.keepLast === undefined) delete next.keepLast;

  heading('Summary');
  const preview = previewTemplate(next.output ?? DEFAULT_BACKUP_SETTINGS.output, new Date(), previewOpts);
  console.log(`  Output:      ${next.output}`);
  if (preview.ok) console.log(`  Next file:   ${chalk.dim(resolvePath(preview.path))}`);
  console.log(`  Password:    ${describePasswordSetting(next, process.env)}`);
  console.log(`  Contents:    ${describeContents(resolveBackupSettings({}, next).settings)}`);
  console.log(`  Time zone:   ${next.utc ? 'UTC' : 'local time'}`);
  console.log(`  Retention:   ${describeRetention(next)}`);

  if (await confirm({ message: 'Save these settings?', default: true })) {
    const file = saveBackupSettings(next);
    console.log(chalk.green(`Saved to ${file}`));
  } else {
    console.log('Not saved.');
  }
}
