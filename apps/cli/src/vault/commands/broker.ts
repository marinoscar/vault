import { Command } from 'commander';
import { OutputManager, blank, header, keyValue, success, tableHeader, tableRow, warn } from '../utils/output.js';
import { resolveSecret } from '../lib/api-client.js';
import {
  BROKER_TOKEN_DEFAULT_EXPIRES_DAYS,
  brokerBaseUrl,
  createBrokerToken,
  listBrokerTokens,
  normaliseOrigin,
  parseExpiresDays,
  revokeBrokerToken,
} from '../lib/broker.js';
import { formatDate, shortId, truncate } from '../lib/formatters.js';
import { promptConfirm } from '../lib/password-prompt.js';
import type { OutputMode } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export const TOKEN_WARNING = 'Copy this token now: it is shown once and cannot be retrieved later.';

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export function registerBrokerCommands(program: Command): void {
  const broker = program
    .command('broker')
    .description('Credential broker: base URLs and broker tokens (agents use a key without seeing it)');

  // vault broker url <id-or-name> [--origin <origin>]
  broker
    .command('url <id-or-name>')
    .description('Print the broker base URL for each allowed origin of a secret')
    .option('--origin <origin>', 'Only this origin (must be one the secret allows)')
    .action(async (idOrName, opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const secret = await resolveSecret(idOrName);
        const origins = secret.brokerOrigins ?? [];
        if (!secret.brokerAccess || origins.length === 0) {
          throw new Error(
            `The broker is off for "${secret.name}". Enable it: vault secrets broker ${secret.name} on --origin <https-origin>`,
          );
        }
        let chosen = origins;
        if (opts.origin !== undefined) {
          const want = normaliseOrigin(String(opts.origin));
          chosen = origins.filter((o) => normaliseOrigin(o) === want);
          if (chosen.length === 0) {
            throw new Error(`"${opts.origin}" is not an allowed origin of "${secret.name}". Allowed: ${origins.join(', ')}`);
          }
        }
        const urls = chosen.map((origin) => ({ origin, url: brokerBaseUrl(secret.id, origin) }));
        output.result(
          { id: secret.id, name: secret.name, urls },
          (r) => r.urls.forEach((u) => console.log(u.url)),
          (r) => r.urls.forEach((u) => console.log(u.url)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  const token = broker.command('token').description('Broker tokens (vbk_...): reach only the broker, never a secret value');

  // vault broker token create
  token
    .command('create')
    .description('Create a broker token (printed once)')
    .requiredOption('--name <name>', 'A name to recognise the token')
    .option('--expires <days>', `Lifetime in days (default ${BROKER_TOKEN_DEFAULT_EXPIRES_DAYS}), e.g. 90 or 90d`)
    .option('--secret <id-or-name>', 'Restrict to this secret (repeatable); default every broker-enabled secret', collect)
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const expiresInDays =
          opts.expires === undefined ? BROKER_TOKEN_DEFAULT_EXPIRES_DAYS : parseExpiresDays(String(opts.expires));
        const refs: string[] = opts.secret ?? [];
        const secretIds: string[] = [];
        for (const ref of refs) secretIds.push((await resolveSecret(ref)).id);
        const created = await createBrokerToken({
          name: String(opts.name),
          expiresInDays,
          ...(secretIds.length > 0 ? { secretIds } : {}),
        });
        output.result(
          created,
          (t) => {
            success(`Broker token "${t.name}" created.`);
            keyValue('ID', t.id);
            keyValue('Expires', t.expiresAt ? formatDate(t.expiresAt) : '-');
            keyValue('Secrets', t.secretIds.length > 0 ? String(t.secretIds.length) : 'all broker-enabled');
            blank();
            console.log(t.token);
            blank();
            warn(TOKEN_WARNING);
          },
          (t) => console.log(t.token),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault broker token list
  token
    .command('list')
    .description('List your broker tokens (never the token itself)')
    .action(async (_opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const tokens = await listBrokerTokens();
        output.result(
          tokens,
          (rows) => {
            header(`Broker tokens (${rows.length})`);
            const widths = [10, 24, 14, 8, 14, 12];
            tableHeader(['ID', 'Name', 'Prefix', 'Secrets', 'Expires', 'Status'], widths);
            for (const t of rows) {
              tableRow(
                [
                  shortId(t.id),
                  truncate(t.name, 24),
                  t.tokenPrefix,
                  t.secretIds.length > 0 ? String(t.secretIds.length) : 'all',
                  t.expiresAt ? formatDate(t.expiresAt).slice(0, 12) : '-',
                  t.revokedAt ? 'revoked' : t.expiresAt && new Date(t.expiresAt) < new Date() ? 'expired' : 'active',
                ],
                widths,
              );
            }
            blank();
          },
          (rows) => rows.forEach((t) => console.log(t.id)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault broker token revoke <id> [--yes]
  token
    .command('revoke <id>')
    .description('Revoke a broker token')
    .option('-y, --yes', 'Do not ask for confirmation (required when not run in a terminal)')
    .action(async (id, opts, cmd) => {
      const output = getOutput(cmd);
      try {
        if (opts.yes !== true) {
          if (!process.stdin.isTTY) {
            throw new Error('Refusing to revoke a broker token without confirmation: not a terminal. Pass --yes.');
          }
          const ok = await promptConfirm(`Revoke broker token ${id}? Agents using it lose access. [y/N] `);
          if (!ok) {
            output.result({ id, revoked: false, cancelled: true }, () => console.log('Cancelled; nothing revoked.'), () => undefined);
            return;
          }
        }
        await revokeBrokerToken(String(id));
        output.result({ id, revoked: true }, () => success(`Broker token ${id} revoked.`), () => console.log(id));
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
