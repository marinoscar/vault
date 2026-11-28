import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_NAME } from '@app/shared';
import { configDirName, createCli, envPrefix, versionText } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS, APP_TUI_SCREENS, APP_VERSIONED_MANIFESTS, readVersion } from './app.js';
import { VAULT_COMMAND_NAMES } from './vault/register.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

interface PackageJson {
  version: string;
  bin?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as PackageJson;
}

function build(): ReturnType<typeof createCli> {
  resetCliForTests();
  return createCli(APP_CLI_OPTIONS);
}

function subcommands(path: string[]): string[] {
  let cmd = build().program;
  for (const name of path) {
    const next = cmd.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`no command ${path.join(' ')}`);
    cmd = next;
  }
  return cmd.commands.map((c) => c.name());
}

beforeEach(() => {
  resetCliForTests();
});

describe('the version', () => {
  it('is read from package.json, the only place it lives', () => {
    expect(readVersion()).toBe(readPackageJson().version);
    expect(APP_CLI_OPTIONS.version).toBe(readPackageJson().version);
  });

  it('is a semantic version, 2.x or later (the binary was renamed from vaultcli)', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number(readVersion().split('.')[0])).toBeGreaterThanOrEqual(2);
  });

  it('is printed by --version beside the platform engine version', () => {
    createCli(APP_CLI_OPTIONS);
    expect(versionText()).toMatch(new RegExp(`^${readVersion().replaceAll('.', '\\.')} \\(platform \\S+\\)$`));
  });
});

describe('the identity', () => {
  it('is the vault binary, named in identity.json', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'shared', 'identity.json'), 'utf8')) as {
      cliName: string;
    };
    expect(CLI_NAME).toBe(manifest.cliName);
    expect(CLI_NAME).toBe('vault');
  });

  it("package.json's bin has exactly one key, and it equals CLI_NAME", () => {
    const bin = readPackageJson().bin ?? {};
    expect(Object.keys(bin)).toEqual([CLI_NAME]);
    expect(bin[CLI_NAME]).toBe('./dist/cli.js');
  });

  it('derives the config directory and environment prefix from CLI_NAME', () => {
    createCli(APP_CLI_OPTIONS);
    expect(configDirName()).toBe('.vault');
    expect(envPrefix()).toBe('VAULT_');
  });
});

