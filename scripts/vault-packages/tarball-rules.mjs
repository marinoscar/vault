// =============================================================================
// Pre-publish rules for the @marinoscar/vault-* tarballs (#192)
// =============================================================================
//
// Pure functions used by check-package-pack.mjs, kept apart so they can be
// tested without npm (scripts/vault-packages/test/tarball-rules.test.mjs). The
// pack check asks npm for the file list (`npm pack --dry-run --json`) and reads
// each listed file from the package folder, which is what npm puts in the
// tarball.
//
//   allow-list   every packed file is one of: package.json, README.md, LICENSE,
//                CHANGELOG.md, compiled output under dist/ (.js/.cjs/.mjs and
//                their .d.ts), the dist/{cjs,esm}/package.json stubs, a media
//                file only when an `exports` entry publishes it (the vault-web
//                brand mark), and the per-package extras below. A source map is
//                never on the list. No __tests__/fixtures/__mocks__ folder.
//   exports      every `exports` target (all conditions, nested) and every
//                main/module/types/bin target is in the tarball; a `*` pattern
//                must match at least one packed file.
//   per package  vault-contract: dist/cjs and dist/esm with their package.json
//                stubs ({"type":"commonjs"} / {"type":"module"}).
//                vault-db: bin/vault-db.js, schema/*.prisma, migrations/
//                manifest.json and every migration it lists, raw-sql-indexes.json,
//                extensions.json, schema-objects.json.
//   content      no packed text file holds the absolute path of the checkout
//                (a leaked build path), and none holds a Luhn-valid card number
//                that is not a published test number (the placeholders rule in
//                AGENTS.md).
//
// Node built-ins only.
// =============================================================================

const stripDot = (p) => p.replace(/^\.\//, '');

/** Files every package may ship at its root. */
export const ROOT_FILES = Object.freeze(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);

/** Compiled output under dist/. */
const DIST_CODE = /^dist\/.+\.(?:js|cjs|mjs|d\.ts|d\.cts|d\.mts)$/;
const DIST_STUB = /^dist\/(?:cjs|esm)\/package\.json$/;
const MEDIA = /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|avif|mp4|webm|mov|mp3|wav|pdf)$/i;
const NEVER = [
  { pattern: /\.map$/, why: 'a source map (it can embed absolute paths and the sources)' },
  { pattern: /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|fixtures?|test|tests)\//, why: 'a test or fixture folder' },
  { pattern: /\.(?:test|spec)\.[cm]?[jt]sx?$/, why: 'a test file' },
  { pattern: /(?:^|\/)\.env/, why: 'an environment file' },
  { pattern: /(?:^|\/)src\//, why: 'source code' },
  { pattern: /\.tsbuildinfo$/, why: 'a TypeScript build cache' },
];

/** Extra files a package may ship, and the files it MUST ship, keyed by folder. */
export const PACKAGE_RULES = Object.freeze({
  'vault-contract': {
    extras: [],
    required: ['dist/cjs/package.json', 'dist/esm/package.json', 'dist/cjs/index.js', 'dist/esm/index.js'],
    stubs: { 'dist/cjs/package.json': 'commonjs', 'dist/esm/package.json': 'module' },
  },
  'vault-db': {
    extras: [
      /^bin\/vault-db\.js$/,
      /^schema\/[^/]+\.prisma$/,
      /^migrations\/manifest\.json$/,
      /^migrations\/[0-9]{14}_[a-z0-9_]+\/migration\.sql$/,
      /^(?:raw-sql-indexes|extensions|schema-objects)\.json$/,
    ],
    required: [
      'bin/vault-db.js',
      'migrations/manifest.json',
      'raw-sql-indexes.json',
      'extensions.json',
      'schema-objects.json',
    ],
    requiredPatterns: [{ pattern: /^schema\/[^/]+\.prisma$/, what: 'a schema/*.prisma fragment' }],
  },
  'vault-api': { extras: [], required: [] },
  'vault-web': { extras: [], required: [] },
});

/** Every file path an `exports` value (string, conditions or nested) points at. */
export function exportTargets(value) {
  if (typeof value === 'string') return [stripDot(value)];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

/** The files a manifest promises: exports (every condition), main, module, types and bin targets. */
export function promisedFiles(manifest) {
  const out = new Set();
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof manifest[field] === 'string') out.add(stripDot(manifest[field]));
  }
  const bin = manifest.bin;
  if (typeof bin === 'string') out.add(stripDot(bin));
  else if (bin) for (const target of Object.values(bin)) out.add(stripDot(target));
  for (const target of exportTargets(manifest.exports ?? {})) out.add(target);
  return [...out];
}

