import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// =============================================================================
// The packages read no environment variable (issue #194, epic #191)
// =============================================================================
//
// A host configures the packages through ports and bindings (`VAULT_HOST`, `VAULT_MCP_OPTIONS`,
// `configureVaultWeb`), never through the process environment: an embedded package that reads
// `APP_URL` or `DATABASE_URL` behind the host's back is configuration the host cannot see. This
// greps the BUILT output of the four packages, which is what a host installs, so `npm run
// build:packages` must run first (CI does).
//
// The command-line entry of vault-db (`bin/vault-db.js`) is the one process boundary: it hands its
// own `process.env` to `runVaultDb` as an argument. It is outside `dist/` and so outside this scan.
// =============================================================================

const PACKAGES = join(__dirname, '..', '..');
const DISTS = ['vault-api', 'vault-contract', 'vault-db', 'vault-web'].map((name) => join(PACKAGES, name, 'dist'));

/**
 * Justified exceptions, as `<package>/dist/<path>`: each names why it is still here.
 *
 * - agent-notifier: the agent notification links still read `APP_URL`; it moves to `VAULT_HOST`
 *   when the agent slice's in-process release port (#195) lands, which rewrites that file.
 * - agent-testing/guard (#196): the conformance kit's production guard reads `NODE_ENV` only to
 *   REFUSE to run (the fake Vault and the runner are test tools); it configures nothing. A host
 *   never loads `./agent-testing` outside its tests.
 */
const ALLOWED = new Set<string>([
  'vault-api/dist/agent/agent-notifier.service.js',
  'vault-contract/dist/cjs/agent-testing/guard.js',
  'vault-contract/dist/esm/agent-testing/guard.js',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(c|m)?js$/.test(name) ? [path] : [];
  });
}

describe('the built packages read no environment variable', () => {
  it.each(DISTS)('%s', (dist) => {
    expect({ dist, built: existsSync(dist) }).toEqual({ dist, built: true });
    const offenders = files(dist)
      .filter((path) => /process\.env|import\.meta\.env/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(PACKAGES, path).split('\\').join('/'))
      .filter((path) => !ALLOWED.has(path));
    expect(offenders).toEqual([]);
  });

  it('keeps every allowance justified: an allowed file that no longer reads the environment is removed from the list', () => {
    for (const path of ALLOWED) {
      const full = join(PACKAGES, path);
      expect({ path, stillReads: existsSync(full) && /process\.env/.test(readFileSync(full, 'utf8')) }).toEqual({ path, stillReads: true });
    }
  });
});
