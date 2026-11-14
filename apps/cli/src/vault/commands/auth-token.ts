import { Command } from 'commander';
import chalk from 'chalk';
import { UsageError } from '@marinoscar/platform-cli/commands';

import { OutputManager, blank, success, tableHeader, warn } from '../utils/output.js';
import { getStoredTokenMeta, getToken, getTokenSource } from '../utils/config.js';
import {
  createPat,
  currentTokenCandidates,
  describeExpiry,
  envOverrideWarning,
  formatDate,
  isActiveToken,
  listPats,
  parseTokenDuration,
  parseTokenUnit,
  replaceStoredToken,
  resolveTokenName,
  revokePat,
  type ExpiryLevel,
  type PatListItem,
  type TokenDurationUnit,
} from '../lib/tokens.js';
import type { OutputMode } from '../utils/types.js';

// =============================================================================
// `vault auth token create | list | revoke`
// =============================================================================
//
// `vault login` stores a 90-day token; a scheduled backup needs a longer one.
// `create --store --revoke-current` swaps the stored token for a new one of the
// chosen lifetime: create, store (as `vault login --token` does), verify with the
// new token, then revoke the old one. Without `--store` the token is printed
// once and never again.
// =============================================================================

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function expiryColor(level: ExpiryLevel): (s: string) => string {
  switch (level) {
    case 'ok':
      return chalk.green;
    case 'warning':
      return chalk.yellow;
    case 'expired':
      return chalk.red;
    default:
      return chalk.dim;
  }
}

export interface CreateTokenOptions {
  duration: number;
  unit: TokenDurationUnit;
  name: string;
  store: boolean;
  revokeCurrent: boolean;
}

/** Validates `vault auth token create` options. Throws a UsageError. */
export function parseCreateTokenOptions(
  raw: { duration?: string; unit?: string; name?: string; store?: boolean; revokeCurrent?: boolean },
  ctx: { tokenSource: ReturnType<typeof getTokenSource>; now?: Date; host?: string } = { tokenSource: getTokenSource() },
): CreateTokenOptions {
  if (raw.duration === undefined) throw new UsageError('--duration <n> is required (1 to 999).');
  if (raw.unit === undefined) throw new UsageError('--unit <minutes|days|months> is required.');
  const duration = parseTokenDuration(raw.duration);
  const unit = parseTokenUnit(raw.unit);
  const name = resolveTokenName(raw.name, ctx.now, ctx.host);
  const store = raw.store === true;
  const revokeCurrent = raw.revokeCurrent === true;
  if (revokeCurrent && !store) {
    throw new UsageError('--revoke-current needs --store: the old token is revoked only once the new one is stored and verified.');
  }
  if (revokeCurrent && ctx.tokenSource === 'environment') {
    throw new UsageError(
      '--revoke-current would revoke the token in the environment variable, which still takes precedence over the stored one. Update the variable, then revoke the old token with: vault auth token revoke <id>',
    );
  }
  return { duration, unit, name, store, revokeCurrent };
}

/** `vault auth token revoke` refuses the token in use unless `--yes`. */
export function checkRevokeAllowed(
  id: string,
  list: readonly PatListItem[],
  storedToken: string | undefined,
  storedTokenId: string | undefined,
  yes: boolean,
  now: Date = new Date(),
): void {
  const candidates = currentTokenCandidates(list, storedToken, storedTokenId, now);
  if (!yes && candidates.some((t) => t.id === id)) {
    throw new UsageError(
      candidates.length === 1
        ? 'That is the token this CLI is using; revoking it signs you out. Pass --yes to revoke it anyway.'
        : 'That token may be the one this CLI is using (it shares the prefix); revoking it may sign you out. Pass --yes to revoke it anyway.',
    );
  }
}

