/**
 * Output path templating for `vaultcli backup`.
 *
 * Pure functions only (no filesystem or network access) so they can be unit
 * tested in isolation. The command layer is responsible for resolving `{user}`
 * (via the API) and for picking a non-colliding path on disk.
 */

/** Tokens accepted inside an output template, in documentation order. */
export const BACKUP_FILENAME_TOKENS = [
  'date',
  'time',
  'datetime',
  'timestamp',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'host',
  'user',
] as const;

export type BackupFilenameToken = (typeof BACKUP_FILENAME_TOKENS)[number];

export const DEFAULT_BACKUP_TEMPLATE = 'vault-backup-{datetime}.zip';

export interface ExpandBackupFilenameOptions {
  /** Use UTC for date/time tokens instead of local time. */
  utc?: boolean;
  /** Host name for `{host}` (typically `os.hostname()`); sanitized here. */
  host?: string;
  /** Signed-in user's email or local part for `{user}`; sanitized here. */
  user?: string;
  /** Home directory used to expand a leading `~`. Omit to leave `~` as is. */
  homeDir?: string;
}

const TOKEN_RE = /\{([^{}]*)\}/g;

/** Returns the set of tokens referenced by a template (valid or not). */
export function templateTokens(template: string): string[] {
  const found: string[] = [];
  for (const m of template.matchAll(TOKEN_RE)) found.push(m[1]);
  return found;
}

/** True when the template references `{user}` (so the caller must look it up). */
export function templateUsesUser(template: string): boolean {
  return templateTokens(template).includes('user');
}

/**
 * Reduce a value to filesystem-safe characters (letters, digits, `.`, `_`,
 * `-`), so it works on Windows, macOS and Linux. Other characters become `-`;
 * runs of `-` collapse and leading/trailing `-`/`.` are trimmed.
 */
export function sanitizeTokenValue(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'unknown';
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Expand an output template into a path.
 *
 * Tokens: `{date}` YYYY-MM-DD, `{time}` HHmmss, `{datetime}` YYYY-MM-DD_HHmmss,
 * `{timestamp}` unix seconds, `{year}` `{month}` `{day}` `{hour}` `{minute}`
 * `{second}` (zero-padded), `{host}`, `{user}` (local part of the email).
 * A leading `~` expands to `homeDir` when provided.
 *
 * @throws Error on an unknown token (the message lists the valid ones), or when
 *   `{user}` / `{host}` is used but no value was supplied.
 */
export function expandBackupFilename(
  template: string,
  date: Date,
  options: ExpandBackupFilenameOptions = {},
): string {
  if (!template || !template.trim()) {
    throw new Error('Output template must not be empty');
  }

  const unknown = templateTokens(template).filter(
    (t) => !(BACKUP_FILENAME_TOKENS as readonly string[]).includes(t),
  );
  if (unknown.length > 0) {
    const list = [...new Set(unknown)].map((t) => `{${t}}`).join(', ');
    const valid = BACKUP_FILENAME_TOKENS.map((t) => `{${t}}`).join(' ');
    throw new Error(`Unknown token(s) in output template: ${list}. Valid tokens: ${valid}`);
  }

  const utc = options.utc === true;
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();

  const dateStr = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hour)}${pad(minute)}${pad(second)}`;

  const resolve = (token: BackupFilenameToken): string => {
    switch (token) {
      case 'date':
        return dateStr;
      case 'time':
        return timeStr;
      case 'datetime':
        return `${dateStr}_${timeStr}`;
      case 'timestamp':
        return String(Math.floor(date.getTime() / 1000));
      case 'year':
        return pad(year, 4);
      case 'month':
        return pad(month);
      case 'day':
        return pad(day);
      case 'hour':
        return pad(hour);
      case 'minute':
        return pad(minute);
      case 'second':
        return pad(second);
      case 'host':
        if (options.host === undefined) throw new Error('{host} used but no host name was provided');
        return sanitizeTokenValue(options.host);
      case 'user': {
        if (options.user === undefined) throw new Error('{user} used but no user was provided');
        const local = options.user.includes('@') ? options.user.slice(0, options.user.indexOf('@')) : options.user;
        return sanitizeTokenValue(local);
      }
    }
  };

  let expanded = template.replace(TOKEN_RE, (_m, token: string) => resolve(token as BackupFilenameToken));

  if (options.homeDir !== undefined && (expanded === '~' || /^~[\\/]/.test(expanded))) {
    expanded = options.homeDir + expanded.slice(1);
  }

  return expanded;
}

/**
 * Candidate path for collision avoidance: attempt 0 is the path itself,
 * attempt n inserts `-n` before the extension (`a/b.zip` -> `a/b-2.zip`).
 * A dot that starts the basename (e.g. `.zip`) is not treated as an extension.
 */
export function withCollisionSuffix(path: string, attempt: number): string {
  if (attempt <= 0) return path;
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dot = path.lastIndexOf('.');
  if (dot > sep + 1) {
    return `${path.slice(0, dot)}-${attempt}${path.slice(dot)}`;
  }
  return `${path}-${attempt}`;
}
