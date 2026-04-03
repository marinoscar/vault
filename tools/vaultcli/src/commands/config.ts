import { Command } from 'commander';
import { OutputManager, success, blank, keyValue, header } from '../utils/output.js';
import {
  config,
  getServerUrlSource,
  setServerUrl,
  clearConfig,
} from '../utils/config.js';
import type { OutputMode } from '../utils/types.js';

function getOutput(cmd: Command): OutputManager {
  const root = cmd.optsWithGlobals();
  const mode: OutputMode = root.json ? 'json' : root.quiet ? 'quiet' : 'human';
  return new OutputManager(mode);
}

export function registerConfigCommands(program: Command): void {
  const cfg = program
    .command('config')
    .description('View and manage CLI configuration');

  cfg
    .command('show')
    .description('Show current configuration')
    .action((_opts, cmd) => {
      const output = getOutput(cmd);
      const data = {
        serverUrl: config.serverUrl,
        serverUrlSource: getServerUrlSource(),
        configDir: config.configDir,
        configFile: config.configFile,
        authFile: config.authFile,
      };

      output.result(
        data,
        (d) => {
          header('Configuration');
          keyValue('Server URL', `${d.serverUrl} (${d.serverUrlSource})`);
          keyValue('Config Dir', d.configDir);
          keyValue('Config File', d.configFile);
          keyValue('Auth File', d.authFile);
          blank();
        },
        (d) => console.log(d.serverUrl),
      );
    });

  cfg
    .command('set-url <url>')
    .description('Set the Vault server URL')
    .action((url, _opts, cmd) => {
      const output = getOutput(cmd);
      setServerUrl(url);

      output.result(
        { serverUrl: url },
        () => success(`Server URL set to: ${url}`),
        () => console.log(url),
      );
    });

  cfg
    .command('reset')
    .description('Reset configuration to defaults')
    .action((_opts, cmd) => {
      const output = getOutput(cmd);
      clearConfig();

      output.result(
        { reset: true },
        () => success('Configuration reset to defaults'),
        () => console.log('ok'),
      );
    });
}
