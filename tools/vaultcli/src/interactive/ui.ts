/** Small shared helpers for the interactive screens. */
import chalk from 'chalk';
import { password } from '@inquirer/prompts';
import { validatePassword } from '../lib/backup-runner.js';

export function heading(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(title));
  console.log(chalk.dim('─'.repeat(title.length)));
}

export function errorLine(err: unknown): void {
  console.log(chalk.red(err instanceof Error ? err.message : String(err)));
}

/** True for the error inquirer throws on Ctrl+C / closed input. */
export function isPromptExit(err: unknown): boolean {
  return err instanceof Error && (err.name === 'ExitPromptError' || err.name === 'AbortPromptError');
}

/** Ask for a new password twice (hidden); re-asks until both match. */
export async function askNewPassword(message = 'Backup password'): Promise<string> {
  for (;;) {
    const first = await password({
      message: `${message} (at least 6 characters)`,
      mask: '*',
      validate: (v) => validatePassword(v) ?? true,
    });
    const second = await password({ message: 'Confirm password', mask: '*' });
    if (first === second) return first;
    console.log(chalk.yellow('Passwords do not match. Try again.'));
  }
}
