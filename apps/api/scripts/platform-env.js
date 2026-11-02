#!/usr/bin/env node
/**
 * Platform Environment Helper
 *
 * Runs the `platform` command of @marinoscar/platform-db (compose, sync,
 * check, drift, baseline, policies) with DATABASE_URL set, built from the
 * individual POSTGRES_* variables exactly the way scripts/prisma-env.js does
 * it. The commands that touch a database (`db drift`, `db check --database`,
 * `db baseline`) read DATABASE_URL from the environment; the offline ones
 * (`db compose`, `db sync`, `db check`) do not need it and are wired straight
 * to `platform` in package.json.
 *
 * Usage:
 *   node scripts/platform-env.js db <subcommand> [args]
 *
 * `db baseline` shells out to scripts/prisma-env.js (its --prisma-script
 * default) for `prisma migrate resolve`, so the two helpers must stay in
 * the same directory.
 */

const { spawn } = require('child_process');
const path = require('path');

// Requiring prisma-env.js is side-effect free apart from its dotenv load (it
// only runs main() when invoked directly) and gives us the one URL formula.
const { constructDatabaseUrl } = require('./prisma-env.js');

/** Resolves the `platform` bin of the installed @marinoscar/platform-db. */
function resolvePlatformBin() {
  const pkgJson = require.resolve('@marinoscar/platform-db/package.json');
  return path.join(path.dirname(pkgJson), 'bin', 'platform.js');
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Error: No platform command specified');
    console.error('Usage: node scripts/platform-env.js db <subcommand> [args]');
    process.exit(1);
  }

  const env = {
    ...process.env,
    DATABASE_URL: constructDatabaseUrl(),
  };

  const child = spawn(process.execPath, [resolvePlatformBin(), ...args], {
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    process.exit(code === null ? (signal ? 1 : 0) : code);
  });

  child.on('error', (err) => {
    console.error('Failed to execute platform command:', err);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}

module.exports = { resolvePlatformBin };
