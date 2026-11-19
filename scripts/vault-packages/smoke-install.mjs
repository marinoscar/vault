#!/usr/bin/env node
// =============================================================================
// Clean-install smoke test of the @marinoscar/vault-* packages (#192)
// =============================================================================
//
// Installs the packages the way another app would: in an empty folder OUTSIDE
// the workspace (`npm init -y`, then `npm install` of the packages and every
// peer they declare), so nothing resolves through the workspace symlinks. Then:
//
//   resolve   every `exports` subpath of every installed package resolves, for
//             the `import` condition and (when declared) the `require` one, to
//             a file that exists.
//   cjs/esm   `require('@marinoscar/vault-contract/agent')`, the ESM import of
//             `agentFillRequestSchema` and `AGENT_SCOPES`, and a require and an
//             import of every vault-contract subpath.
//   bin       `npx --no-install vault-db --help`.
//   types     a generated TypeScript file importing every published subpath of
//             every package (a namespace import plus an assertion that it has
//             at least one export) typechecks with moduleResolution `node16`
//             (an .mts and a .cts consumer) and `bundler`. vault-contract and
//             vault-db are also checked with skipLibCheck off, so their own
//             declarations are compiled. vault-api and vault-web type against
//             the host's generated Prisma client and the platform packages, so
//             their declarations are checked through the consumer's imports only.
//
// Modes (exactly one):
//   --pack              pack the packages of this checkout (`npm pack -w`; build
//                       them first: npm run build:packages) and install those.
//   --tarballs <dir>    install the marinoscar-vault-*.tgz files in <dir>.
//   --registry [--tag next]
//                       install from the public registry at the dist-tag. When a
//                       package or the tag does not exist there yet (the names
//                       are not bootstrapped), the run is SKIPPED: it prints a
//                       notice, writes `result=skipped` to $GITHUB_OUTPUT and
//                       exits 0. It never reports a pass it did not run.
//
// Other options: --work <dir> (default: a new folder under the OS temp dir),
// --keep (leave the folder for inspection).
//
// Exit: 0 passed or skipped, 1 a check failed, 2 usage error.
// Node built-ins and npm only.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, listPackages } from './list-packages.mjs';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** Tooling the consumer needs for the type check, beside the declared peers. */
export const TYPE_TOOLING = Object.freeze({
  typescript: '^5.9.3',
  '@types/node': '^24.0.0',
  '@types/react': '^19.2.0',
  '@types/react-dom': '^19.2.0',
});

// ---------------------------------------------------------------------------
// Pure helpers (tested in test/smoke-install.test.mjs)
// ---------------------------------------------------------------------------

/** Parses argv; throws on a usage error. */
export function parseArgs(argv) {
  const opts = { mode: null, tarballs: null, tag: 'next', work: null, keep: false };
  const setMode = (mode) => {
    if (opts.mode && opts.mode !== mode) throw new Error('choose one of --pack, --tarballs <dir>, --registry');
    opts.mode = mode;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return argv[i];
    };
    if (arg === '--pack') setMode('pack');
    else if (arg === '--registry') setMode('registry');
    else if (arg === '--tarballs') {
      setMode('tarballs');
      opts.tarballs = value();
    } else if (arg === '--tag') opts.tag = value();
    else if (arg === '--work') opts.work = value();
    else if (arg === '--keep') opts.keep = true;
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (!opts.mode) throw new Error('choose one of --pack, --tarballs <dir>, --registry');
  return opts;
}

/** The subpaths (`.`, `./agent`, ...) of an `exports` map, without `./package.json`. */
export function subpaths(manifest) {
  return Object.keys(manifest.exports ?? { '.': manifest.main ?? 'index.js' }).filter((k) => k !== './package.json');
}

/** `@scope/name` + `./sub` -> `@scope/name/sub`. */
export const specifier = (name, subpath) => (subpath === '.' ? name : `${name}/${subpath.slice(2)}`);

/** Whether a subpath points at JavaScript (not an asset such as the brand PNG). */
export function isCodeSubpath(manifest, subpath) {
  const value = manifest.exports?.[subpath];
  return typeof value !== 'string' || /\.[cm]?js$/.test(value);
}

/** Whether a subpath declares a `require` condition (or is a plain CommonJS target). */
export function hasRequireCondition(manifest, subpath) {
  const value = manifest.exports?.[subpath];
  if (typeof value === 'string') return manifest.type !== 'module';
  if (value && typeof value === 'object') {
    if ('require' in value) return true;
    if ('import' in value) return false;
    return manifest.type !== 'module';
  }
  return false;
}

