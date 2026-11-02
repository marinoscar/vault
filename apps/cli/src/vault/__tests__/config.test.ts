import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVER_URL,
  clearToken,
  config,
  getApiUrl,
  getServerUrl,
  getServerUrlSource,
  getToken,
  platformConfigFile,
  saveToken,
  stateFile,
} from '../utils/config.js';

const ENV_KEYS = [
  'HOME',
  'VAULT_SERVER_URL',
  'VAULT_TOKEN',
  'VAULT_CONFIG_DIR',
  'VAULTCLI_SERVER_URL',
  'VAULTCLI_CONFIG_DIR',
];

describe('server, token and state files', () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    home = mkdtempSync(join(tmpdir(), 'vault-cli-home-'));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.HOME = home;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(home, { recursive: true, force: true });
  });

  const writeJson = (path: string, value: unknown): void => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };

  it('defaults the server when nothing is configured, and builds the /api root', () => {
    expect(getServerUrl()).toBe(DEFAULT_SERVER_URL);
    expect(getServerUrlSource()).toBe('default');
    expect(getApiUrl()).toBe(`${DEFAULT_SERVER_URL}/api`);
    expect(getToken()).toBeUndefined();
  });

  it('reads the server and token `vault login` stored in ~/.vault/config.json', () => {
    writeJson(join(home, '.vault', 'config.json'), { serverUrl: 'https://vault.example.test/', token: 'pat_abc' });
    expect(getServerUrl()).toBe('https://vault.example.test');
    expect(getServerUrlSource()).toBe('config');
    expect(getToken()).toBe('pat_abc');
    expect(config.configFile).toBe(join(home, '.vault', 'config.json'));
  });

  it('lets VAULT_ variables win over the file, then the VAULTCLI_ ones', () => {
    writeJson(join(home, '.vault', 'config.json'), { serverUrl: 'https://file.example.test', token: 'pat_file' });
    process.env.VAULTCLI_SERVER_URL = 'https://legacy.example.test';
    expect(getServerUrl()).toBe('https://legacy.example.test');
    process.env.VAULT_SERVER_URL = 'https://env.example.test';
    process.env.VAULT_TOKEN = 'pat_env';
    expect(getServerUrl()).toBe('https://env.example.test');
    expect(getServerUrlSource()).toBe('environment');
    expect(getToken()).toBe('pat_env');
  });

  it('falls back to the vaultcli auth.json and config.json in ~/.config/vaultcli (read only)', () => {
    writeJson(join(home, '.config', 'vaultcli', 'auth.json'), { token: 'pat_old', serverUrl: 'https://auth.example.test' });
    expect(getToken()).toBe('pat_old');
    expect(getServerUrl()).toBe('https://auth.example.test');
    writeJson(join(home, '.config', 'vaultcli', 'config.json'), { serverUrl: 'https://cfg.example.test' });
    expect(getServerUrl()).toBe('https://cfg.example.test');
  });

  it('honours VAULTCLI_CONFIG_DIR for auth.json, as scheduled backup jobs set it', () => {
    const dir = join(home, 'custom');
    writeJson(join(dir, 'auth.json'), { token: 'pat_job' });
    process.env.VAULTCLI_CONFIG_DIR = dir;
    expect(getToken()).toBe('pat_job');
    expect(stateFile('backup.json')).toBe(join(dir, 'backup.json'));
  });

  it('prefers VAULT_CONFIG_DIR over VAULTCLI_CONFIG_DIR', () => {
    process.env.VAULTCLI_CONFIG_DIR = join(home, 'a');
    process.env.VAULT_CONFIG_DIR = join(home, 'b');
    expect(config.configDir).toBe(join(home, 'b'));
  });

  it('keeps using a state file where vaultcli left it until a copy exists in ~/.vault', () => {
    const legacy = join(home, '.config', 'vaultcli', 'backup.json');
    expect(stateFile('backup.json')).toBe(join(home, '.vault', 'backup.json'));
    writeJson(legacy, { keepDays: 30 });
    expect(stateFile('backup.json')).toBe(legacy);
    writeJson(join(home, '.vault', 'backup.json'), { keepDays: 7 });
    expect(stateFile('backup.json')).toBe(join(home, '.vault', 'backup.json'));
  });

  it('saveToken and clearToken keep other fields and write mode 0600', () => {
    writeJson(platformConfigFile(), { serverUrl: 'https://x.example.test', nodeId: 'node-1' });
    const file = saveToken('pat_new', 'https://x.example.test');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ token: 'pat_new', nodeId: 'node-1' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(getToken()).toBe('pat_new');

    clearToken();
    const after = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(after.token).toBeUndefined();
    expect(after.nodeId).toBe('node-1');
    expect(after.serverUrl).toBe('https://x.example.test');
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});
