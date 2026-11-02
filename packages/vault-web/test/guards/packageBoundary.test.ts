import { describe, expect, it } from 'vitest';

/**
 * The package's own guards (E12.3, #104; ADR-0001):
 *
 *  - dependency direction is host -> package: no source file imports the host
 *    (`apps/web`) or reaches out of `src/` with a relative path;
 *  - no build-time variable (`import.meta.env`): configuration is the host's,
 *    through `configureVaultWeb`;
 *  - every relative import keeps its `.js` extension (the build is NodeNext,
 *    the published package is ESM);
 *  - the five coupled breakpoint gates are the platform shell's: a domain file
 *    reads a breakpoint only to adapt its own content, listed here with a reason.
 */

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../../src/**/*.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }),
  ).map(([path, source]) => [path.replace(/^\.\.\/\.\.\/src\//, ''), source]),
);

const BREAKPOINT_ALLOWED: Record<string, string> = {
  'backups/ui/components/AdminBackupDownloadDialog.tsx':
    'a domain dialog goes full-screen on a phone; content adaptation, not navigation chrome',
};
const BREAKPOINT = /useMediaQuery\(|breakpoints\.(up|down|between|only)\(/;

/** Specifiers of `from '...'`, `import('...')` and `import '...'`. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)'([^']+)'/g)].map((m) => m[1]);
}

/** The relative ones. */
function relativeSpecifiers(source: string): string[] {
  return specifiers(source).filter((spec) => spec.startsWith('./') || spec.startsWith('../'));
}

describe('vault-web package boundary', () => {
  it('scans the package (sanity)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it('never imports the host', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, source]) => specifiers(source).some((spec) => /apps\/web|^@\/|^web(\/|$)/.test(spec)))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('never reaches out of src/ with a relative import', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      const depth = file.split('/').length - 1;
      for (const spec of relativeSpecifiers(source)) {
        const ups = spec.split('/').filter((part) => part === '..').length;
        if (ups > depth) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the .js extension on every relative import of a module', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const spec of relativeSpecifiers(source)) {
        if (!/\.(js|png)$/.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads no build-time variable', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, source]) => source.includes('import.meta.env'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('reads a breakpoint only in a listed content adaptation', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([file, source]) => BREAKPOINT.test(source) && !(file in BREAKPOINT_ALLOWED))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
    for (const file of Object.keys(BREAKPOINT_ALLOWED)) expect(SOURCES[file]).toMatch(BREAKPOINT);
  });
});