/**
 * Merges the peers of the packages under test into one install list. Peers that
 * are themselves under test are dropped; two different ranges for one peer are
 * reported, never silently picked.
 */
export function collectPeers(manifests) {
  const ours = new Set(manifests.map((m) => m.name));
  const peers = new Map();
  const conflicts = [];
  for (const manifest of manifests) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (ours.has(peer)) continue;
      if (manifest.peerDependenciesMeta?.[peer]?.optional) continue;
      if (peers.has(peer) && peers.get(peer) !== range) conflicts.push(`${peer}: '${peers.get(peer)}' vs '${range}' (${manifest.name})`);
      else peers.set(peer, range);
    }
  }
  return { peers: Object.fromEntries([...peers].sort(([a], [b]) => a.localeCompare(b))), conflicts };
}

/**
 * The TypeScript source importing every code subpath of `manifests` (a
 * namespace import each, and a compile-time assertion it exports something).
 * `cjsOnly` keeps the subpaths with a require condition (for a .cts consumer).
 */
export function typeSmokeSource(manifests, { cjsOnly = false } = {}) {
  const lines = ['// Generated by scripts/vault-packages/smoke-install.mjs. Do not edit.'];
  const checks = [];
  let n = 0;
  for (const manifest of manifests) {
    for (const sub of subpaths(manifest)) {
      if (!isCodeSubpath(manifest, sub)) continue;
      if (cjsOnly && !hasRequireCondition(manifest, sub)) continue;
      const id = `m${n}`;
      n += 1;
      lines.push(`import * as ${id} from '${specifier(manifest.name, sub)}';`);
      checks.push(`export const ${id}HasExports: [keyof typeof ${id}] extends [never] ? 'no exports' : true = true;`);
    }
  }
  return { source: `${[...lines, '', ...checks].join('\n')}\n`, count: n };
}

/** Whether `child` is inside `parent`. */
export function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

function run(cmd, args, { cwd, capture = false, allowFail = false } = {}) {
  const shown = `${cmd} ${args.join(' ')}`;
  if (!capture) console.log(`\n$ ${shown}`);
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' },
  });
  if (result.status !== 0 && !allowFail) {
    const detail = capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    throw new Error(`'${shown}' exited ${result.status}${detail}`);
  }
  return result;
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function readManifestFromTarball(file) {
  const result = run('tar', ['-xzOf', file, 'package/package.json'], { capture: true });
  return JSON.parse(result.stdout);
}

/** Finds the marinoscar-vault-<short>-*.tgz of each present package in `dir`. */
function tarballsIn(dir, packages) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.tgz'));
  return packages.map(({ short, name }) => {
    const match = files.filter((f) => f.startsWith(`marinoscar-vault-${short}-`));
    if (match.length !== 1) throw new Error(`expected one tarball of ${name} in ${dir}, found ${match.length}`);
    return resolve(dir, match[0]);
  });
}

/** Asks the registry for each package at `tag`; returns `{ manifests }` or `{ missing }`. */
function registryManifests(packages, tag) {
  const manifests = [];
  const missing = [];
  for (const { name } of packages) {
    const result = run(NPM, ['view', `${name}@${tag}`, '--json'], { capture: true, allowFail: true });
    const text = (result.stdout ?? '').trim();
    if (result.status !== 0 || text === '') {
      if (!/E404/.test(`${result.stdout}${result.stderr}`)) {
        throw new Error(`npm view ${name}@${tag} failed (a registry error, not a missing package):\n${result.stderr}`);
      }
      missing.push(`${name}@${tag}`);
      continue;
    }
    const parsed = JSON.parse(text);
    manifests.push(Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed);
  }
  return registryVerdict(packages.length, manifests, missing);
}

/**
 * All packages missing at the tag: skip (not published yet). Some missing: a
 * half-finished release, which fails. None missing: test them.
 */
export function registryVerdict(total, manifests, missing) {
  if (missing.length === total) return { missing };
  if (missing.length > 0) {
    throw new Error(`only ${total - missing.length} of ${total} packages are on npm at the tag; missing: ${missing.join(', ')} (a release stopped half way; see the runbook)`);
  }
  return { manifests };
}

