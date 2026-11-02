/**
 * Pure helpers behind the interactive terminal UI (no prompts, no I/O), so
 * they can be unit tested: template preview, retention input parsing,
 * password-source descriptions and per-OS schedule instructions.
 */
import { BACKUP_FILENAME_TOKENS, expandBackupFilename, templateUsesUser } from '../lib/backup-filename.js';
import {
  BACKUP_CONTENT_KEYS,
  DEFAULT_PASSWORD_ENV,
  contentsFromKeys,
  type BackupContentKey,
  type BackupContents,
  type BackupSettings,
} from '../lib/backup-settings.js';

export type TemplatePreview = { ok: true; path: string } | { ok: false; error: string };

/**
 * Expand a template for a live preview. `{user}` shows the given email's local
 * part, or a placeholder when not signed in.
 */
export function previewTemplate(
  template: string,
  now: Date,
  opts: { utc: boolean; host: string; homeDir: string; userEmail?: string },
): TemplatePreview {
  try {
    const user = templateUsesUser(template) ? (opts.userEmail ?? 'your-name') : undefined;
    return { ok: true, path: expandBackupFilename(template, now, { utc: opts.utc, host: opts.host, homeDir: opts.homeDir, user }) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One-line token reference for the wizard. */
export function tokenHelp(): string {
  return BACKUP_FILENAME_TOKENS.map((t) => `{${t}}`).join(' ');
}

/**
 * Parse a retention answer: blank or "0" = off (undefined), else a positive
 * whole number. Returns an error string for anything else.
 */
export function parseRetentionInput(raw: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === '' || s === '0') return { ok: true, value: undefined };
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Enter a whole number, or leave blank / 0 for off' };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false, error: 'Enter a whole number, or leave blank / 0 for off' };
  return { ok: true, value: n };
}

/** Human description of where a run would get its password. */
export function describePasswordSetting(saved: BackupSettings, env: Record<string, string | undefined>): string {
  if (saved.passwordFile) return `password file ${saved.passwordFile}`;
  if (saved.passwordEnv) return `environment variable ${saved.passwordEnv}${env[saved.passwordEnv] ? '' : ' (not set right now)'}`;
  if (env[DEFAULT_PASSWORD_ENV]) return `environment variable ${DEFAULT_PASSWORD_ENV}`;
  return 'ask every time';
}

/** One-line summary of the retention settings. */
export function describeRetention(s: { keepDays?: number; keepLast?: number }): string {
  const parts: string[] = [];
  if (s.keepDays) parts.push(`delete after ${s.keepDays} day(s)`);
  if (s.keepLast) parts.push(`keep the newest ${s.keepLast}`);
  return parts.length ? parts.join(', ') : 'off (nothing is deleted)';
}

/** Parse "HH:MM" (24h). */
export function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export interface ScheduleInput {
  platform: NodeJS.Platform;
  /** Absolute path of the node binary (process.execPath). */
  nodePath: string;
  /** Absolute path of the vaultcli entry script. */
  cliPath: string;
  hour: number;
  minute: number;
  /** Environment the job needs (e.g. VAULTCLI_CONFIG_DIR, VAULTCLI_SERVER_URL). Never a password. */
  env: Record<string, string>;
  /** Where the job appends its JSON output. */
  logPath: string;
  homeDir: string;
  /** Saved settings, used only for warnings. */
  saved: BackupSettings;
  /** Whether $VAULTCLI_BACKUP_PASSWORD is set in the current shell. */
  defaultEnvSet: boolean;
}

export interface ScheduleInstructions {
  kind: 'cron' | 'launchd' | 'schtasks';
  title: string;
  /** File to create (launchd only). */
  filePath?: string;
  /** The line, file content or command to use. */
  content: string;
  /** Steps to follow, in order. */
  steps: string[];
  warnings: string[];
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Warnings about running the saved settings unattended. Pure. */
export function scheduleWarnings(input: Pick<ScheduleInput, 'saved' | 'defaultEnvSet' | 'platform'>): string[] {
  const w: string[] = [];
  const { saved } = input;
  if (!saved.passwordFile && !saved.passwordEnv) {
    w.push(
      input.defaultEnvSet
        ? `The password comes from ${DEFAULT_PASSWORD_ENV} in your shell, which scheduled jobs do not see. Choose a password file in "Set up backups".`
        : 'No saved password source: a scheduled run cannot ask for a password and will fail. Choose a password file in "Set up backups".',
    );
  } else if (!saved.passwordFile && saved.passwordEnv) {
    w.push(
      `The password is read from $${saved.passwordEnv}; scheduled jobs do not load your shell profile, so the variable must be set for the job itself. A password file is simpler.`,
    );
  }
  if (!saved.keepDays && !saved.keepLast) {
    w.push('Retention is off: scheduled backups will accumulate until you set keep days / keep last.');
  }
  if (saved.output && !/^(~|[\\/]|[A-Za-z]:[\\/])/.test(saved.output)) {
    w.push('The output path is relative; scheduled jobs run in a different folder. Use an absolute path or one starting with ~.');
  }
  return w;
}

/**
 * The exact schedule entry for this OS, using saved settings (`backup --json`).
 * Only builds text; never installs anything. Pure.
 */
export function buildScheduleInstructions(input: ScheduleInput): ScheduleInstructions {
  const warnings = scheduleWarnings(input);
  const time = `${pad2(input.hour)}:${pad2(input.minute)}`;

  if (input.platform === 'darwin') {
    const label = 'local.vaultcli.backup';
    const filePath = `${input.homeDir}/Library/LaunchAgents/${label}.plist`;
    const envXml = Object.keys(input.env).length
      ? `  <key>EnvironmentVariables</key>\n  <dict>\n${Object.entries(input.env)
          .map(([k, v]) => `    <key>${xmlEscape(k)}</key><string>${xmlEscape(v)}</string>`)
          .join('\n')}\n  </dict>\n`
      : '';
    const content =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0">\n<dict>\n` +
      `  <key>Label</key><string>${label}</string>\n` +
      `  <key>ProgramArguments</key>\n  <array>\n` +
      `    <string>${xmlEscape(input.nodePath)}</string>\n` +
      `    <string>${xmlEscape(input.cliPath)}</string>\n` +
      `    <string>backup</string>\n    <string>--json</string>\n  </array>\n` +
      envXml +
      `  <key>StartCalendarInterval</key>\n  <dict>\n` +
      `    <key>Hour</key><integer>${input.hour}</integer>\n` +
      `    <key>Minute</key><integer>${input.minute}</integer>\n  </dict>\n` +
      `  <key>StandardOutPath</key><string>${xmlEscape(input.logPath)}</string>\n` +
      `  <key>StandardErrorPath</key><string>${xmlEscape(input.logPath)}</string>\n` +
      `</dict>\n</plist>\n`;
    return {
      kind: 'launchd',
      title: `launchd agent (daily at ${time})`,
      filePath,
      content,
      warnings,
      steps: [
        `Save the content below as ${filePath}`,
        `Load it: launchctl bootstrap gui/$(id -u) ${shQuote(filePath)}`,
        `Remove it later: launchctl bootout gui/$(id -u) ${shQuote(filePath)}`,
      ],
    };
  }

  if (input.platform === 'win32') {
    const q = (s: string) => `"${s}"`;
    const envPrefix = Object.entries(input.env)
      .map(([k, v]) => `set "${k}=${v}" && `)
      .join('');
    const inner = `${envPrefix}${q(input.nodePath)} ${q(input.cliPath)} backup --json >> ${q(input.logPath)} 2>&1`;
    // schtasks /TR takes one quoted argument; embedded quotes are escaped as \".
    const tr = `cmd /c "${inner}"`.replace(/"/g, '\\"');
    const content = `schtasks /Create /TN "vaultcli backup" /SC DAILY /ST ${time} /TR "${tr}"`;
    return {
      kind: 'schtasks',
      title: `Windows Task Scheduler (daily at ${time})`,
      content,
      warnings,
      steps: [
        'Run the command below in a Command Prompt (as your own user, not as administrator)',
        'Check it: schtasks /Query /TN "vaultcli backup"',
        'Remove it later: schtasks /Delete /TN "vaultcli backup" /F',
      ],
    };
  }

  // Linux and other Unix: crontab. `%` is special in crontab and must be escaped.
  const esc = (s: string) => shQuote(s).replace(/%/g, '\\%');
  const envPrefix = Object.entries(input.env)
    .map(([k, v]) => `${k}=${esc(v)} `)
    .join('');
  const content = `${input.minute} ${input.hour} * * * ${envPrefix}${esc(input.nodePath)} ${esc(input.cliPath)} backup --json >> ${esc(input.logPath)} 2>&1`;
  return {
    kind: 'cron',
    title: `crontab entry (daily at ${time})`,
    content,
    warnings,
    steps: ['Open your crontab: crontab -e', 'Add the line below and save', 'Check it: crontab -l'],
  };
}

const CONTENT_CHOICE_LABELS: Record<BackupContentKey, { name: string; description: string }> = {
  secrets: { name: 'Secrets (current values)', description: 'Every secret you own, decrypted' },
  attachments: { name: '  Secret attachments (card photos, files)', description: 'Needs Secrets' },
  versions: { name: '  Old secret versions', description: 'Needs Secrets' },
  media: { name: 'Media library (folders and files)', description: 'Your own media folders' },
};

/**
 * Checkbox choices for "What do you want to back up?", checked from the
 * current settings (defaults: secrets and attachments). Pure.
 */
export function backupContentChoices(
  current: BackupContents,
): { name: string; value: BackupContentKey; description: string; checked: boolean }[] {
  const checked: Record<BackupContentKey, boolean> = {
    secrets: current.includeSecrets,
    attachments: current.includeSecrets && current.includeAttachments,
    versions: current.includeSecrets && current.includeVersions,
    media: current.includeMedia,
  };
  return BACKUP_CONTENT_KEYS.map((key) => ({ ...CONTENT_CHOICE_LABELS[key], value: key, checked: checked[key] }));
}

/** Checkbox validator: true, or the error message to show. Pure. */
export function validateContentSelection(keys: readonly string[]): true | string {
  try {
    contentsFromKeys(keys, 'selection');
    return true;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
