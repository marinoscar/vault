import { Command } from 'commander';
import { UsageError } from '@marinoscar/platform-cli/commands';
import { OutputManager, success, info, blank } from '../utils/output.js';
import { clearToken, config, getToken } from '../utils/config.js';
import { getCurrentUser } from '../lib/api-client.js';
import { describeExpiry, fetchCurrentToken, type PatListItem } from '../lib/tokens.js';
import type { OutputMode, UserInfo } from '../utils/types.js';
import { expiryColor, registerTokenCommands } from './auth-token.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

/**
 * `vault auth ...`: what `vaultcli auth` had that the platform's `login` and
 * `config` do not. Signing in is the platform's `vault login` (device flow, or
 * `--token`); this group reports who you are and removes the stored token.
 */
export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Show who you are signed in as, or sign out (sign in with: vault login)');

  auth
    .command('login')
    .description('Moved: signing in is now the top-level "vault login"')
    .action(() => {
      throw new UsageError('Signing in moved to the top level: run "vault login" (device flow) or "vault login --token <pat>".');
    });

  auth
    .command('logout')
    .description('Clear the stored authentication token')
    .action((_opts, cmd) => {
      const output = getOutput(cmd);
      const file = clearToken();
      output.result(
        { loggedOut: true },
        () => success('Logged out. Token removed from ' + file),
        () => console.log('ok'),
      );
    });

  registerTokenCommands(auth);

  auth
    .command('status')
    .description('Show current authentication status')
    .action(async (_opts, cmd) => {
      const output = getOutput(cmd);
      try {
        if (!getToken()) {
          output.result(
            { authenticated: false },
            () => info('Not authenticated. Run: vault login'),
            () => console.log('not_authenticated'),
          );
          return;
        }

        const user = await getCurrentUser();
        // The token's own row (name, expiry). Best effort: status still works without it.
        let token: PatListItem | undefined;
        try {
          token = (await fetchCurrentToken()).current;
        } catch {
          token = undefined;
        }
        const tokenInfo = token
          ? { id: token.id, name: token.name, prefix: token.tokenPrefix, expiresAt: token.expiresAt }
          : null;

        output.result(
          { authenticated: true, ...user, server: config.serverUrl, token: tokenInfo },
          (d) => {
            info('Authenticated');
            blank();
            const u = d as UserInfo & { server: string };
            console.log(`  Email:  ${u.email}`);
            console.log(`  Name:   ${u.displayName ?? '-'}`);
            console.log(`  Admin:  ${u.isAdmin ? 'Yes' : 'No'}`);
            console.log(`  Server: ${u.server}`);
            if (token) {
              const exp = describeExpiry(token.expiresAt);
              console.log(`  Token:  ${token.name} (${token.tokenPrefix}…)`);
              console.log(`  Expires: ${expiryColor(exp.level)(`${token.expiresAt.slice(0, 10)} (${exp.text})`)}`);
              if (exp.level === 'warning' || exp.level === 'expired') {
                console.log(`  Replace it with a longer-lived one: vault auth token create --duration 12 --unit months --store --revoke-current`);
              }
            }
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
