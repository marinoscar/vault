import { Command } from 'commander';
import { OutputManager } from '../utils/output.js';
import { listSecretTypes, getSecretType } from '../lib/api-client.js';
import { formatSecretTypeTable, formatSecretTypeDetail } from '../lib/formatters.js';
import type { OutputMode, SecretType, PaginatedResponse } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function registerTypeCommands(program: Command): void {
  const types = program
    .command('types')
    .description('Browse available secret types and their field definitions');

  // vaultcli types list
  types
    .command('list')
    .description('List available secret types')
    .option('--search <term>', 'Filter by name')
    .option('--page <n>', 'Page number', '1')
    .option('--page-size <n>', 'Items per page', '50')
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const result = await listSecretTypes({
          search: opts.search,
          page: parseInt(opts.page, 10),
          pageSize: parseInt(opts.pageSize, 10),
        });

        output.result<PaginatedResponse<SecretType>>(
          result,
          (r) => formatSecretTypeTable(r),
          (r) => r.items.forEach((t) => console.log(t.id)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vaultcli types get <id>
  types
    .command('get <id>')
    .description('Get a secret type with full field definitions')
    .action(async (id, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const type = await getSecretType(id);

        output.result<SecretType>(
          type,
          (t) => formatSecretTypeDetail(t),
          (t) => console.log(t.name),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
