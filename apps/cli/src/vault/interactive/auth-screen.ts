/** "Sign in / status" screen: reuses the stored-token functions of `vault auth`. */
import chalk from 'chalk';
import { confirm, password, select } from '@inquirer/prompts';
import { clearToken, config, hasStoredToken, saveToken } from '../utils/config.js';
import { getCurrentUser, validateToken } from '../lib/api-client.js';
import { errorLine, heading } from './ui.js';

async function signIn(): Promise<void> {
  const serverUrl = config.serverUrl;
  console.log(chalk.dim(`Create a token at ${serverUrl}/settings under "Personal Access Tokens" (starts with pat_).`));
  const token = (await password({ message: 'Paste your token', mask: '*' })).trim();
  if (!token) {
    console.log(chalk.yellow('No token entered.'));
    return;
  }
  try {
    const user = await validateToken(token);
    saveToken(token, serverUrl);
    console.log(chalk.green(`Signed in as ${user.email}`));
  } catch (err) {
    errorLine(err);
  }
}

export async function authScreen(): Promise<void> {
  heading('Sign in / status');
  console.log(`  Server: ${config.serverUrl}`);
  if (!hasStoredToken()) {
    console.log('  Not signed in.');
    if (await confirm({ message: 'Sign in with a personal access token now?', default: true })) await signIn();
    return;
  }
  try {
    const user = await getCurrentUser();
    console.log(`  Signed in as ${chalk.bold(user.email)}${user.displayName ? ` (${user.displayName})` : ''}`);
  } catch (err) {
    errorLine(err);
  }
  const action = await select({
    message: 'What next?',
    choices: [
      { name: 'Back', value: 'back' },
      { name: 'Sign in with a different token', value: 'signin' },
      { name: 'Sign out (remove the stored token)', value: 'signout' },
    ],
  });
  if (action === 'signin') await signIn();
  if (action === 'signout') {
    const file = clearToken();
    console.log(chalk.green(`Signed out. Token removed from ${file}`));
  }
}
