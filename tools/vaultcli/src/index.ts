import { Command } from 'commander';
import chalk from 'chalk';
import { registerAuthCommands } from './commands/auth.js';
import { registerSecretCommands } from './commands/secrets.js';
import { registerVersionCommands } from './commands/versions.js';
import { registerTypeCommands } from './commands/types.js';
import { registerHealthCommands } from './commands/health.js';
import { registerConfigCommands } from './commands/config.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('vaultcli')
  .description(
    'Vault CLI — Manage secrets, credentials, and sensitive data from the command line.\n\n' +
    'A CLI for the Vault web application that lets you create, retrieve, update, delete, ' +
    'and version secrets with end-to-end encryption. Supports secret types, field validation, ' +
    'version history, and rollback. Designed for both humans and AI agents.\n\n' +
    'Three output modes: human-readable (default), --json for machine parsing, ' +
    'and --quiet for bare values ideal for shell piping and agent integration.\n\n' +
    'Secrets can be referenced by UUID or by name (unique per user). ' +
    'The CLI auto-detects UUID format and routes accordingly.',
  )
  .version(VERSION, '-V, --version', 'Display the current vaultcli version')
  .option(
    '--json',
    'Output all results as machine-readable JSON. ' +
    'Format: {"success": true, "data": ...} on stdout, ' +
    '{"success": false, "error": "..."} on stderr. ' +
    'Parse with: jq .data',
  )
  .option(
    '-q, --quiet',
    'Minimal output mode. Print only essential values with no formatting. ' +
    'For list commands, prints one ID per line. For create/update, prints the secret ID. ' +
    'Ideal for shell piping: vaultcli secrets get "my-secret" -q',
  )
  .option(
    '--server <url>',
    'Override the Vault server URL for this invocation only. ' +
    'Default: https://vault.marin.cr. ' +
    'Persistent override: vaultcli config set-url <url>',
  )
  .option(
    '--no-color',
    'Disable all ANSI color codes in output.',
  )
  .option(
    '-v, --verbose',
    'Enable verbose logging. Shows HTTP request details and debug info.',
  );

// Apply global options before any command action runs
program.hook('preAction', (thisCommand: Command) => {
  const opts = thisCommand.opts();

  if (opts.server) {
    process.env.VAULTCLI_SERVER_URL = opts.server;
  }

  if (opts.color === false) {
    chalk.level = 0;
  }
});

// Register all command groups
registerAuthCommands(program);
registerSecretCommands(program);
registerVersionCommands(program);
registerTypeCommands(program);
registerHealthCommands(program);
registerConfigCommands(program);

// Help examples
program.addHelpText(
  'after',
  `
${chalk.bold('Examples:')}

  ${chalk.dim('# Authentication')}
  $ vaultcli auth login                                       ${chalk.dim('# Authenticate with a PAT')}
  $ vaultcli auth status                                      ${chalk.dim('# Check login state')}
  $ vaultcli auth logout                                      ${chalk.dim('# Clear stored token')}

  ${chalk.dim('# Create and manage secrets')}
  $ vaultcli secrets create --name "AWS Prod" --type-id <uuid> --data '{"access_key":"AKIA...","secret_key":"wJal..."}'
  $ vaultcli secrets list                                     ${chalk.dim('# List all secrets')}
  $ vaultcli secrets list --search "aws" --sort name          ${chalk.dim('# Search and sort')}
  $ vaultcli secrets get <id>                                 ${chalk.dim('# Get secret by UUID')}
  $ vaultcli secrets get "AWS Prod"                           ${chalk.dim('# Get secret by name')}
  $ vaultcli secrets update "AWS Prod" --data '{"access_key":"AKIA...","secret_key":"NEW..."}'
  $ vaultcli secrets delete "AWS Prod"                        ${chalk.dim('# Delete by name')}

  ${chalk.dim('# Version history')}
  $ vaultcli versions list "AWS Prod"                         ${chalk.dim('# List all versions')}
  $ vaultcli versions get "AWS Prod" <version-id>             ${chalk.dim('# Inspect a version')}
  $ vaultcli versions rollback "AWS Prod" <version-id>        ${chalk.dim('# Rollback to version')}

  ${chalk.dim('# Secret types')}
  $ vaultcli types list                                       ${chalk.dim('# Browse available types')}
  $ vaultcli types get <id>                                   ${chalk.dim('# See type field schema')}

  ${chalk.dim('# Server health (no auth needed)')}
  $ vaultcli health live                                      ${chalk.dim('# Liveness check')}
  $ vaultcli health ready                                     ${chalk.dim('# Readiness check')}

  ${chalk.dim('# Configuration')}
  $ vaultcli config show                                      ${chalk.dim('# Show current configuration')}
  $ vaultcli config set-url https://my-vault.example.com      ${chalk.dim('# Override server URL')}

  ${chalk.dim('# AI agent integration')}
  $ ID=$(vaultcli secrets create --name "key" --type-id <uuid> --data '{"v":"x"}' -q)
  $ vaultcli secrets get "$ID" --json | jq '.data.values.password'
  $ vaultcli secrets list --json | jq '.data.items[].name'
  $ vaultcli types list --json | jq '.data.items[] | {id, name}'
`,
);

// Global error handler
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');

  if (isJson) {
    process.stderr.write(JSON.stringify({ success: false, error: message }) + '\n');
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
  process.exit(1);
});

program.parse(process.argv);
