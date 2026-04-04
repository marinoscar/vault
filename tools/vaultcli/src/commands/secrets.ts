import { Command } from 'commander';
import { OutputManager } from '../utils/output.js';
import {
  listSecrets,
  resolveSecret,
  createSecret,
  updateSecret,
  deleteSecret,
} from '../lib/api-client.js';
import { formatSecretTable, formatSecretDetail } from '../lib/formatters.js';
import type { OutputMode, Secret, SecretListItem, PaginatedResponse } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function registerSecretCommands(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Manage secrets — create, list, get, update, and delete encrypted secrets');

  // vaultcli secrets list
  secrets
    .command('list')
    .description('List secrets (metadata only, no decryption)')
    .option('--type-id <uuid>', 'Filter by secret type ID')
    .option('--search <term>', 'Search secret names')
    .option('--page <n>', 'Page number', '1')
    .option('--page-size <n>', 'Items per page', '20')
    .option('--sort <field>', 'Sort by: createdAt, name, updatedAt', 'updatedAt')
    .option('--order <dir>', 'Sort order: asc, desc', 'desc')
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const result = await listSecrets({
          page: parseInt(opts.page, 10),
          pageSize: parseInt(opts.pageSize, 10),
          typeId: opts.typeId,
          search: opts.search,
          sortBy: opts.sort,
          sortOrder: opts.order,
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

  // vaultcli secrets get <id-or-name>
  secrets
    .command('get <id-or-name>')
    .description('Get a secret by ID or name, with decrypted data')
    .action(async (idOrName, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const secret = await resolveSecret(idOrName);
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

  // vaultcli secrets create
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

  // vaultcli secrets update <id-or-name>
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

  // vaultcli secrets delete <id-or-name>
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
