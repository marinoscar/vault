import { Command } from 'commander';
import chalk from 'chalk';
import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

import { registerAdminCommands } from './commands/admin-backups.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerBackupCommands } from './commands/backup.js';
import { registerHealthCommands } from './commands/health.js';
import { registerSecretCommands } from './commands/secrets.js';
import { registerSyncCommands } from './commands/sync.js';
import { registerTypeCommands } from './commands/types.js';
import { registerVersionCommands } from './commands/versions.js';
import { vaultEnvName } from './utils/config.js';

// =============================================================================
// Vault's domain commands, as `createCli({ extraCommands })` registrations
// =============================================================================
//
// The platform CLI owns `init`, `login`, `api`, `config`, `node` and `deploy`
// (and the TUI). These are what Vault adds:
//
//   auth, secrets, versions, types, health, sync, backup, admin, menu
//
// The platform program has no global output options, so each command group
// carries the ones `vaultcli` had at the root (`--json`, `-q`, `--server`,
// `--no-color`, `-v`). Commander recognises a group's options before and after
// its subcommand: `vault secrets list --json` and `vault secrets --json list`.
// =============================================================================

/** The options every domain group accepts. */
export function addGlobalOptions(cmd: Command): void {
  const taken = new Set(cmd.options.flatMap((o) => [o.long, o.short].filter(Boolean)));
  const add = (flags: string, description: string): void => {
    const names = flags.split(/[ ,|]+/).filter((f) => f.startsWith('-'));
    // A group that already declares the flag (backup has its own --json) keeps its own.
    if (names.some((n) => taken.has(n))) return;
    cmd.option(flags, description);
  };

  add(
    '--json',
    'Output all results as machine-readable JSON. ' +
      'Format: {"success": true, "data": ...} on stdout, {"success": false, "error": "..."} on stderr. Parse with: jq .data',
  );
  add(
    '-q, --quiet',
    'Minimal output mode. Print only essential values with no formatting (one ID per line for lists, the secret ID for create/update).',
  );
  add(
    '--server <url>',
    `Override the Vault server URL for this invocation only. Persistent: vault login --server <url> (or ${vaultEnvName('SERVER_URL')})`,
  );
  add('--no-color', 'Disable all ANSI color codes in output.');
  add('-v, --verbose', 'Enable verbose logging. Shows HTTP request details and debug info.');

  cmd.hook('preAction', (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    if (typeof opts.server === 'string' && opts.server) process.env[vaultEnvName('SERVER_URL')] = opts.server;
    if (opts.color === false) chalk.level = 0;
  });
}

/** Runs a legacy `register*(program)` function and gives each command it added the global options. */
function withGlobalOptions(register: (program: Command) => void): CliCommandRegistration {
  return (program) => {
    const before = new Set(program.commands);
    register(program);
    for (const cmd of program.commands) if (!before.has(cmd)) addGlobalOptions(cmd);
  };
}

function registerMenuCommand(program: Command): void {
  program
    .command('menu')
    .alias('interactive')
    .description('Open the interactive terminal menu (backups, admin backups, sign-in); needs a terminal')
    .action(async () => {
      if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        throw new Error('The interactive menu needs a terminal (stdin and stdout must be a TTY). Run: vault --help');
      }
      const { launchInteractive } = await import('./interactive/index.js');
      const { readVersion } = await import('../version.js');
      await launchInteractive(readVersion());
    });
}

/** The command groups, in `--help` order. */
export const VAULT_COMMAND_NAMES = [
  'auth',
  'secrets',
  'versions',
  'types',
  'health',
  'sync',
  'backup',
  'admin',
  'menu',
] as const;

export const vaultCommands: readonly CliCommandRegistration[] = [
  withGlobalOptions(registerAuthCommands),
  withGlobalOptions(registerSecretCommands),
  withGlobalOptions(registerVersionCommands),
  withGlobalOptions(registerTypeCommands),
  withGlobalOptions(registerHealthCommands),
  withGlobalOptions(registerSyncCommands),
  withGlobalOptions(registerBackupCommands),
  withGlobalOptions(registerAdminCommands),
  registerMenuCommand,
];