/** Turns an exports pattern target (`dist/*.js`) into a RegExp. */
function patternToRegExp(target) {
  const escaped = target.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.+')}$`);
}

/** Problems with the promised files: each must be packed (a `*` pattern must match one). */
export function checkPromised(manifest, files) {
  const have = new Set(files);
  const problems = [];
  for (const target of promisedFiles(manifest)) {
    if (target.includes('*')) {
      const re = patternToRegExp(target);
      if (!files.some((f) => re.test(f))) problems.push(`exports pattern '${target}' matches no file in the tarball`);
    } else if (!have.has(target)) {
      problems.push(`tarball is missing '${target}'${target.startsWith('dist/') ? ' (run the build first)' : ''}, which the manifest points at`);
    }
  }
  return problems;
}

/** Problems with the file list against the allow-list of `dir` (a package folder name). */
export function checkAllowList(dir, manifest, files) {
  const rules = PACKAGE_RULES[dir] ?? { extras: [], required: [] };
  const published = new Set(promisedFiles(manifest));
  const problems = [];
  for (const file of files) {
    const never = NEVER.find(({ pattern }) => pattern.test(file));
    if (never) {
      problems.push(`tarball holds '${file}', ${never.why}, which must never be published`);
      continue;
    }
    if (MEDIA.test(file)) {
      if (!published.has(file)) problems.push(`tarball holds the media file '${file}', which no 'exports' entry publishes`);
      continue;
    }
    const allowed =
      ROOT_FILES.includes(file) ||
      DIST_CODE.test(file) ||
      DIST_STUB.test(file) ||
      rules.extras.some((re) => re.test(file));
    if (!allowed) problems.push(`tarball holds '${file}', which is not on the allow-list for ${dir}`);
  }
  for (const file of rules.required) {
    if (!files.includes(file)) problems.push(`tarball is missing '${file}', which ${dir} must ship`);
  }
  for (const { pattern, what } of rules.requiredPatterns ?? []) {
    if (!files.some((f) => pattern.test(f))) problems.push(`tarball holds no ${what}, which ${dir} must ship`);
  }
  return problems;
}

/**
 * Problems with the contents of specific files (`read(path)` returns the text or
 * null when unreadable): the vault-contract stubs and the vault-db migration list.
 */
