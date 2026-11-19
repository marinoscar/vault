#!/usr/bin/env node
// =============================================================================
// Platform compatibility of the @marinoscar/vault-* packages
// =============================================================================
//
// docs/PACKAGES.md, "Platform compatibility": each Vault package release names
// the @marinoscar/platform-* pre-releases it was tested with, a lowest and a
// highest, as the explicit range `>=<lowest> <=<highest>`. That range is held
// in five places, and this script fails when they disagree:
//
//   peers       every @marinoscar/platform-* peerDependency of the four package
//               manifests (vault-contract and vault-db declare none today; one
//               they add must carry the same range);
//   constant    SUPPORTED_PLATFORM_RANGE in packages/vault-api/src/core/
//               platform-compat.ts (the range VaultApiModule.forRoot checks);
//   table       the compatibility table in docs/PACKAGES.md: its first row,
//               `Unreleased` (the range changed since the last release) or the
//               current Vault packages version, carries the range;
//   pins        every @marinoscar/platform-* dependency or devDependency of the
//               workspace (root, apps/*, packages/*) pins the highest version:
//               Vault itself runs on the top of its range;
//   form        the range is exactly `>=A <=B` with A <= B (no caret: a caret on
//               a pre-release does not mean what people expect).
//
// Usage:
//   node scripts/vault-packages/platform-compat.mjs            check (exit 1 on a mismatch)
//   node scripts/vault-packages/platform-compat.mjs --matrix   print ["<lowest>","<highest>"] (CI matrix)
//   node scripts/vault-packages/platform-compat.mjs --write    set the `Unreleased` row to the peer
//                                                              range and today's date (after a
//                                                              range change)
//   node scripts/vault-packages/platform-compat.mjs --release  turn the `Unreleased` row into the
//                                                              current version's row (run by
//                                                              `npm run version-packages`)
//   node scripts/vault-packages/platform-compat.mjs --use <version>
//                                                              rewrite every workspace platform pin
//                                                              to <version> (CI matrix cell; run
//                                                              `npm install` after it)
//   --root <dir> runs against another checkout (tests).
// Exit: 0 clean, 1 violations, 2 usage error. Node built-ins only.
// =============================================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, listPackages } from './list-packages.mjs';

export const PLATFORM_PREFIX = '@marinoscar/platform-';
export const TABLE_START = '<!-- platform-compat:start -->';
export const TABLE_END = '<!-- platform-compat:end -->';
export const CONSTANT_FILE = 'packages/vault-api/src/core/platform-compat.ts';
/** The first row's version cell while the range differs from the last release's. */
export const UNRELEASED = 'Unreleased';
const RANGE_RE = /^>=(\S+) <=(\S+)$/;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Semver precedence of two versions (-1, 0, 1); the same rule as vault-api's platform-compat.ts. */
export function compareVersions(a, b) {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) throw new Error(`not a semantic version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) if (+pa[i] !== +pb[i]) return Math.sign(+pa[i] - +pb[i]);
  if (!pa[4] || !pb[4]) return pa[4] === pb[4] ? 0 : pa[4] ? -1 : 1;
  const xa = pa[4].split('.');
  const xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb && +xa[i] !== +xb[i]) return Math.sign(+xa[i] - +xb[i]);
    if (na !== nb) return na ? -1 : 1;
    if (!na && xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/** `{ lowest, highest }` of an explicit range, or null when it is not `>=A <=B`. */
export function parseRange(range) {
  const m = RANGE_RE.exec(range ?? '');
  if (!m || !VERSION_RE.test(m[1]) || !VERSION_RE.test(m[2])) return null;
  return { lowest: m[1], highest: m[2] };
}

/** The rows of the table between the markers: `{ version, range, date }[]`, newest first. */
export function parseTable(markdown) {
  const start = markdown.indexOf(TABLE_START);
  const end = markdown.indexOf(TABLE_END);
  if (start < 0 || end < start) return null;
  const rows = [];
  for (const line of markdown.slice(start + TABLE_START.length, end).split('\n')) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0]) || cells[0] === 'Vault packages') continue;
    rows.push({ version: cells[0].replace(/`/g, ''), range: cells[1].replace(/`/g, ''), date: cells[2] });
  }
  return rows;
}

function renderTable(rows) {
  return [
    '| Vault packages | Platform range (`@marinoscar/platform-*`) | Date |',
    '|---|---|---|',
    ...rows.map((r) => `| \`${r.version}\` | \`${r.range}\` | ${r.date} |`),
  ].join('\n');
}

