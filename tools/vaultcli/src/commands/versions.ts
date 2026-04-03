import { Command } from 'commander';
import { OutputManager } from '../utils/output.js';
import {
  resolveSecret,
  listVersions,
  getVersion,
  rollbackVersion,
} from '../lib/api-client.js';
import { formatVersionTable, formatVersionDetail, formatSecretDetail } from '../lib/formatters.js';
import type { OutputMode, Secret, SecretVersion } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function registerVersionCommands(program: Command): void {
  const versions = program
    .command('versions')
    .description('Manage secret version history — list, inspect, and rollback');

  // vaultcli versions list <secret-id-or-name>
  versions
    .command('list <secret-id-or-name>')
    .description('List all versions of a secret')
    .action(async (idOrName, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const secret = await resolveSecret(idOrName);
        const result = await listVersions(secret.id);

        output.result<SecretVersion[]>(
          result,
          (r) => formatVersionTable(r),
          (r) => r.forEach((v) => console.log(v.id)),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vaultcli versions get <secret-id-or-name> <version-id>
  versions
    .command('get <secret-id-or-name> <version-id>')
    .description('Get a specific version with decrypted data')
    .action(async (idOrName, versionId, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const secret = await resolveSecret(idOrName);
        const version = await getVersion(secret.id, versionId);

        output.result<SecretVersion>(
          version,
          (v) => formatVersionDetail(v),
          (v) => console.log(`v${v.version}`),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vaultcli versions rollback <secret-id-or-name> <version-id>
  versions
    .command('rollback <secret-id-or-name> <version-id>')
    .description('Rollback to a previous version (creates a new version with the old data)')
    .action(async (idOrName, versionId, _opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const secret = await resolveSecret(idOrName);
        const result = await rollbackVersion(secret.id, versionId);

        output.result<Secret>(
          result,
          (s) => {
            console.log(`Rolled back to version. New version: v${s.currentVersion}`);
            formatSecretDetail(s);
          },
          (s) => console.log(s.id),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
