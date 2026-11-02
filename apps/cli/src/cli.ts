#!/usr/bin/env node
import { EXIT } from '@marinoscar/platform-cli';

import { describeError, runApp } from './run.js';

// The executable entry point: the only module with side effects at import time.
// `process.exitCode` is set and main returns, never `process.exit()`, so piped
// output is flushed.
async function main(): Promise<void> {
  process.exitCode = await runApp(process.argv.slice(2));
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${describeError(reason)}\n`);
  process.exitCode = EXIT.FAILURE;
});

void main();