/** The workspace manifests: root, apps/*, packages/* (`{ file, manifest }[]`). */
function workspaceManifests(root) {
  const out = [{ file: 'package.json', manifest: readJson(join(root, 'package.json')) }];
  for (const dir of ['apps', 'packages']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir)).sort()) {
      const file = join(dir, name, 'package.json');
      if (existsSync(join(root, file))) out.push({ file, manifest: readJson(join(root, file)) });
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function platformEntries(deps) {
  return Object.entries(deps ?? {}).filter(([name]) => name.startsWith(PLATFORM_PREFIX));
}

/**
 * Every disagreement between the peers, the constant, the table and the pins.
 *
 * @returns {{ range: string|null, version: string|null, problems: string[] }}
 */
export function checkPlatformCompat(root = REPO_ROOT) {
  const problems = [];
  const packages = listPackages(root);
  const versions = [...new Set(packages.map((p) => p.manifest.version))];
  if (versions.length !== 1) problems.push(`the vault packages are versioned together, found ${versions.join(', ')}`);
  const version = versions[0] ?? null;

  const peerRanges = new Map();
  for (const p of packages) {
    for (const [name, range] of platformEntries(p.manifest.peerDependencies)) {
      peerRanges.set(`${p.dir} peerDependencies ${name}`, range);
    }
  }
  const distinct = [...new Set(peerRanges.values())];
  if (!distinct.length) problems.push('no @marinoscar/platform-* peerDependency in any vault package');
  if (distinct.length > 1) {
    problems.push(
      `the platform peer ranges disagree: ${[...peerRanges].map(([k, v]) => `${k} = "${v}"`).join('; ')}`,
    );
  }
  const range = distinct.length === 1 ? distinct[0] : null;
  const parsed = range ? parseRange(range) : null;
  if (range && !parsed) problems.push(`the platform peer range "${range}" is not the explicit form ">=<lowest> <=<highest>"`);
  if (parsed && compareVersions(parsed.lowest, parsed.highest) > 0) {
    problems.push(`the platform range "${range}" has its lowest above its highest`);
  }

  const constantPath = join(root, CONSTANT_FILE);
  if (existsSync(constantPath)) {
    const m = /export const SUPPORTED_PLATFORM_RANGE = '([^']*)';/.exec(readFileSync(constantPath, 'utf8'));
    if (!m) problems.push(`${CONSTANT_FILE}: SUPPORTED_PLATFORM_RANGE not found`);
    else if (range && m[1] !== range) {
      problems.push(`${CONSTANT_FILE}: SUPPORTED_PLATFORM_RANGE is "${m[1]}", the peers say "${range}"`);
    }
  } else if (packages.some((p) => p.short === 'api')) {
    problems.push(`${CONSTANT_FILE} is missing`);
  }

  const docs = join(root, 'docs', 'PACKAGES.md');
  const rows = existsSync(docs) ? parseTable(readFileSync(docs, 'utf8')) : null;
  if (!rows) {
    problems.push(`docs/PACKAGES.md: no compatibility table between ${TABLE_START} and ${TABLE_END}`);
  } else {
    for (const r of rows) {
      if (!parseRange(r.range)) problems.push(`docs/PACKAGES.md: row ${r.version}: "${r.range}" is not ">=<lowest> <=<highest>"`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push(`docs/PACKAGES.md: row ${r.version}: date "${r.date}" is not YYYY-MM-DD`);
    }
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.version)) problems.push(`docs/PACKAGES.md: two rows for ${r.version}`);
      seen.add(r.version);
    }
    if (rows.slice(1).some((r) => r.version === UNRELEASED)) problems.push(`docs/PACKAGES.md: the ${UNRELEASED} row must be the first`);
    const top = rows[0];
    if (!top) {
      problems.push('docs/PACKAGES.md: the compatibility table has no row (run with --write)');
    } else if (top.version !== UNRELEASED && top.version !== version) {
      problems.push(
        `docs/PACKAGES.md: the first row is ${top.version}; it must be ${UNRELEASED} or the current version ${version} (run with --write)`,
      );
    } else if (range && top.range !== range) {
      problems.push(`docs/PACKAGES.md: row ${top.version} says "${top.range}", the peerDependencies say "${range}" (run with --write)`);
    }
  }

  if (parsed) {
    for (const { file, manifest } of workspaceManifests(root)) {
      for (const field of ['dependencies', 'devDependencies']) {
        for (const [name, pin] of platformEntries(manifest[field])) {
          if (pin !== parsed.highest) {
            problems.push(`${file} ${field} ${name} is "${pin}"; Vault itself runs on the highest of the range, ${parsed.highest}`);
          }
        }
      }
    }
  }
  return { range, version, problems };
}