export function checkPackageContents(dir, files, read) {
  const rules = PACKAGE_RULES[dir] ?? {};
  const problems = [];
  for (const [file, type] of Object.entries(rules.stubs ?? {})) {
    if (!files.includes(file)) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(read(file) ?? '');
    } catch {
      /* reported below */
    }
    if (parsed?.type !== type) problems.push(`'${file}' must be {"type":"${type}"} (scripts/vault-packages/write-dist-stubs.mjs)`);
  }
  if (dir === 'vault-db' && files.includes('migrations/manifest.json')) {
    let manifest = null;
    try {
      manifest = JSON.parse(read('migrations/manifest.json') ?? '');
    } catch {
      problems.push("'migrations/manifest.json' is not valid JSON");
    }
    const ids = (manifest?.migrations ?? []).map((m) => m.id);
    if (manifest && ids.length === 0) problems.push("'migrations/manifest.json' lists no migration");
    for (const id of ids) {
      if (!files.includes(`migrations/${id}/migration.sql`)) problems.push(`tarball is missing 'migrations/${id}/migration.sql', which migrations/manifest.json lists`);
    }
    for (const file of files) {
      const m = /^migrations\/([^/]+)\/migration\.sql$/.exec(file);
      if (m && manifest && !ids.includes(m[1])) problems.push(`tarball holds '${file}', which migrations/manifest.json does not list`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Content scans
// ---------------------------------------------------------------------------

/** Files whose text is scanned. */
export const TEXT_FILE = /\.(?:js|cjs|mjs|ts|cts|mts|json|md|sql|prisma|txt|map)$|(?:^|\/)LICENSE$/;

/** Luhn checksum of a digit string. */
export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Whether a digit string has the prefix and length of a card brand (Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay, Maestro). */
export function looksLikePan(digits) {
  const n = digits.length;
  if (n < 13 || n > 19) return false;
  const p2 = Number(digits.slice(0, 2));
  const p3 = Number(digits.slice(0, 3));
  const p4 = Number(digits.slice(0, 4));
  if (digits[0] === '4') return n === 13 || n === 16 || n === 19; // Visa
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16; // Mastercard
  if (p2 === 34 || p2 === 37) return n === 15; // Amex
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return n >= 16; // Discover
  if (p4 >= 3528 && p4 <= 3589) return n >= 16; // JCB
  if ((p3 >= 300 && p3 <= 305) || p2 === 36 || p2 === 38 || p2 === 39) return n >= 14; // Diners
  if (p2 === 62) return n >= 16; // UnionPay
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return n >= 12; // Maestro
  return false;
}

/** Published test card numbers (network and payment-processor documentation); allowed in fixtures. */
export const TEST_PANS = Object.freeze(
  new Set([
    '4111111111111111', '4242424242424242', '4012888888881881', '4222222222222', '4000056655665556',
    '4000000000000002', '4000000000000077', '4000000000003220', '4000002500003155', '4000000000009995',
    '4000000000000010', '4444333322221111', '4917610000000000', '4005519200000004', '4009348888881881',
    '5555555555554444', '5105105105105100', '5200828282828210', '5454545454545454', '5431111111111111',
    '2223003122003222', '2222400010000008', '2223000048400011',
    '378282246310005', '371449635398431', '378734493671000', '340000000000009', '370000000000002',
    '6011111111111117', '6011000990139424', '6011000000000004', '6011601160116611', '6445644564456445',
    '3530111333300000', '3566002020360505', '3566111111111113',
    '30569309025904', '38520000023237', '36227206271667', '3056930009020004',
    '6200000000000005', '6250941006528599', '6759649826438453',
  ]),
);

/**
 * Luhn-valid card numbers in `text` that are not published test numbers. Digits
 * may be grouped by single spaces or dashes; a run glued to more digits or
 * letters (a hash, an id, a timestamp) is not a card number.
 */
export function findRealLookingPans(text) {
  const found = new Set();
  const re = /(?<![0-9A-Za-z])[0-9](?:[ -]?[0-9]){11,18}(?![0-9A-Za-z])/g;
  for (const match of text.matchAll(re)) {
    const digits = match[0].replace(/[ -]/g, '');
    if (!looksLikePan(digits) || !luhnValid(digits)) continue;
    if (/^(\d)\1+$/.test(digits)) continue; // 0000..., an obvious filler
    if (TEST_PANS.has(digits)) continue;
    found.add(digits);
  }
  return [...found];
}

/** Masks a card number for a log line: first six and last four digits. */
export const maskPan = (digits) => `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`;

/** Absolute paths a source map names as its sources or source root. */
function absoluteMapSources(text) {
  let map;
  try {
    map = JSON.parse(text);
  } catch {
    return [];
  }
  const abs = (s) => typeof s === 'string' && (/^(?:\/|[A-Za-z]:[\\/]|file:\/\/)/.test(s));
  return [map.sourceRoot, ...(map.sources ?? [])].filter(abs);
}

/**
 * Content problems of packed files. `read(path)` returns the text of a packed
 * file. `forbiddenPaths` are absolute paths that must never appear (the checkout
 * root, the home folder).
 */
export function checkContents(files, read, { forbiddenPaths = [] } = {}) {
  const problems = [];
  const needles = forbiddenPaths.filter((p) => typeof p === 'string' && p.length > 1);
  for (const file of files) {
    if (!TEXT_FILE.test(file)) continue;
    const text = read(file);
    if (typeof text !== 'string') continue;
    for (const needle of needles) {
      if (text.includes(needle)) problems.push(`'${file}' embeds the absolute path '${needle}'`);
    }
    if (file.endsWith('.map')) {
      for (const source of absoluteMapSources(text)) problems.push(`'${file}' names the absolute source '${source}'`);
    }
    for (const pan of findRealLookingPans(text)) {
      problems.push(`'${file}' holds a Luhn-valid card number (${maskPan(pan)}) that is not a published test number; use one (AGENTS.md, placeholders rule)`);
    }
  }
  return problems;
}
