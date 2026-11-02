/**
 * Saved settings for `vaultcli backup` (`<config dir>/backup.json`).
 *
 * The password itself is NEVER stored here: only where to read it from
 * (an environment variable name or a password file path).
 *
 * Precedence: command-line flag > saved setting > built-in default
 * ({@link resolveBackupSettings}, pure). Built-in retention is off.
 *
 * What goes in the backup (contents): secrets (with attachments, without old
 * versions) by default; the media library is opt-in. `--contents` replaces the
 * individual content flags ({@link parseContentsOption}, pure).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../utils/config.js';
import { BACKUP_FILENAME_TOKENS, DEFAULT_BACKUP_TEMPLATE, templateTokens } from './backup-filename.js';

export const DEFAULT_PASSWORD_ENV = 'VAULTCLI_BACKUP_PASSWORD';

export interface BackupSettings {
  output?: string;
  passwordEnv?: string;
  passwordFile?: string;
  includeSecrets?: boolean;
  includeAttachments?: boolean;
  includeVersions?: boolean;
  includeMedia?: boolean;
  utc?: boolean;
  keepDays?: number;
  keepLast?: number;
}

export type BackupSettingKey = keyof BackupSettings;

/** Every key backup.json may hold, in display order. */
export const BACKUP_SETTING_KEYS: readonly BackupSettingKey[] = [
  'output',
  'passwordEnv',
  'passwordFile',
  'includeSecrets',
  'includeAttachments',
  'includeVersions',
  'includeMedia',
  'utc',
  'keepDays',
  'keepLast',
] as const;

const STRING_KEYS: readonly BackupSettingKey[] = ['output', 'passwordEnv', 'passwordFile'];
const BOOLEAN_KEYS: readonly BackupSettingKey[] = ['includeSecrets', 'includeAttachments', 'includeVersions', 'includeMedia', 'utc'];
const INTEGER_KEYS: readonly BackupSettingKey[] = ['keepDays', 'keepLast'];

/** Built-in defaults. Retention (keepDays / keepLast) is off. */
export const DEFAULT_BACKUP_SETTINGS: Readonly<
  Required<
    Pick<BackupSettings, 'output' | 'includeSecrets' | 'includeAttachments' | 'includeVersions' | 'includeMedia' | 'utc'>
  > &
    BackupSettings
> = Object.freeze({
  output: DEFAULT_BACKUP_TEMPLATE,
  includeSecrets: true,
  includeAttachments: true,
  includeVersions: false,
  includeMedia: false,
  utc: false,
});

/** The value the TUI suggests for keepDays (never applied automatically). */
export const SUGGESTED_KEEP_DAYS = 30;

export type ResolvedBackupSettings = BackupSettings & {
  output: string;
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
  utc: boolean;
};

/** Where the setting came from, per key. */
export type SettingSource = 'flag' | 'saved' | 'default' | 'unset';

/**
 * Merge flags over saved settings over defaults. `undefined` means "not
 * given" at every layer. Pure.
 *
 * Password source keys are treated as one group: if a flag names any password
 * source (`passwordEnv` / `passwordFile`), saved password sources are ignored,
 * so `--password-env X` is never overridden by a saved `passwordFile`.
 */
export function resolveBackupSettings(
  flags: BackupSettings,
  saved: BackupSettings,
  defaults: BackupSettings = DEFAULT_BACKUP_SETTINGS,
): { settings: ResolvedBackupSettings; sources: Record<BackupSettingKey, SettingSource> } {
  const flagNamesPasswordSource = flags.passwordEnv !== undefined || flags.passwordFile !== undefined;
  const out: BackupSettings = {};
  const sources = {} as Record<BackupSettingKey, SettingSource>;

  for (const key of BACKUP_SETTING_KEYS) {
    const isPwKey = key === 'passwordEnv' || key === 'passwordFile';
    const savedValue = isPwKey && flagNamesPasswordSource ? undefined : saved[key];
    let value: unknown;
    let source: SettingSource;
    if (flags[key] !== undefined) {
      value = flags[key];
      source = 'flag';
    } else if (savedValue !== undefined) {
      value = savedValue;
      source = 'saved';
    } else if (defaults[key] !== undefined) {
      value = defaults[key];
      source = 'default';
    } else {
      value = undefined;
      source = 'unset';
    }
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    sources[key] = source;
  }

  return {
    settings: {
      ...out,
      output: out.output ?? DEFAULT_BACKUP_TEMPLATE,
      includeSecrets: out.includeSecrets ?? true,
      includeAttachments: out.includeAttachments ?? true,
      includeVersions: out.includeVersions ?? false,
      includeMedia: out.includeMedia ?? false,
      utc: out.utc ?? false,
    },
    sources,
  };
}