/**
 * Updates the table's first row. `mode` `unreleased` (`--write`): the `Unreleased` row carries
 * the peer range, unless the current version's row already does. `mode` `release`
 * (`--release`, after `changeset version`): the `Unreleased` row becomes the current version's
 * row, or that row is added with the peer range.
 */
export function writeTable(root = REPO_ROOT, mode = 'unreleased', date = new Date().toISOString().slice(0, 10)) {
  const { range, version } = checkPlatformCompat(root);
  if (!range || !version || !parseRange(range)) throw new Error('fix the peer ranges first (run the check)');
  const docs = join(root, 'docs', 'PACKAGES.md');
  const markdown = readFileSync(docs, 'utf8');
  const rows = parseTable(markdown);
  if (!rows) throw new Error(`docs/PACKAGES.md: no ${TABLE_START} ... ${TABLE_END} block`);
  const history = rows.filter((r) => r.version !== UNRELEASED);
  let next;
  if (mode === 'release') {
    next = [{ version, range, date }, ...history.filter((r) => r.version !== version)];
  } else if (history[0]?.version === version && history[0].range === range) {
    next = history;
  } else {
    next = [{ version: UNRELEASED, range, date }, ...history];
  }
  const start = markdown.indexOf(TABLE_START) + TABLE_START.length;
  const end = markdown.indexOf(TABLE_END);
  writeFileSync(docs, `${markdown.slice(0, start)}\n${renderTable(next)}\n${markdown.slice(end)}`);
}

/** Rewrites every workspace platform dependency and devDependency pin to `version`. */
export function usePlatformVersion(root, version) {
  if (!VERSION_RE.test(version)) throw new Error(`not a version: ${version}`);
  const changed = [];
  for (const { file, manifest } of workspaceManifests(root)) {
    let touched = false;
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name] of platformEntries(manifest[field])) {
        manifest[field][name] = version;
        touched = true;
      }
    }
    if (touched) {
      writeFileSync(join(root, file), `${JSON.stringify(manifest, null, 2)}\n`);
      changed.push(file);
    }
  }
  return changed;
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf('--root');
  const root = rootAt >= 0 ? args[rootAt + 1] : REPO_ROOT;
  if (rootAt >= 0 && !root) {
    console.error('usage: platform-compat.mjs [--matrix | --write | --release | --use <version>] [--root <dir>]');
    process.exit(2);
  }
  if (args.includes('--use')) {
    const version = args[args.indexOf('--use') + 1];
    if (!version) {
      console.error('usage: platform-compat.mjs --use <version>');
      process.exit(2);
    }
    for (const f of usePlatformVersion(root, version)) console.log(`pinned @marinoscar/platform-* ${version} in ${f}`);
    process.exit(0);
  }
  if (args.includes('--write') || args.includes('--release')) {
    writeTable(root, args.includes('--release') ? 'release' : 'unreleased');
    console.log('docs/PACKAGES.md: compatibility table updated');
  }
  const { range, version, problems } = checkPlatformCompat(root);
  if (args.includes('--matrix')) {
    const parsed = problems.length ? null : parseRange(range);
    if (!parsed) {
      for (const p of problems) console.error(`platform-compat: ${p}`);
      process.exit(1);
    }
    console.log(JSON.stringify([parsed.lowest, parsed.highest]));
    process.exit(0);
  }
  if (problems.length) {
    for (const p of problems) console.error(`platform-compat: ${p}`);
    console.error(`platform-compat: ${problems.length} problem(s); policy: docs/PACKAGES.md, "Platform compatibility"`);
    process.exit(1);
  }
  console.log(`platform-compat: ok (vault packages ${version}, @marinoscar/platform-* ${range})`);
}
