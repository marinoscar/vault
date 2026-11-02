import { createCli, EXIT, exitCodeFor, formatError } from '@marinoscar/platform-cli';
import { CLI_NAME } from '@app/shared';

import { APP_CLI_OPTIONS } from './app.js';

/** `formatError`, with a fallback for a build that failed before the CLI identity was set. */
export function describeError(error: unknown): string {
  try {
    return formatError(error);
  } catch {
    return error instanceof Error ? `${CLI_NAME}: ${error.message}` : `${CLI_NAME}: ${String(error)}`;
  }
}

/**
 * Runs the CLI once and returns the exit code (never `process.exit()` here: that
 * would end the process before a pipe's pending writes drain).
 */
export async function runApp(argv: string[], create: typeof createCli = createCli): Promise<number> {
  let cli: ReturnType<typeof createCli>;
  try {
    cli = create(APP_CLI_OPTIONS);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return exitCodeFor(error);
  }
  return cli.run(argv);
}

export { EXIT };