function resolveChecks(work, manifests) {
  const plan = manifests.flatMap((m) =>
    subpaths(m).map((sub) => ({ spec: specifier(m.name, sub), viaRequire: hasRequireCondition(m, sub) })),
  );
  // ESM, so import.meta.resolve applies the `import` condition; createRequire applies `require`.
  const source = [
    "import { createRequire } from 'node:module';",
    "import { existsSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    'const req = createRequire(import.meta.url);',
    `const plan = ${JSON.stringify(plan)};`,
    'let bad = 0;',
    'for (const { spec, viaRequire } of plan) {',
    '  const file = fileURLToPath(import.meta.resolve(spec));',
    '  if (!existsSync(file)) { console.error(`import of ${spec} resolves to a missing file: ${file}`); bad += 1; }',
    '  if (viaRequire) {',
    '    const cjs = req.resolve(spec);',
    '    if (!existsSync(cjs)) { console.error(`require of ${spec} resolves to a missing file: ${cjs}`); bad += 1; }',
    '  }',
    '}',
    'console.log(`resolved ${plan.length} subpaths (import, and require where declared)`);',
    'process.exit(bad ? 1 : 0);',
  ].join('\n');
  writeFileSync(join(work, 'resolve-check.mjs'), `${source}\n`);
  run('node', ['resolve-check.mjs'], { cwd: work });
}

function runtimeChecks(work, manifests) {
  const contract = manifests.find((m) => m.name === '@marinoscar/vault-contract');
  if (contract) {
    run('node', ['-e', "const m = require('@marinoscar/vault-contract/agent'); if (!m.agentFillRequestSchema || !m.AGENT_SCOPES) { console.error('missing agent exports'); process.exit(1); } console.log('CJS require of @marinoscar/vault-contract/agent: ok')"], { cwd: work });
    run('node', ['--input-type=module', '-e', "import { agentFillRequestSchema, AGENT_SCOPES } from '@marinoscar/vault-contract/agent'; if (typeof agentFillRequestSchema?.parse !== 'function' || !AGENT_SCOPES) { console.error('bad agent exports'); process.exit(1); } console.log('ESM import of agentFillRequestSchema and AGENT_SCOPES: ok')"], { cwd: work });
    const specs = subpaths(contract).map((sub) => specifier(contract.name, sub));
    run('node', ['-e', `for (const s of ${JSON.stringify(specs)}) require(s); console.log('CJS require of ${specs.length} vault-contract subpaths: ok')`], { cwd: work });
    run('node', ['--input-type=module', '-e', `for (const s of ${JSON.stringify(specs)}) await import(s); console.log('ESM import of ${specs.length} vault-contract subpaths: ok')`], { cwd: work });
  }
  if (manifests.some((m) => m.name === '@marinoscar/vault-db')) {
    run('node', ['-e', "require('@marinoscar/vault-db'); console.log('CJS require of @marinoscar/vault-db: ok')"], { cwd: work });
    run(NPX, ['--no-install', 'vault-db', '--help'], { cwd: work });
  }
}