// ---------------------------------------------------------------------------
// Backup contents
// ---------------------------------------------------------------------------

/** Keys accepted by `--contents` (and the setup wizard's checkbox), in display order. */
export const BACKUP_CONTENT_KEYS = ['secrets', 'attachments', 'versions', 'media'] as const;
export type BackupContentKey = (typeof BACKUP_CONTENT_KEYS)[number];

/** The four content settings, all explicit. */
export interface BackupContents {
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
}

export const NOTHING_TO_BACK_UP = 'Choose at least one thing to back up (secrets or media)';

/**
 * Turn a list of content keys into the four content settings. Keys not listed
 * are off. Throws on an unknown key (listing the valid ones), on attachments or
 * versions without secrets, and when nothing is selected. Pure.
 */
export function contentsFromKeys(keys: readonly string[], label = '--contents'): BackupContents {
  const valid = BACKUP_CONTENT_KEYS as readonly string[];
  const unknown = keys.filter((k) => !valid.includes(k));
  if (unknown.length) {
    throw new Error(
      `Unknown ${label} value(s): ${[...new Set(unknown)].join(', ')}. Valid values: ${BACKUP_CONTENT_KEYS.join(', ')}`,
    );
  }
  const set = new Set(keys);
  const contents: BackupContents = {
    includeSecrets: set.has('secrets'),
    includeAttachments: set.has('attachments'),
    includeVersions: set.has('versions'),
    includeMedia: set.has('media'),
  };
  assertValidContents(contents, label);
  return contents;
}

/**
 * Parse `--contents secrets,attachments,media` (comma separated, case and
 * surrounding spaces ignored, duplicates allowed). Pure; see
 * {@link contentsFromKeys} for the rules.
 */
export function parseContentsOption(raw: string): BackupContents {
  const keys = String(raw)
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k !== '');
  if (keys.length === 0) {
    throw new Error(`--contents needs a comma-separated list of: ${BACKUP_CONTENT_KEYS.join(', ')}`);
  }
  return contentsFromKeys(keys);
}

/**
 * Throws when the contents cannot be sent: nothing selected, or attachments /
 * versions asked for without secrets. `label` names the option in the message.
 */
export function assertValidContents(c: BackupContents, label = '--contents'): void {
  if (!c.includeSecrets) {
    const orphan = [c.includeAttachments ? 'attachments' : null, c.includeVersions ? 'versions' : null].filter(Boolean);
    if (orphan.length) {
      throw new Error(`${label}: ${orphan.join(' and ')} require secrets (add "secrets", or leave ${orphan.join(' and ')} out)`);
    }
  }
  if (!c.includeSecrets && !c.includeMedia) throw new Error(NOTHING_TO_BACK_UP);
}

/** The selected content keys of resolved settings (attachments / versions only with secrets). Pure. */
export function contentKeys(c: BackupContents): BackupContentKey[] {
  const keys: BackupContentKey[] = [];
  if (c.includeSecrets) {
    keys.push('secrets');
    if (c.includeAttachments) keys.push('attachments');
    if (c.includeVersions) keys.push('versions');
  }
  if (c.includeMedia) keys.push('media');
  return keys;
}