/** Reports a failure the way the other domain commands do (envelope in --json, exit 1). */
function fail(output: OutputManager, err: unknown): never {
  if (err instanceof UsageError) throw err;
  output.fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

export function registerTokenCommands(auth: Command): void {
  const token = auth
    .command('token')
    .description('Manage personal access tokens: create a longer-lived one, list them, revoke one');

  token
    .command('create')
    .description('Create a personal access token (and optionally store it in place of the current one)')
    .option('--duration <n>', 'Lifetime, 1 to 999 (in --unit)')
    .option('--unit <unit>', 'minutes, days or months')
    .option('--name <label>', 'Token name (default: vault-cli <hostname> <date>)')
    .option('--store', 'Store the new token in ~/.vault/config.json instead of printing it')
    .option('--revoke-current', 'With --store: revoke the token in use once the new one is stored and verified')
    .addHelpText(
      'after',
      '\nExamples:\n  vault auth token create --duration 12 --unit months --store --revoke-current\n  vault auth token create --duration 30 --unit days --name "ci runner"   # prints the token once',
    )
    .action(async (raw: Record<string, string | boolean | undefined>, cmd: Command) => {
      const output = getOutput(cmd);
      const opts = parseCreateTokenOptions(
        {
          duration: raw.duration as string | undefined,
          unit: raw.unit as string | undefined,
          name: raw.name as string | undefined,
          store: raw.store === true,
          revokeCurrent: raw.revokeCurrent === true,
        },
        { tokenSource: getTokenSource() },
      );
      if (!getToken()) fail(output, new Error('Not authenticated. Run: vault login'));
      try {
        if (!opts.store) {
          const created = await createPat({ name: opts.name, duration: opts.duration, unit: opts.unit });
          output.result(
            created,
            (c) => {
              success(`Created token "${c.name}" (expires ${formatDate(c.expiresAt)}, ${describeExpiry(c.expiresAt).text}).`);
              blank();
              console.log(`  ${c.token}`);
              blank();
              warn('Copy it now: it will not be shown again. Store it with: vault login --token <token>');
            },
            (c) => console.log(c.token),
          );
          return;
        }

        const result = await replaceStoredToken({ ...opts, revokePrevious: opts.revokeCurrent });
        const envWins = getTokenSource() === 'environment';
        const data = {
          id: result.created.id,
          name: result.created.name,
          prefix: result.created.tokenPrefix,
          expiresAt: result.created.expiresAt,
          stored: result.file,
          previous: result.previous ? { id: result.previous.id, name: result.previous.name } : null,
          revokedPrevious: result.revokedPrevious,
          environmentOverride: envWins,
        };
        output.result(
          data,
          (d) => {
            const exp = describeExpiry(d.expiresAt);
            success(`Stored new token "${d.name}" (${d.prefix}…) in ${d.stored}.`);
            console.log(`  Expires: ${expiryColor(exp.level)(`${formatDate(d.expiresAt)} (${exp.text})`)}`);
            if (d.revokedPrevious && d.previous) console.log(`  Revoked the previous token "${d.previous.name}".`);
            else if (d.previous) console.log(chalk.dim(`  The previous token "${d.previous.name}" is still active (vault auth token revoke ${d.previous.id}).`));
            if (envWins) warn(envOverrideWarning());
          },
          (d) => console.log(d.id),
        );
        if (envWins && output.mode === 'quiet') warn(envOverrideWarning());
      } catch (err) {
        fail(output, err);
      }
    });

  token
    .command('list')
    .description('List your personal access tokens (the one in use is marked)')
    .option('--all', 'Include revoked and expired tokens')
    .action(async (raw: { all?: boolean }, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const now = new Date();
        const all = await listPats();
        const list = raw.all ? all : all.filter((t) => isActiveToken(t, now));
        const candidates = currentTokenCandidates(all, getToken(), getStoredTokenMeta().tokenId, now);
        const currentIds = new Set(candidates.map((t) => t.id));
        const rows = list.map((t) => ({ ...t, current: currentIds.has(t.id) }));
        output.result(
          rows,
          (items) => {
            if (items.length === 0) {
              console.log('No tokens.');
              return;
            }
            const widths = [1, 28, 9, 26, 10, 36];
            tableHeader(['', 'NAME', 'PREFIX', 'EXPIRES', 'LAST USED', 'ID'], widths);
            for (const t of items) {
              const exp = describeExpiry(t.expiresAt, now);
              const level: ExpiryLevel = t.revokedAt ? 'expired' : exp.level;
              const expires = `${formatDate(t.expiresAt)} (${t.revokedAt ? 'revoked' : exp.text})`;
              // Pad before colouring: padEnd would count the ANSI codes.
              const cells = [
                t.current ? '*' : '',
                t.name.length > 28 ? `${t.name.slice(0, 27)}…` : t.name,
                t.tokenPrefix,
                expiryColor(level)(expires.padEnd(widths[3]!)),
                formatDate(t.lastUsedAt),
                t.id,
              ];
              console.log('  ' + cells.map((c, i) => (i === 3 ? c : c.padEnd(widths[i]!))).join('  '));
            }
            if (items.some((t) => t.current)) console.log(chalk.dim('\n  * the token this CLI is using'));
          },
          (items) => items.forEach((t) => console.log(t.id)),
        );
      } catch (err) {
        fail(output, err);
      }
    });

  token
    .command('revoke <id>')
    .description('Revoke a personal access token by id (refuses the one in use without --yes)')
    .option('-y, --yes', 'Revoke even when it is the token this CLI is using')
    .action(async (id: string, raw: { yes?: boolean }, cmd: Command) => {
      const output = getOutput(cmd);
      try {
        const list = await listPats();
        checkRevokeAllowed(id, list, getToken(), getStoredTokenMeta().tokenId, raw.yes === true);
        await revokePat(id);
        output.result(
          { revoked: true, id },
          () => success(`Revoked token ${id}.`),
          () => console.log(id),
        );
      } catch (err) {
        fail(output, err);
      }
    });
}
