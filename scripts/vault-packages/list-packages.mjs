// =============================================================================
// The @marinoscar/vault-* packages that exist in this checkout
// =============================================================================
//
// Shared by the pack and docs checks and by the release workflows. A package
// that is planned but not built yet (vault-api, vault-web) has no folder and is
// simply absent from the list, so every check passes on whatever is present.
//
// CLI: `node scripts/vault-packages/list-packages.mjs` prints the short names
// (`contract db`), publish order first, space separated; `--names` prints the
// full package names. Node built-ins only.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Every package Vault will have, in publish order (the contract first: the others peer on it). */
export const PUBLISH_ORDER = Object.freeze(['contract', 'db', 'api', 'web']);

/** The repository root: this script lives in `<root>/scripts/vault-packages/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The packages present under `<root>/packages`, in publish order.
 *
 * @returns {{ short: string, dir: string, name: string, manifest: object }[]}
 */
export function listPackages(root = REPO_ROOT) {
  const out = [];
  for (const short of PUBLISH_ORDER) {
    const dir = `vault-${short}`;
    const manifestPath = join(root, 'packages', dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    out.push({ short, dir, name: manifest.name ?? `@marinoscar/${dir}`, manifest });
  }
  return out;
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  const packages = listPackages();
  const missing = PUBLISH_ORDER.filter((s) => !packages.some((p) => p.short === s));
  for (const short of missing) console.error(`notice: packages/vault-${short} does not exist yet; skipped`);
  console.log(packages.map((p) => (process.argv.includes('--names') ? p.name : p.short)).join(' '));
}
