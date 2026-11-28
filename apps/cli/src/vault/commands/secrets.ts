import { Command } from 'commander';
import { OutputManager } from '../utils/output.js';
import {
  listSecrets,
  resolveSecret,
  createSecret,
  updateSecret,
  deleteSecret,
  setAssistantReveal,
} from '../lib/api-client.js';
import { buildInjection, describeInjection, setBrokerAccess, brokerBaseUrl, type BrokerAccessBody } from '../lib/broker.js';
import { formatSecretTable, formatSecretDetail } from '../lib/formatters.js';
import type { OutputMode, SecretListItem, PaginatedResponse } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export const BROKER_NOTE =
  'Agents call the base URL with a broker token; Vault adds the key and forwards to the allowed origin. The key is never returned.';

const collectOption = (value: string, previous: string[] = []): string[] => [...previous, value];

export const REVEAL_WARNING =
  "Warning: a revealed value enters the assistant's conversation, and every read is recorded in Agent activity.";

/** `on`/`off` (case-insensitive) to a boolean; anything else is undefined. */
export function parseOnOff(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return undefined;
}

export function registerSecretCommands(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Manage secrets — create, list, get, update, and delete encrypted secrets');

  // vault secrets list
  secrets
    .command('list')
    .description('List secrets (metadata only, no decryption)')
    .option('--type-id <uuid>', 'Filter by secret type ID')
    .option('--search <term>', 'Search secret names')
    .option('--page <n>', 'Page number', '1')
    .option('--page-size <n>', 'Items per page', '20')
    .option('--sort <field>', 'Sort by: createdAt, name, updatedAt', 'updatedAt')
    .option('--order <dir>', 'Sort order: asc, desc', 'desc')
    .option('--assistant-reveal <on|off>', 'Only secrets revealed (on) or not revealed (off) to assistants')
    .option('--broker <on|off>', 'Only secrets with the credential broker on or off')
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const reveal = opts.assistantReveal === undefined ? undefined : parseOnOff(String(opts.assistantReveal));
        if (opts.assistantReveal !== undefined && reveal === undefined) {
          output.fail('Invalid --assistant-reveal value. Use "on" or "off".');
          process.exit(1);
        }
        const brokerFilter = opts.broker === undefined ? undefined : parseOnOff(String(opts.broker));
        if (opts.broker !== undefined && brokerFilter === undefined) {
          output.fail('Invalid --broker value. Use "on" or "off".');
          process.exit(1);
        }
        const result = await listSecrets({
          page: parseInt(opts.page, 10),
          pageSize: parseInt(opts.pageSize, 10),
          typeId: opts.typeId,
          search: opts.search,
          sortBy: opts.sort,
          sortOrder: opts.order,
          assistantReveal: reveal,
          brokerAccess: brokerFilter,
        });

        output.result<PaginatedResponse<SecretListItem>>(
          result,
          (r) => formatSecretTable(r),
          (r) => r.items.forEach((i) => console.log(i.id)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault secrets get <id-or-name>
  secrets
    .command('get <id-or-name>')
    .description('Get a secret by ID or name, with decrypted data')
    .action(async (idOrName, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const secret = await resolveSecret(idOrName);
        const slim = {
          id: secret.id,
          name: secret.name,
          updatedAt: secret.updatedAt,
          values: secret.values ?? {},
          assistantReveal: secret.assistantReveal ?? false,
          assistantRevealChangedAt: secret.assistantRevealChangedAt ?? null,
          brokerAccess: secret.brokerAccess ?? false,
          brokerOrigins: secret.brokerOrigins ?? [],
          brokerInjection: secret.brokerInjection ?? null,
          brokerField: secret.brokerField ?? null,
        };

        output.result(
          slim,
          () => formatSecretDetail(secret),
          () => console.log(secret.id),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault secrets create
  secrets
    .command('create')
    .description('Create a new secret')
    .requiredOption('--name <name>', 'Secret name')
    .requiredOption('--type-id <uuid>', 'Secret type ID')
    .requiredOption('--data <json>', 'JSON object of field values, e.g. \'{"username":"admin","password":"s3cret"}\'')
    .option('--description <text>', 'Description')
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(opts.data) as Record<string, unknown>;
        } catch {
          output.fail('Invalid JSON for --data. Must be a valid JSON object.');
          process.exit(1);
        }

        const secret = await createSecret({
          name: opts.name,
          typeId: opts.typeId,
          description: opts.description,
          data,
        });
        const slim = { id: secret.id, name: secret.name, updatedAt: secret.updatedAt, values: secret.values ?? {} };

        output.result(
          slim,
          () => formatSecretDetail(secret),
          () => console.log(secret.id),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault secrets update <id-or-name>
  secrets
    .command('update <id-or-name>')
    .description('Update a secret\'s metadata and/or data (data change creates a new version)')
    .option('--name <name>', 'New name')
    .option('--description <text>', 'New description (use "" to clear)')
    .option('--data <json>', 'New data JSON (creates a new version)')
    .action(async (idOrName, opts, cmd) => {
      const output = getOutput(cmd);
      try {
        // Resolve name to ID first
        const existing = await resolveSecret(idOrName);

        const updateDto: { name?: string; description?: string; data?: Record<string, unknown> } = {};

        if (opts.name !== undefined) updateDto.name = opts.name;
        if (opts.description !== undefined) updateDto.description = opts.description;

        if (opts.data !== undefined) {
          try {
            updateDto.data = JSON.parse(opts.data) as Record<string, unknown>;
          } catch {
            output.fail('Invalid JSON for --data. Must be a valid JSON object.');
            process.exit(1);
          }
        }

        if (Object.keys(updateDto).length === 0) {
          output.fail('No changes specified. Use --name, --description, or --data.');
          process.exit(1);
        }

        const secret = await updateSecret(existing.id, updateDto);
        const slim = { id: secret.id, name: secret.name, updatedAt: secret.updatedAt, values: secret.values ?? {} };

        output.result(
          slim,
          () => formatSecretDetail(secret),
          () => console.log(secret.id),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault secrets reveal-access <id-or-name> <on|off>
  secrets
    .command('reveal-access <id-or-name> <state>')
    .description('Allow (on) or stop (off) revealing a secret value to assistants (owner only)')
    .action(async (idOrName, state, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const enabled = parseOnOff(String(state));
        if (enabled === undefined) {
          output.fail('Invalid state. Use "on" or "off".');
          process.exit(1);
        }
        const existing = await resolveSecret(idOrName);
        const secret = await setAssistantReveal(existing.id, enabled);
        const result = {
          id: secret.id,
          name: secret.name,
          assistantReveal: secret.assistantReveal ?? enabled,
          assistantRevealChangedAt: secret.assistantRevealChangedAt ?? null,
        };

        output.result(
          result,
          (r) => {
            console.log(`Reveal to assistants: ${r.assistantReveal ? 'on' : 'off'} for "${r.name}"`);
            if (r.assistantReveal) console.log(REVEAL_WARNING);
          },
          (r) => console.log(r.id),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault secrets broker <id-or-name> <on|off>
  secrets
    .command('broker <id-or-name> <state>')
    .description('Let agents use this secret through the credential broker (on) or stop it (off); owner only')
    .option('--origin <origin>', 'Allowed upstream HTTPS origin (repeatable; replaces the stored list)', collectOption)
    .option('--header <name>', 'Inject the key in this header (default Authorization)')
    .option('--prefix <word>', 'Header prefix: Bearer (default), Token, Basic, Bot, ApiKey or none')
    .option('--query <name>', 'Inject the key as this query parameter instead of a header')
    .option('--field <name>', 'The sensitive field to inject (default: the type\'s primary secret field)')
    .action(async (idOrName, state, opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const enabled = parseOnOff(String(state));
        if (enabled === undefined) {
          output.fail('Invalid state. Use "on" or "off".');
          process.exit(1);
        }
        const origins: string[] | undefined = opts.origin;
        const body: BrokerAccessBody = { enabled };
        if (enabled) {
          const injection = buildInjection(opts);
          if (origins) body.origins = origins;
          if (injection) body.injection = injection;
          if (opts.field !== undefined) body.field = String(opts.field);
        }
        const existing = await resolveSecret(idOrName);
        if (enabled && !body.origins && !(existing.brokerOrigins && existing.brokerOrigins.length > 0)) {
          throw new Error('Turning the broker on needs at least one origin. Pass --origin https://host.');
        }
        const secret = await setBrokerAccess(existing.id, body);
        const on = secret.brokerAccess ?? enabled;
        const allowed = secret.brokerOrigins ?? [];
        const result = {
          id: secret.id,
          name: secret.name,
          brokerAccess: on,
          brokerOrigins: allowed,
          brokerInjection: secret.brokerInjection ?? null,
          brokerField: secret.brokerField ?? null,
          brokerAccessChangedAt: secret.brokerAccessChangedAt ?? null,
          baseUrls: on ? allowed.map((o) => brokerBaseUrl(secret.id, o)) : [],
        };

        output.result(
          result,
          (r) => {
            console.log(`Broker: ${r.brokerAccess ? 'on' : 'off'} for "${r.name}"`);
            if (r.brokerAccess) {
              console.log(`Injection: ${describeInjection(r.brokerInjection)}`);
              console.log(BROKER_NOTE);
              console.log('Base URL(s):');
              for (const u of r.baseUrls) console.log(`  ${u}`);
            }
          },
          (r) => r.baseUrls.forEach((u) => console.log(u)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vault secrets delete <id-or-name>
  secrets
    .command('delete <id-or-name>')
    .description('Delete a secret and all its versions')
    .action(async (idOrName, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const existing = await resolveSecret(idOrName);
        await deleteSecret(existing.id);

        output.result(
          { id: existing.id, name: existing.name, deleted: true },
          (d) => console.log(`Deleted secret "${d.name}" (${d.id})`),
          (d) => console.log(d.id),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
