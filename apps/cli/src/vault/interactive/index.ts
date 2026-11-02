/**
 * Interactive terminal UI (`vault menu`). Never started without a TTY on both stdin and stdout.
 */
import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import { authScreen } from './auth-screen.js';
import { backupsMenu } from './backups-menu.js';
import { adminBackupsMenu } from './admin-backups-menu.js';
import { mainMenuChoices } from './admin-backups-logic.js';
import { hasStoredToken } from '../utils/config.js';
import { getCurrentUser } from '../lib/api-client.js';
import type { MenuUserState } from '../lib/admin-backups.js';
import { errorLine, isPromptExit } from './ui.js';

export function canRunInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** What the menu knows about the signed-in user (one /auth/me call). */
async function menuUserState(): Promise<MenuUserState> {
  if (!hasStoredToken()) return { kind: 'signed-out' };
  try {
    // A slow server must not hold up the menu: after 5 s, show the entry and let a 403 explain.
    const user = await Promise.race([
      getCurrentUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000).unref()),
    ]);
    return { kind: 'signed-in', permissions: user.permissions };
  } catch {
    return { kind: 'unknown' };
  }
}

export async function launchInteractive(version: string): Promise<void> {
  console.log(chalk.bold.cyan(`vault ${version}`) + chalk.dim('  (Ctrl+C to exit; run "vault --help" for all commands)'));
  try {
    let userState = await menuUserState();
    for (;;) {
      const choice = await select({
        message: 'Main menu',
        loop: false,
        choices: mainMenuChoices(userState),
      });
      if (choice === 'exit') break;
      try {
        if (choice === 'backups') await backupsMenu();
        else if (choice === 'admin-backups') await adminBackupsMenu();
        else if (choice === 'auth') {
          await authScreen();
          // Signing in or out changes who may see "Admin backups".
          userState = await menuUserState();
        }
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
