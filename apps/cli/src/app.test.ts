import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_NAME } from '@app/shared';
import { configDirName, createCli, envPrefix, versionText } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS, APP_VERSIONED_MANIFESTS, readVersion } from './app.js';
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
    expect(subcommands(['secrets']).sort()).toEqual(['create', 'delete', 'get', 'list', 'update']);
  });

  it('keeps the vaultcli versions and types commands', () => {
    expect(subcommands(['versions']).sort()).toEqual(['get', 'list', 'rollback']);
    expect(subcommands(['types']).sort()).toEqual(['get', 'list']);
  });

  it('keeps the vaultcli sync commands', () => {
    expect(subcommands(['sync']).sort()).toEqual(['add', 'add-dir', 'list', 'remove', 'run', 'status', 'where']);
  });

  it('keeps backup prune and the saved backup config commands', () => {
    expect(subcommands(['backup']).sort()).toEqual(['config', 'prune']);
    expect(subcommands(['backup', 'config']).sort()).toEqual(['reset', 'set', 'show', 'unset']);
  });

  it('keeps the admin backups commands', () => {
    expect(subcommands(['admin'])).toEqual(['backups']);
    expect(subcommands(['admin', 'backups']).sort()).toEqual(
      ['delete', 'download', 'list', 'run', 'schedule'].sort(),
    );
  });

  it('keeps health live and ready, and auth status and logout', () => {
    expect(subcommands(['health']).sort()).toEqual(['live', 'ready']);
    expect(subcommands(['auth']).sort()).toEqual(['login', 'logout', 'status']);
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
