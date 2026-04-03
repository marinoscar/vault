import { Command } from 'commander';
import { createInterface } from 'readline';
import { OutputManager, success, info, blank } from '../utils/output.js';
import { config } from '../utils/config.js';
import { saveAuth, loadAuth, clearAuth } from '../lib/auth-store.js';
import { validateToken, getCurrentUser } from '../lib/api-client.js';
import type { OutputMode, UserInfo } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage authentication with the Vault API');

  auth
    .command('login')
    .description('Authenticate with a personal access token')
    .action(async (_opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const serverUrl = config.serverUrl;

        output.humanOnly(() => {
          info('Vault CLI — Authentication');
          blank();
          info(`Server: ${serverUrl}`);
          blank();
        });

        const hasToken = await prompt('Do you have an existing personal access token? (y/n): ');

        if (hasToken.toLowerCase() !== 'y' && hasToken.toLowerCase() !== 'yes') {
          output.humanOnly(() => {
            blank();
            info('To create a new token:');
            info(`  1. Open ${serverUrl}/settings`);
            info('  2. Navigate to "Personal Access Tokens"');
            info('  3. Click "Create Token"');
            info('  4. Copy the generated token (starts with pat_)');
            blank();
          });
        }

        const token = await prompt('Paste your token: ');

        if (!token) {
          output.fail('No token provided');
          process.exit(1);
        }

        output.humanOnly(() => info('Validating token...'));

        const user = await validateToken(token);

        saveAuth({ token, serverUrl });

        output.result<UserInfo>(
          user,
          (u) => {
            blank();
            success(`Authenticated as ${u.email}`);
            if (u.displayName) info(`  Name: ${u.displayName}`);
            info(`  Admin: ${u.isAdmin ? 'Yes' : 'No'}`);
            blank();
            success('Token saved to ' + config.authFile);
          },
          (u) => console.log(u.email),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  auth
    .command('logout')
    .description('Clear stored authentication token')
    .action((_opts, cmd) => {
      const output = getOutput(cmd);
      clearAuth();
      output.result(
        { loggedOut: true },
        () => success('Logged out. Token removed from ' + config.authFile),
        () => console.log('ok'),
      );
    });

  auth
    .command('status')
    .description('Show current authentication status')
    .action(async (_opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const authData = loadAuth();
        if (!authData) {
          output.result(
            { authenticated: false },
            () => info('Not authenticated. Run: vaultcli auth login'),
            () => console.log('not_authenticated'),
          );
          return;
        }

        const user = await getCurrentUser();

        output.result(
          { authenticated: true, ...user, server: authData.serverUrl },
          (d) => {
            info('Authenticated');
            blank();
            const u = d as UserInfo & { server: string };
            console.log(`  Email:  ${u.email}`);
            console.log(`  Name:   ${u.displayName ?? '-'}`);
            console.log(`  Admin:  ${u.isAdmin ? 'Yes' : 'No'}`);
            console.log(`  Server: ${u.server}`);
            blank();
          },
          (d) => {
            const u = d as UserInfo;
            console.log(u.email);
          },
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
