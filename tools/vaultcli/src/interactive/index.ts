/**
 * Interactive terminal UI (`vaultcli` with no arguments in a terminal, or
 * `vaultcli -i`). Never started without a TTY on both stdin and stdout.
 */
import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import { VERSION } from '../version.js';
import { authScreen } from './auth-screen.js';
import { backupsMenu } from './backups-menu.js';
import { errorLine, isPromptExit } from './ui.js';

export function canRunInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function launchInteractive(): Promise<void> {
  console.log(chalk.bold.cyan(`vaultcli ${VERSION}`) + chalk.dim('  (Ctrl+C to exit; run "vaultcli --help" for all commands)'));
  try {
    for (;;) {
      const choice = await select({
        message: 'Main menu',
        loop: false,
        choices: [
          { name: 'Backups ▸', value: 'backups' },
          { name: 'Sign in / status', value: 'auth' },
          { name: 'Exit', value: 'exit' },
        ],
      });
      if (choice === 'exit') break;
      try {
        if (choice === 'backups') await backupsMenu();
        else if (choice === 'auth') await authScreen();
      } catch (err) {
        if (isPromptExit(err)) throw err;
        errorLine(err);
      }
    }
  } catch (err) {
    if (!isPromptExit(err)) throw err;
  }
  process.exit(0);
}
