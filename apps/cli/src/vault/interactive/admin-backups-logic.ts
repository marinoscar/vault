/**
 * Pure helpers behind the "Admin backups" menu (no prompts, no I/O): main
 * menu entries, the wizard's checkbox and answers-to-body step, pick-list
 * labels and the summary shown before saving.
 */
import {
  ADMIN_CONTENT_KEYS,
  adminContentsFromKeys,
  describeSchedule,
  formatWhen,
  runStatusLabel,
  showAdminBackupsEntry,
  validateScheduleBody,
  type AdminBackupContents,
  type AdminBackupRun,
  type AdminBackupScheduleBody,
  type AdminContentKey,
  type MenuUserState,
  type ScheduleFrequency,
} from '../lib/admin-backups.js';

export type MainMenuValue = 'backups' | 'admin-backups' | 'auth' | 'exit';

/** Main menu entries; "Admin backups" only when {@link showAdminBackupsEntry} allows it. Pure. */
export function mainMenuChoices(state: MenuUserState): { name: string; value: MainMenuValue }[] {
  const choices: { name: string; value: MainMenuValue }[] = [{ name: 'Backups ▸', value: 'backups' }];
  if (showAdminBackupsEntry(state)) choices.push({ name: 'Admin backups ▸', value: 'admin-backups' });
  choices.push({ name: 'Sign in / status', value: 'auth' }, { name: 'Exit', value: 'exit' });
  return choices;
}

export type AdminBackupsMenuValue = 'view' | 'setup' | 'run' | 'list' | 'download' | 'delete' | 'back';

export const ADMIN_BACKUPS_MENU: readonly { name: string; value: AdminBackupsMenuValue }[] = [
  { name: 'View schedule', value: 'view' },
  { name: 'Set up schedule', value: 'setup' },
  { name: 'Run backup now', value: 'run' },
  { name: 'List backups', value: 'list' },
  { name: 'Download a backup', value: 'download' },
  { name: 'Delete a backup', value: 'delete' },
  { name: '◂ Back', value: 'back' },
];

export const FREQUENCY_CHOICES: readonly { name: string; value: ScheduleFrequency }[] = [
  { name: 'Every N hours', value: 'hourly' },
  { name: 'Daily', value: 'daily' },
  { name: 'Weekly', value: 'weekly' },
  { name: 'Monthly', value: 'monthly' },
];

const CONTENT_LABELS: Record<AdminContentKey, { name: string; description: string }> = {
  secrets: { name: 'Secrets (current values)', description: "Every user's secrets, decrypted" },
  attachments: { name: '  Secret attachments (card photos, files)', description: 'Needs Secrets' },
  versions: { name: '  Old secret versions', description: 'Needs Secrets' },
  media: { name: 'Media library (folders and files)', description: "Every user's media folders" },
  system: {
    name: 'System configuration',
    description: 'Users and roles, allowlist, custom secret types, system settings',
  },
};

/** Checkbox choices for "What to back up", checked from the current flags. Pure. */
export function adminContentChoices(
  current: AdminBackupContents,
): { name: string; value: AdminContentKey; description: string; checked: boolean }[] {
  const checked: Record<AdminContentKey, boolean> = {
    secrets: current.includeSecrets,
    attachments: current.includeSecrets && current.includeAttachments,
    versions: current.includeSecrets && current.includeVersions,
    media: current.includeMedia,
    system: current.includeSystem,
  };
  return ADMIN_CONTENT_KEYS.map((key) => ({ ...CONTENT_LABELS[key], value: key, checked: checked[key] }));
}

/** Checkbox validator: true, or the message to show. Pure. */
export function validateAdminContentSelection(keys: readonly string[]): true | string {
  let c: AdminBackupContents;
  try {
    c = adminContentsFromKeys(keys, 'selection');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  const probe: AdminBackupScheduleBody = {
    enabled: false,
    frequency: 'daily',
    intervalHours: null,
    timeOfDay: '03:00',
    dayOfWeek: null,
    dayOfMonth: null,
    timezone: 'UTC',
    keepCount: 7,
    ...c,
  };
  const errors = validateScheduleBody(probe, { passwordConfigured: true, storageConfigured: true });
  return errors.length ? errors[0] : true;
}

export type PasswordAction = 'keep' | 'set' | 'unset';

export interface WizardAnswers {
  frequency: ScheduleFrequency;
  intervalHours?: number;
  timeOfDay?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  timezone: string;
  keepCount: number;
  contents: readonly string[];
  enabled: boolean;
  /** Only with a "set" password action. */
  password?: string;
}

/**
 * The PUT body for the wizard's answers, starting from the current body so
 * fields the frequency does not use keep a sensible value. Pure.
 */
export function buildWizardBody(current: AdminBackupScheduleBody, a: WizardAnswers): AdminBackupScheduleBody {
  const body: AdminBackupScheduleBody = {
    ...current,
    enabled: a.enabled,
    frequency: a.frequency,
    intervalHours: a.frequency === 'hourly' ? (a.intervalHours ?? null) : null,
    timeOfDay: a.frequency === 'hourly' ? current.timeOfDay : (a.timeOfDay ?? current.timeOfDay),
    dayOfWeek: a.frequency === 'weekly' ? (a.dayOfWeek ?? null) : null,
    dayOfMonth: a.frequency === 'monthly' ? (a.dayOfMonth ?? null) : null,
    timezone: a.timezone,
    keepCount: a.keepCount,
    ...adminContentsFromKeys(a.contents, 'selection'),
  };
  delete body.password;
  if (a.password !== undefined) body.password = a.password;
  return body;
}

/** The lines shown before "Save this schedule?". Never contains the password. Pure. */
export function wizardSummaryLines(
  body: AdminBackupScheduleBody,
  passwordAction: PasswordAction,
  passwordUpdatedAt: string | null,
): string[] {
  const pw =
    passwordAction === 'set'
      ? 'a new password will be saved'
      : passwordAction === 'keep'
        ? `keep the current one${passwordUpdatedAt ? ` (set on ${formatWhen(passwordUpdatedAt)})` : ''}`
        : 'not set';
  return [
    `Schedule: ${describeSchedule(body)}`,
    `Enabled:  ${body.enabled ? 'yes' : 'no'}`,
    `Password: ${pw}`,
  ];
}

/** "2026-11-02 03:00 · succeeded · 1.2 MB" style label for pick lists. Pure. */
export function runChoiceLabel(r: AdminBackupRun, formatSize: (n: number) => string): string {
  const size = r.sizeBytes === null ? '-' : formatSize(r.sizeBytes);
  return `${formatWhen(r.startedAt)} · ${r.trigger} · ${runStatusLabel(r)} · ${size}`;
}

/** Runs that can be downloaded. Pure. */
export function downloadableRuns(runs: readonly AdminBackupRun[]): AdminBackupRun[] {
  return runs.filter((r) => r.downloadable);
}

/** Runs that can be deleted: finished and not deleted yet. Pure. */
export function deletableRuns(runs: readonly AdminBackupRun[]): AdminBackupRun[] {
  return runs.filter((r) => r.status !== 'running' && !r.deletedAt);
}