/**
 * The content to request after merging flags, saved settings and defaults.
 * With secrets off, attachments / versions that come from a saved setting or
 * the default are dropped silently, but asking for them with a flag in the
 * same command is an error. Throws when nothing is selected. Pure.
 */
export function effectiveContents(
  settings: BackupContents,
  sources: Partial<Record<BackupSettingKey, SettingSource>>,
): BackupContents {
  if (!settings.includeSecrets) {
    const flagged = [
      settings.includeAttachments && sources.includeAttachments === 'flag' ? '--attachments' : null,
      settings.includeVersions && sources.includeVersions === 'flag' ? '--include-versions' : null,
    ].filter(Boolean);
    if (flagged.length) {
      throw new Error(`${flagged.join(' and ')} require secrets; remove --no-secrets or ${flagged.join(' / ')}`);
    }
  }
  const out: BackupContents = {
    includeSecrets: settings.includeSecrets,
    includeAttachments: settings.includeSecrets && settings.includeAttachments,
    includeVersions: settings.includeSecrets && settings.includeVersions,
    includeMedia: settings.includeMedia,
  };
  if (!out.includeSecrets && !out.includeMedia) {
    throw new Error(`${NOTHING_TO_BACK_UP}: secrets are off and media is not included (use --media or drop --no-secrets)`);
  }
  return out;
}

/** Body of `POST /api/secrets/export`. The password is only ever sent here. */
export interface BackupExportBody {
  password: string;
  includeSecrets: boolean;
  includeAttachments: boolean;
  includeVersions: boolean;
  includeMedia: boolean;
}

/** Build the export request body from the effective contents. Pure. */
export function buildExportBody(contents: BackupContents, password: string): BackupExportBody {
  return {
    password,
    includeSecrets: contents.includeSecrets,
    includeAttachments: contents.includeSecrets && contents.includeAttachments,
    includeVersions: contents.includeSecrets && contents.includeVersions,
    includeMedia: contents.includeMedia,
  };
}

/** Short human summary, e.g. "secrets with attachments, media library". Pure. */
export function describeContents(c: BackupContents): string {
  const parts: string[] = [];
  if (c.includeSecrets) {
    const extras = [c.includeAttachments ? 'attachments' : null, c.includeVersions ? 'old versions' : null].filter(Boolean);
    parts.push(extras.length ? `secrets with ${extras.join(' and ')}` : 'secrets');
  }
  if (c.includeMedia) parts.push('media library');
  return parts.length ? parts.join(', ') : 'nothing';
}

export type PasswordSource =
  | { kind: 'literal'; value: string; from: 'flag' }
  | { kind: 'file'; path: string; from: 'flag' | 'saved' }
  | { kind: 'env'; name: string; from: 'flag' | 'saved' | 'default' }
  | { kind: 'prompt' };

/**
 * Decide where the password comes from. Pure (env lookup is injected).
 * Order: --password, --password-file, --password-env, saved passwordFile,
 * saved passwordEnv, $VAULTCLI_BACKUP_PASSWORD when set, else prompt.
 */
export function choosePasswordSource(
  flags: BackupSettings & { password?: string },
  saved: BackupSettings,
  env: Record<string, string | undefined>,
): PasswordSource {
  if (flags.password !== undefined) return { kind: 'literal', value: flags.password, from: 'flag' };
  if (flags.passwordFile !== undefined) return { kind: 'file', path: flags.passwordFile, from: 'flag' };
  if (flags.passwordEnv !== undefined) return { kind: 'env', name: flags.passwordEnv, from: 'flag' };
  if (saved.passwordFile !== undefined) return { kind: 'file', path: saved.passwordFile, from: 'saved' };
  if (saved.passwordEnv !== undefined) return { kind: 'env', name: saved.passwordEnv, from: 'saved' };
  if (env[DEFAULT_PASSWORD_ENV]) return { kind: 'env', name: DEFAULT_PASSWORD_ENV, from: 'default' };
  return { kind: 'prompt' };
}

