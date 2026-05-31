import { existsSync } from 'fs';
import { isAbsolute } from 'path';
import { Command } from 'commander';
import { OutputManager, success, warn, dim } from '../utils/output.js';
import {
  loadRegistry,
  addFileEntry,
  addDirEntry,
  removeEntry,
  getSyncFilePath,
} from '../lib/sync-store.js';
import { runSync, summarize } from '../lib/sync-engine.js';
import { formatSyncList, formatSyncRun } from '../lib/formatters.js';
import type {
  OutputMode,
  SyncFileEntry,
  SyncDirEntry,
  SyncResult,
} from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

/**
 * Run/status share the same engine call and output shape. Emits a JSON
 * envelope whose success flag reflects whether any entry errored, then
 * exits non-zero on error so cron/monitoring can alert.
 */
async function executeSync(
  output: OutputManager,
  opts: { name?: string; dryRun: boolean },
): Promise<void> {
  const registry = loadRegistry();
  const results: SyncResult[] = await runSync(
    registry,
    {
      dryRun: opts.dryRun,
      warn: (m) => output.humanOnly(() => warn(m)),
    },
    opts.name,
  );
  const summary = summarize(results);

  if (output.mode === 'json') {
    const envelope = {
      success: summary.errors === 0,
      data: { dryRun: opts.dryRun, summary, results },
    };
    process.stdout.write(JSON.stringify(envelope) + '\n');
  } else if (output.mode === 'quiet') {
    for (const r of results) {
      if (r.action !== 'unchanged') console.log(`${r.action} ${r.name}`);
    }
  } else {
    formatSyncRun(results, summary, opts.dryRun);
  }

  if (summary.errors > 0) process.exit(1);
}

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command('sync')
    .description('Sync local .env files into Vault as versioned Document secrets');

  // vaultcli sync add
  sync
    .command('add')
    .description('Register a single file to keep in sync (created on first run)')
    .requiredOption('--name <name>', 'Secret name to store the file under')
    .requiredOption('--path <path>', 'Absolute path to the file')
    .option('--description <text>', 'Optional description')
    .action((opts, cmd) => {
      const output = getOutput(cmd);
      try {
        if (!isAbsolute(opts.path)) {
          output.fail('--path must be an absolute path', 'invalid_path');
          process.exit(1);
        }
        const entry: SyncFileEntry = {
          kind: 'file',
          name: opts.name,
          path: opts.path,
          ...(opts.description ? { description: opts.description } : {}),
        };
        addFileEntry(entry);

        output.result(
          entry,
          (e) => {
            success(`Registered "${e.name}" → ${e.path}`);
            if (!existsSync(e.path)) {
              warn(`Note: file does not exist yet at ${e.path}`);
            }
            dim('It will be created in Vault on the next: vaultcli sync run');
          },
          (e) => console.log(e.name),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'duplicate');
        process.exit(1);
      }
    });

  // vaultcli sync add-dir
  sync
    .command('add-dir')
    .description('Register a directory; .env files inside it are auto-discovered on run')
    .requiredOption('--path <dir>', 'Absolute path to the directory')
    .option('--pattern <glob>', 'Filename glob to match', '.env*')
    .option('--recursive', 'Recurse into subdirectories', false)
    .option('--name-prefix <prefix>', 'Prefix for derived secret names (defaults to dir name)')
    .option('--description <text>', 'Optional description applied to discovered files')
    .action((opts, cmd) => {
      const output = getOutput(cmd);
      try {
        if (!isAbsolute(opts.path)) {
          output.fail('--path must be an absolute path', 'invalid_path');
          process.exit(1);
        }
        const entry: SyncDirEntry = {
          kind: 'dir',
          path: opts.path,
          pattern: opts.pattern,
          recursive: Boolean(opts.recursive),
          ...(opts.namePrefix ? { namePrefix: opts.namePrefix } : {}),
          ...(opts.description ? { description: opts.description } : {}),
        };
        addDirEntry(entry);

        output.result(
          entry,
          (e) => {
            success(`Watching directory ${e.path} (pattern: ${e.pattern}${e.recursive ? ', recursive' : ''})`);
            if (!existsSync(e.path)) {
              warn(`Note: directory does not exist yet at ${e.path}`);
            }
            dim('Matching files will be created in Vault on the next: vaultcli sync run');
          },
          (e) => console.log(e.path),
        );
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err), 'duplicate');
        process.exit(1);
      }
    });

  // vaultcli sync remove
  sync
    .command('remove <name-or-path>')
    .description('Unregister a synced file (by name or path) or directory (by path)')
    .action((key, _opts, cmd) => {
      const output = getOutput(cmd);
      const removed = removeEntry(key);
      if (!removed) {
        output.fail(`No registered entry matched "${key}"`, 'not_found');
        process.exit(1);
      }
      output.result(
        removed,
        () => success(`Removed "${key}" from sync registry (Vault secret left intact)`),
        () => console.log(key),
      );
    });

  // vaultcli sync list
  sync
    .command('list')
    .description('List registered files and directories (offline; shows cached status)')
    .action((_opts, cmd) => {
      const output = getOutput(cmd);
      const registry = loadRegistry();
      output.result(
        registry,
        (r) => formatSyncList(r),
        (r) =>
          r.entries.forEach((e) =>
            console.log(e.kind === 'file' ? e.name : e.path),
          ),
      );
    });

  // vaultcli sync status
  sync
    .command('status')
    .description('Dry run — show what would change without writing to Vault')
    .option('--name <name>', 'Limit to a single entry by name')
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        await executeSync(output, { name: opts.name, dryRun: true });
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vaultcli sync run
  sync
    .command('run')
    .description('Sync changed files into Vault (cron entry point)')
    .option('--name <name>', 'Limit to a single entry by name')
    .option('--dry-run', 'Preview changes without writing', false)
    .action(async (opts, cmd) => {
      const output = getOutput(cmd);
      try {
        await executeSync(output, { name: opts.name, dryRun: Boolean(opts.dryRun) });
      } catch (err) {
        output.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // vaultcli sync where  (handy: print registry file path)
  sync
    .command('where')
    .description('Print the path to the local sync registry file')
    .action((_opts, cmd) => {
      const output = getOutput(cmd);
      const path = getSyncFilePath();
      output.result(
        { path },
        (d) => console.log(d.path),
        (d) => console.log(d.path),
      );
    });
}
