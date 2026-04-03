import { Command } from 'commander';
import { OutputManager } from '../utils/output.js';
import { healthLive, healthReady } from '../lib/api-client.js';
import { formatHealthDetail } from '../lib/formatters.js';
import type { OutputMode, HealthResponse } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function registerHealthCommands(program: Command): void {
  const health = program
    .command('health')
    .description('Check Vault server health status (no authentication required)');

  // vaultcli health live
  health
    .command('live')
    .description('Liveness probe — is the application process running?')
    .action(async (_opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const result = await healthLive();

        output.result<HealthResponse>(
          result,
          (r) => formatHealthDetail(r, 'Liveness'),
          (r) => console.log(r.status),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vaultcli health ready
  health
    .command('ready')
    .description('Readiness probe — is the application ready to handle traffic?')
    .action(async (_opts, cmd) => {
      const output = getOutput(cmd);
      try {
        const result = await healthReady();

        output.result<HealthResponse>(
          result,
          (r) => formatHealthDetail(r, 'Readiness'),
          (r) => console.log(r.status),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
