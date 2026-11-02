import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { CLI_NAME } from '@app/shared';

// =============================================================================
// Where the vault CLI keeps its state, and how it finds the server and token
// =============================================================================
//
// Credentials are the platform CLI's: `vault login` writes `~/.vault/config.json`
// (`{ serverUrl, token, ... }`, mode 0600) and the environment overrides it per
// field with `VAULT_SERVER_URL` and `VAULT_TOKEN`. This module only READS them,
// except `clearToken`, which backs `vault auth logout`.
//
// The domain commands also keep their own files (`sync.json`, `backup.json`,
// `backup-password`, `backup.log`) in one directory. That directory is
//
//   1. `$VAULT_CONFIG_DIR`, or the pre-rename `$VAULTCLI_CONFIG_DIR`, when set;
//   2. otherwise `~/.vault/`.
//
// A user coming from `vaultcli` has those files in `~/.config/vaultcli/`;
// `stateFile()` keeps using such a file where it is until a copy exists in the
// new directory, so an upgrade neither loses a saved backup config nor splits it.
//
// Pre-rename environment names (`VAULTCLI_SERVER_URL`, `VAULTCLI_CONFIG_DIR`,
// `VAULTCLI_BACKUP_PASSWORD`) stay accepted; the `VAULT_` name wins when both are set.
// =============================================================================

export const DEFAULT_SERVER_URL = 'https://vault.marin.cr';

const PREFIX = `${CLI_NAME.toUpperCase().replaceAll('-', '_')}_`;

/** `VAULT_<suffix>`, derived from the CLI name (the platform's own rule). */
export function vaultEnvName(suffix: string): string {
  return `${PREFIX}${suffix}`;
}

/** The pre-rename name of a variable (`VAULTCLI_<suffix>`). */
export function legacyEnvName(suffix: string): string {
  return `VAULTCLI_${suffix}`;
}

/** Reads `VAULT_<suffix>`, then `VAULTCLI_<suffix>`; empty counts as unset. */
export function readEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[vaultEnvName(suffix)] || env[legacyEnvName(suffix)] || undefined;
}

interface StoredPlatformConfig {
  serverUrl?: string;
  token?: string;
  [key: string]: unknown;
}

function homeDir(): string {
  return homedir();
}

/** `~/.vault`, the platform CLI's config directory. */
export function platformConfigDir(): string {
  return join(homeDir(), `.${CLI_NAME}`);
}

/** `~/.vault/config.json`, written by `vault login`. */
export function platformConfigFile(): string {
  return join(platformConfigDir(), 'config.json');
}

/** `~/.config/vaultcli`, where `vaultcli` kept everything. Read-only fallback. */
export function legacyConfigDir(): string {
  return join(homeDir(), '.config', 'vaultcli');
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The `auth.json` a `vaultcli auth login` wrote: in the configured directory
 * (`$VAULT_CONFIG_DIR` / `$VAULTCLI_CONFIG_DIR`, which scheduled jobs set), else
 * in `~/.config/vaultcli`. Read only; `vault login` never writes it.
 */
function legacyAuth(): Record<string, unknown> {
  return readJson(join(getConfigDir(), 'auth.json')) ?? readJson(join(legacyConfigDir(), 'auth.json')) ?? {};
}

export function loadPlatformConfig(): StoredPlatformConfig {
  return (readJson(platformConfigFile()) as StoredPlatformConfig | null) ?? {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The `config.json` of `vaultcli` (it held only `serverUrl`, set by `config set-url`). */
function legacyConfig(): Record<string, unknown> {
  return readJson(join(getConfigDir(), 'config.json')) ?? readJson(join(legacyConfigDir(), 'config.json')) ?? {};
}

export function getConfigDir(): string {
  return readEnv('CONFIG_DIR') ?? platformConfigDir();
}

/**
 * The path of one of the domain commands' state files.
 * With no directory override, a file that exists only in the `vaultcli` directory is used there.
 */
export function stateFile(name: string): string {
  const primary = join(getConfigDir(), name);
  if (readEnv('CONFIG_DIR') !== undefined || existsSync(primary)) return primary;
  const legacy = join(legacyConfigDir(), name);
  return existsSync(legacy) ? legacy : primary;
}

export function getServerUrl(): string {
  return stripSlash(
    readEnv('SERVER_URL') ??
      str(loadPlatformConfig().serverUrl) ??
      str(legacyConfig().serverUrl) ??
      str(legacyAuth().serverUrl) ??
      DEFAULT_SERVER_URL,
  );
}

export function getServerUrlSource(): 'environment' | 'config' | 'default' {
  if (readEnv('SERVER_URL')) return 'environment';
  if (
    str(loadPlatformConfig().serverUrl) ||
    str(legacyConfig().serverUrl) ||
    str(legacyAuth().serverUrl)
  ) {
    return 'config';
  }
  return 'default';
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getApiUrl(): string {
  const server = getServerUrl();
  return /\/api$/.test(server) ? server : `${server}/api`;
}

/**
 * The bearer token: `$VAULT_TOKEN`, then `~/.vault/config.json`, then (read only)
 * the `auth.json` a `vaultcli auth login` left behind.
 */
export function getToken(): string | undefined {
  return (
    str(process.env[vaultEnvName('TOKEN')]) ??
    str(loadPlatformConfig().token) ??
    str(legacyAuth().token)
  );
}

export function hasStoredToken(): boolean {
  return getToken() !== undefined;
}

function writePlatformConfig(cfg: StoredPlatformConfig): string {
  const file = platformConfigFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Create a fresh 0600 file and rename it over the target, as the platform's own
  // writer does, so an older, looser file mode is never kept.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return file;
}

/** Store a token (and the server it belongs to) the way `vault login --token` does. */
export function saveToken(token: string, serverUrl: string): string {
  const cfg = loadPlatformConfig();
  for (const key of ['expiresAt', 'tokenId', 'tokenName']) delete cfg[key];
  return writePlatformConfig({ ...cfg, serverUrl, token, updatedAt: new Date().toISOString() });
}

/** Remove the stored token (keeps the server URL). Backs `vault auth logout`. */
export function clearToken(): string {
  const cfg = loadPlatformConfig();
  for (const key of ['token', 'expiresAt', 'tokenId', 'tokenName']) delete cfg[key];
  return writePlatformConfig(cfg);
}

export const config = {
  get apiUrl(): string {
    return getApiUrl();
  },
  get serverUrl(): string {
    return getServerUrl();
  },
  get configDir(): string {
    return getConfigDir();
  },
  get configFile(): string {
    return platformConfigFile();
  },
};