describe('the command surface', () => {
  it('lists the six platform commands, then the Vault groups, in order', () => {
    expect(subcommands([])).toEqual(['init', 'login', 'api', 'config', 'node', 'deploy', ...VAULT_COMMAND_NAMES]);
  });

  it('keeps the vaultcli secrets commands', () => {
    expect(subcommands(['secrets']).sort()).toEqual(['create', 'delete', 'get', 'list', 'reveal-access', 'update']);
  });

  it('keeps the vaultcli versions and types commands', () => {
    expect(subcommands(['versions']).sort()).toEqual(['get', 'list', 'rollback']);
    expect(subcommands(['types']).sort()).toEqual(['get', 'list']);
  });

  it('keeps the vaultcli sync commands', () => {
    expect(subcommands(['sync']).sort()).toEqual(['add', 'add-dir', 'list', 'remove', 'run', 'status', 'where']);
  });

  it('keeps backup prune and the saved backup config commands', () => {
    expect(subcommands(['backup']).sort()).toEqual(['config', 'prune', 'schedule', 'status']);
    expect(subcommands(['backup', 'config']).sort()).toEqual(['reset', 'set', 'show', 'unset']);
  });

  it('adds backup status and backup schedule status, install and remove', () => {
    expect(subcommands(['backup', 'schedule']).sort()).toEqual(['install', 'remove', 'status']);
    const install = build()
      .program.commands.find((c) => c.name() === 'backup')
      ?.commands.find((c) => c.name() === 'schedule')
      ?.commands.find((c) => c.name() === 'install');
    const flags = install?.options.map((o) => o.long) ?? [];
    for (const flag of ['--daily', '--every-hours', '--weekly', '--at', '--cron', '--yes', '--force', '--json']) {
      expect(flags).toContain(flag);
    }
  });

  it('gives backup a hidden --scheduled flag for the cron job', () => {
    const backup = build().program.commands.find((c) => c.name() === 'backup');
    const opt = backup?.options.find((o) => o.long === '--scheduled');
    expect(opt).toBeDefined();
    expect(opt?.hidden).toBe(true);
  });

  it('keeps the admin backups commands', () => {
    expect(subcommands(['admin'])).toEqual(['backups']);
    expect(subcommands(['admin', 'backups']).sort()).toEqual(
      ['delete', 'download', 'list', 'run', 'schedule'].sort(),
    );
  });

  it('keeps health live and ready, and auth status and logout', () => {
    expect(subcommands(['health']).sort()).toEqual(['live', 'ready']);
    expect(subcommands(['auth']).sort()).toEqual(['login', 'logout', 'status', 'token']);
  });

  it('adds auth token create, list and revoke', () => {
    expect(subcommands(['auth', 'token']).sort()).toEqual(['create', 'list', 'revoke']);
  });

  it('registers the Backups TUI screen lazily, between Invoke (20) and Status (30)', async () => {
    const screen = APP_TUI_SCREENS.find((s) => s.route === 'backups');
    expect(screen).toMatchObject({ route: 'backups', order: 25 });
    expect(screen?.component).toBeUndefined();
    expect(typeof screen?.load).toBe('function');
    const label = screen!.label as (ctx: { loggedIn: boolean }) => string;
    expect(label({ loggedIn: true })).toMatch(/^Backups/);
    expect(label({ loggedIn: false })).toMatch(/not logged in/);
    expect(typeof (await screen!.load!())).toBe('function');
  });

  it('registers the Access token TUI screen lazily, between Status (30) and Worker node (40)', async () => {
    const screen = APP_TUI_SCREENS.find((s) => s.route === 'token');
    expect(APP_TUI_SCREENS.map((s) => s.route)).toEqual(['backups', 'token']);
    expect(screen).toMatchObject({ route: 'token', order: 35 });
    expect(screen?.component).toBeUndefined();
    expect(typeof screen?.load).toBe('function');
    expect(APP_CLI_OPTIONS.tuiScreens).toBe(APP_TUI_SCREENS);
    expect(typeof (await screen!.load!())).toBe('function');
  });

  it('keeps the backup flags scripts rely on', () => {
    const backup = build().program.commands.find((c) => c.name() === 'backup');
    const flags = backup?.options.map((o) => o.long) ?? [];
    for (const flag of [
      '--output',
      '--password-env',
      '--password-file',
      '--password',
      '--contents',
      '--secrets',
      '--no-secrets',
      '--media',
      '--no-media',
      '--include-versions',
      '--keep-days',
      '--keep-last',
      '--no-prune',
      '--prune-dry-run',
      '--overwrite',
      '--utc',
      '--json',
    ]) {
      expect(flags).toContain(flag);
    }
  });

  it('gives every domain group the output options vaultcli had at the root', () => {
    const program = build().program;
    for (const name of ['secrets', 'versions', 'types', 'health', 'sync', 'admin', 'auth']) {
      const flags = program.commands.find((c) => c.name() === name)?.options.map((o) => o.long) ?? [];
      expect(flags, name).toEqual(expect.arrayContaining(['--json', '--quiet', '--server', '--no-color', '--verbose']));
    }
  });
});

describe('the deploy version step', () => {
  it('leaves apps/cli out: the CLI keeps its own version', () => {
    expect(APP_CLI_OPTIONS.deploy?.versionedManifests).toEqual(APP_VERSIONED_MANIFESTS);
    expect(APP_VERSIONED_MANIFESTS).not.toContain('apps/cli/package.json');
    expect(APP_VERSIONED_MANIFESTS[0]).toBe('apps/api/package.json');
  });
});