function typeChecks(work, manifests) {
  const base = { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: true, noEmit: true, types: ['node'], esModuleInterop: true };
  const strictLibs = manifests.filter((m) => ['@marinoscar/vault-contract', '@marinoscar/vault-db'].includes(m.name));
  const all = typeSmokeSource(manifests);
  const cjs = typeSmokeSource(manifests, { cjsOnly: true });
  const strictEsm = typeSmokeSource(strictLibs);
  const strictCjs = typeSmokeSource(strictLibs, { cjsOnly: true });
  writeFileSync(join(work, 'smoke.node16.mts'), all.source);
  writeFileSync(join(work, 'smoke.node16.cts'), cjs.source);
  writeFileSync(join(work, 'smoke.bundler.ts'), all.source);
  writeFileSync(join(work, 'smoke.libs.mts'), strictEsm.source);
  writeFileSync(join(work, 'smoke.libs.cts'), strictCjs.source);
  writeFileSync(join(work, 'smoke.libs.bundler.ts'), strictEsm.source);
  const configs = {
    'tsconfig.node16.json': { compilerOptions: { ...base, module: 'node16', moduleResolution: 'node16', skipLibCheck: true }, files: ['smoke.node16.mts', 'smoke.node16.cts'] },
    'tsconfig.bundler.json': { compilerOptions: { ...base, module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true }, files: ['smoke.bundler.ts'] },
    'tsconfig.libs.node16.json': { compilerOptions: { ...base, module: 'node16', moduleResolution: 'node16', skipLibCheck: false }, files: ['smoke.libs.mts', 'smoke.libs.cts'] },
    'tsconfig.libs.bundler.json': { compilerOptions: { ...base, module: 'esnext', moduleResolution: 'bundler', skipLibCheck: false }, files: ['smoke.libs.bundler.ts'] },
  };
  for (const [file, config] of Object.entries(configs)) {
    writeFileSync(join(work, file), `${JSON.stringify(config, null, 2)}\n`);
    run(NPX, ['--no-install', 'tsc', '-p', file], { cwd: work });
    console.log(`typecheck ${file}: ok`);
  }
  return { esm: all.count, cjs: cjs.count };
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`smoke-install: ${err.message}\nUsage: node scripts/vault-packages/smoke-install.mjs (--pack | --tarballs <dir> | --registry [--tag next]) [--work <dir>] [--keep]`);
    return 2;
  }
  const packages = listPackages(REPO_ROOT);
  if (packages.length === 0) {
    console.error('smoke-install: no packages/vault-* package found');
    return 2;
  }

  const work = resolve(opts.work ?? mkdtempSync(join(tmpdir(), 'vault-smoke-')));
  if (isInside(work, REPO_ROOT)) {
    console.error(`smoke-install: ${work} is inside the workspace; the install must happen outside it`);
    return 2;
  }
  mkdirSync(work, { recursive: true });
  console.log(`smoke-install: mode ${opts.mode}, folder ${work}`);

  try {
    let installSpecs;
    let manifests;
    if (opts.mode === 'registry') {
      const found = registryManifests(packages, opts.tag);
      if (found.missing) {
        const msg = `the packages are not on npm at '${opts.tag}' yet: ${found.missing.join(', ')}. Nothing was installed or tested (docs/runbooks/release-vault-packages.md, owner prerequisites).`;
        console.log(`::notice title=Vault package smoke test skipped::${msg}`);
        console.log(`SKIPPED: ${msg}`);
        summary(['### Vault package smoke test: SKIPPED', '', msg]);
        output('result', 'skipped');
        return 0;
      }
      manifests = found.manifests;
      installSpecs = packages.map(({ name }) => `${name}@${opts.tag}`);
    } else {
      let dir = opts.tarballs;
      if (opts.mode === 'pack') {
        dir = join(work, 'tarballs');
        mkdirSync(dir, { recursive: true });
        for (const { name } of packages) run(NPM, ['pack', '-w', name, '--pack-destination', dir], { cwd: REPO_ROOT });
      }
      if (!dir || !existsSync(dir)) throw new Error(`tarball folder '${dir}' does not exist`);
      installSpecs = tarballsIn(dir, packages);
      manifests = installSpecs.map(readManifestFromTarball);
    }

    const versions = new Set(manifests.map((m) => m.version));
    if (versions.size !== 1) throw new Error(`the packages do not share one version: ${manifests.map((m) => `${m.name}@${m.version}`).join(', ')}`);

    const { peers, conflicts } = collectPeers(manifests);
    if (conflicts.length) throw new Error(`the packages declare different ranges for one peer: ${conflicts.join('; ')}`);
    const peerSpecs = Object.entries({ ...peers, ...TYPE_TOOLING }).map(([name, range]) => `${name}@${range}`);
    console.log(`installing ${manifests.map((m) => `${m.name}@${m.version}`).join(', ')}\npeers and type tooling: ${peerSpecs.join(' ')}`);

    run(NPM, ['init', '-y'], { cwd: work, capture: true });
    run(NPM, ['install', '--no-audit', '--no-fund', ...installSpecs, ...peerSpecs], { cwd: work });

    // From here on, read what was installed, not what we asked for.
    const installed = packages.map(({ name }) => JSON.parse(readFileSync(join(work, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')));
    resolveChecks(work, installed);
    runtimeChecks(work, installed);
    const counts = typeChecks(work, installed);

    const line = `${installed.map((m) => `${m.name}@${m.version}`).join(', ')}: resolve, CJS, ESM, vault-db --help and types (${counts.esm} subpaths under node16 and bundler, ${counts.cjs} through require) passed`;
    console.log(`\nPASSED (${opts.mode}): ${line}`);
    summary([`### Vault package smoke test: PASSED (${opts.mode})`, '', line]);
    output('result', 'passed');
    return 0;
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    summary(['### Vault package smoke test: FAILED', '', '```', String(err.message).slice(0, 4000), '```']);
    output('result', 'failed');
    return 1;
  } finally {
    if (!opts.keep && !opts.work) rmSync(work, { recursive: true, force: true });
    else console.log(`kept ${work}`);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) process.exit(main());
