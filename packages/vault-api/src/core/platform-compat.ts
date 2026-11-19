import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/** The platform package whose installed version {@link VaultApiModule.forRoot} checks. */
export const PLATFORM_API_PACKAGE = '@marinoscar/platform-api';

/**
 * The `@marinoscar/platform-*` versions this release of the Vault packages was tested with: the
 * lowest and the highest pre-release of the CI matrix (docs/PACKAGES.md, "Platform
 * compatibility"). It is the exact `peerDependencies` range of `vault-api` and `vault-web`;
 * `npm run check:platform-compat` fails when this constant, the peers and the compatibility table
 * disagree.
 *
 * @stability experimental
 */
export const SUPPORTED_PLATFORM_RANGE = '>=0.1.0-next.36 <=0.1.0-next.39';

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): ParsedVersion | null {
  const m = VERSION_RE.exec(version.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence of two versions (-1, 0, 1). Build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Not a semantic version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return Math.sign(pa.core[i] - pb.core[i]);
  }
  // A pre-release sorts before its release.
  if (!pa.pre.length || !pb.pre.length) return Math.sign(pb.pre.length - pa.pre.length) || 0;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    if (pa.pre[i] === undefined) return -1;
    if (pb.pre[i] === undefined) return 1;
    const c = compareIdentifiers(pa.pre[i], pb.pre[i]);
    if (c) return c;
  }
  return 0;
}

const COMPARATOR_RE = /^(>=|<=|>|<|=)?(\S+)$/;

/**
 * Whether `version` satisfies `range`, a space-separated list of comparators (`>=`, `<=`, `>`,
 * `<`, `=`), all of which must hold. That is the explicit form the policy uses for platform
 * pre-releases; a caret, a tilde or `||` is refused rather than guessed.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const comparators = range.trim().split(/\s+/).filter(Boolean);
  if (!comparators.length) throw new Error(`Empty version range`);
  return comparators.every((part) => {
    const m = COMPARATOR_RE.exec(part);
    if (!m || !parseVersion(m[2])) throw new Error(`Unsupported version range: ${range}`);
    const c = compareVersions(version, m[2]);
    switch (m[1] ?? '=') {
      case '>=':
        return c >= 0;
      case '<=':
        return c <= 0;
      case '>':
        return c > 0;
      case '<':
        return c < 0;
      default:
        return c === 0;
    }
  });
}

/**
 * Reads the installed `@marinoscar/platform-api` version from its `package.json`.
 *
 * The platform exports `./package.json`, so the plain subpath read works; if a later release
 * stops exporting it, the package root is found from the main entry instead. A stop-gap until the
 * platform offers a supported way to read its version (docs/platform-adoption/local-exceptions.md).
 */
export function readInstalledPlatformVersion(fromDir?: string): string {
  // This module's own require by default; `fromDir` resolves as if from another directory.
  const req: NodeJS.Require = fromDir ? createRequire(join(fromDir, 'noop.js')) : require;
  try {
    return (req(`${PLATFORM_API_PACKAGE}/package.json`) as { version: string }).version;
  } catch {
    // Not exported: walk up from the main entry to the package root.
    let dir = dirname(req.resolve(PLATFORM_API_PACKAGE));
    for (;;) {
      const file = join(dir, 'package.json');
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version: string };
        if (pkg.name === PLATFORM_API_PACKAGE) return pkg.version;
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`Cannot find the package.json of ${PLATFORM_API_PACKAGE}`);
      dir = parent;
    }
  }
}

/**
 * Throws one readable error when the installed platform is outside {@link SUPPORTED_PLATFORM_RANGE}
 * (or the given range). {@link VaultApiModule.forRoot} calls it at boot, so a host on an untested
 * platform fails here, naming both versions, instead of later on a missing symbol.
 *
 * @stability experimental
 */
export function assertSupportedPlatform(
  installed: string = readInstalledPlatformVersion(),
  range: string = SUPPORTED_PLATFORM_RANGE,
): void {
  let ok: boolean;
  try {
    ok = satisfiesRange(installed, range);
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(
      `@marinoscar/vault-api supports ${PLATFORM_API_PACKAGE} ${range}, but ${installed} is installed. ` +
        `Install a platform version in that range, or a @marinoscar/vault-api release that supports ${installed} ` +
        `(docs/PACKAGES.md, "Platform compatibility").`,
    );
  }
}
