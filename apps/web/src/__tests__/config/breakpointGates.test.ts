import { describe, expect, it } from 'vitest';

/**
 * The five coupled breakpoint gates (AGENTS.md, Settings UI Pattern rule 5)
 * are the platform shell's. The app reads NO breakpoint for them: any
 * `useMediaQuery(` or `breakpoints.up|down|between|only(` outside the list
 * below fails, and each listed file says why it is not a gate.
 */
const ALLOWED: Record<string, string> = {
  // Empty since E12.3 (#104): the one domain dialog that adapts its content to a
  // phone moved to @marinoscar/vault-web, whose own breakpoint test lists it.
};

const PATTERN = /useMediaQuery\(|breakpoints\.(up|down|between|only)\(/;

/** Every app source file under src/ (tests excluded), keyed `components/x.tsx`. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../__tests__/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, source]) => [path.replace(/^\.\.\/\.\.\//, ''), source]),
);

describe('breakpoint gates', () => {
  it('no app file reads a breakpoint unless listed with a reason', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, source]) => PATTERN.test(source))
      .map(([file]) => file)
      .filter((file) => !(file in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('lists no stale exemption (each listed file still reads a breakpoint)', () => {
    for (const file of Object.keys(ALLOWED)) expect(SOURCES[file]).toMatch(PATTERN);
  });

  it('scans the app (sanity) and the shell binding reads none', () => {
    // The host only (E12.3: the domain pages are @marinoscar/vault-web's).
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    expect(SOURCES['components/common/Layout.tsx']).toBeDefined();
    expect(SOURCES['components/common/Layout.tsx']).not.toMatch(PATTERN);
  });
});