/** Parse a strictly positive integer (e.g. a CLI value); throws with `label`. */
export function parsePositiveInt(raw: string | number, label: string): number {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) throw new Error(`${label} must be a positive whole number (got "${raw}")`);
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${label} must be at least 1 (got "${raw}")`);
  return n;
}

/** Throws if the template references unknown tokens. */
export function assertValidTemplate(template: string): void {
  if (!template || !template.trim()) throw new Error('Output template must not be empty');
  const unknown = templateTokens(template).filter(
    (t) => !(BACKUP_FILENAME_TOKENS as readonly string[]).includes(t),
  );
  if (unknown.length) {
    const valid = BACKUP_FILENAME_TOKENS.map((t) => `{${t}}`).join(' ');
    throw new Error(
      `Unknown token(s) in output template: ${[...new Set(unknown)].map((t) => `{${t}}`).join(', ')}. Valid tokens: ${valid}`,
    );
  }
}

/**
 * Validate an untrusted object (parsed backup.json or user input) into
 * BackupSettings. Unknown keys (including any `password`) are dropped. Pure.
 */
export function validateBackupSettings(raw: unknown): BackupSettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('backup settings must be a JSON object');
  }
  const src = raw as Record<string, unknown>;
  const out: BackupSettings = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const v = src[key];
    if (v === undefined || v === null) continue;
    if (STRING_KEYS.includes(key)) {
      if (typeof v !== 'string' || !v.trim()) throw new Error(`${key} must be a non-empty string`);
      if (key === 'output') assertValidTemplate(v);
      (out as Record<string, unknown>)[key] = v;
    } else if (BOOLEAN_KEYS.includes(key)) {
      if (typeof v !== 'boolean') throw new Error(`${key} must be true or false`);
      (out as Record<string, unknown>)[key] = v;
    } else if (INTEGER_KEYS.includes(key)) {
      if (typeof v !== 'number' && typeof v !== 'string') throw new Error(`${key} must be a positive whole number`);
      (out as Record<string, unknown>)[key] = parsePositiveInt(v, key);
    }
  }
  return out;
}

/** Map `keep-days`, `keepDays`, `keep_days` → `keepDays`. Returns null if unknown. */
export function normalizeSettingKey(input: string): BackupSettingKey | null {
  const camel = input.trim().replace(/[-_]+([a-z])/gi, (_m, c: string) => c.toUpperCase());
  const hit = BACKUP_SETTING_KEYS.find((k) => k.toLowerCase() === camel.toLowerCase());
  return hit ?? null;
}

/** Return a copy of `saved` with `keys` removed. Pure. */
export function unsetBackupSettings(saved: BackupSettings, keys: BackupSettingKey[]): BackupSettings {
  const copy: BackupSettings = { ...saved };
  for (const k of keys) delete copy[k];
  return copy;
}

// ---------------------------------------------------------------------------
// File layer
// ---------------------------------------------------------------------------

export function getBackupSettingsPath(): string {
  return join(config.configDir, 'backup.json');
}

/** Default location for a password file created by the TUI. */
export function getDefaultPasswordFilePath(): string {
  return join(config.configDir, 'backup-password');
}

/** Load backup.json; `{}` when missing. Throws with the path on invalid content. */
export function loadBackupSettings(): BackupSettings {
  const file = getBackupSettingsPath();
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`Cannot read backup settings ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return validateBackupSettings(parsed);
  } catch (err) {
    throw new Error(`Invalid backup settings in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Write backup.json with mode 0600 (only known keys are written). */
export function saveBackupSettings(settings: BackupSettings): string {
  const clean = validateBackupSettings(settings);
  const file = getBackupSettingsPath();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const ordered: Record<string, unknown> = {};
  for (const k of BACKUP_SETTING_KEYS) if (clean[k] !== undefined) ordered[k] = clean[k];
  writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** Delete backup.json. Returns true if a file was removed. */
export function resetBackupSettings(): boolean {
  const file = getBackupSettingsPath();
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/** Write a password file (first line = password) with mode 0600. */
export function writePasswordFile(path: string, password: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, password + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}
