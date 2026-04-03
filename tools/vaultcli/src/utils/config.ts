import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

interface CliConfig {
  serverUrl?: string;
}

const DEFAULT_SERVER_URL = 'https://vault.marin.cr';

function getConfigDir(): string {
  return process.env.VAULTCLI_CONFIG_DIR || join(homedir(), '.config', 'vaultcli');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): CliConfig {
  try {
    const configFile = getConfigFile();
    if (!existsSync(configFile)) return {};
    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: CliConfig): void {
  const configFile = getConfigFile();
  const dir = dirname(configFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getServerUrl(): string {
  if (process.env.VAULTCLI_SERVER_URL) return process.env.VAULTCLI_SERVER_URL;
  const cfg = loadConfig();
  if (cfg.serverUrl) return cfg.serverUrl;
  return DEFAULT_SERVER_URL;
}

export function getApiUrl(): string {
  return `${getServerUrl()}/api`;
}

export function setServerUrl(url: string): void {
  const cfg = loadConfig();
  cfg.serverUrl = url;
  saveConfig(cfg);
}

export function clearConfig(): void {
  try {
    const configFile = getConfigFile();
    if (existsSync(configFile)) unlinkSync(configFile);
  } catch { /* ignore */ }
}

export function getServerUrlSource(): 'environment' | 'config' | 'default' {
  if (process.env.VAULTCLI_SERVER_URL) return 'environment';
  const cfg = loadConfig();
  if (cfg.serverUrl) return 'config';
  return 'default';
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
  get authFile(): string {
    return join(this.configDir, 'auth.json');
  },
  get configFile(): string {
    return getConfigFile();
  },
};
