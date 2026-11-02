import { describe, expect, it } from 'vitest';

import appSource from '../../App.tsx?raw';

/**
 * Packages first (ADR-0001, E12.3 #104): the Vault domain's pages and
 * components live once, in `@marinoscar/vault-web`; `apps/web` is the HOST
 * (routes, providers, platform bindings, the settings registries and hub
 * bindings, the shell binding, the service worker, Vite).
 *
 * This guard fails when a domain page or component is (re)defined in the app,
 * when a domain folder (`hooks/`, `utils/`, `types/`, a domain component
 * folder) comes back, when a page that is not host glue appears under
 * `pages/`, or when the host reaches into the package's files instead of its
 * public subpaths.
 */

/** Every host source file under src/ (tests excluded), keyed `pages/x.tsx`. */
const HOST: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../__tests__/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, source]) => [path.replace(/^\.\.\/\.\.\//, ''), source]),
);

/** The package's UI modules (pages and components), keyed by their path under `packages/vault-web/src`. */
const PACKAGE_UI: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../../../../../packages/vault-web/src/*/ui/**/*.tsx', '../../../../../packages/vault-web/src/brand/*.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, source]) => [path.replace(/^.*packages\/vault-web\/src\//, ''), source]),
);

/** Component names the package exports (default or named function or const components). */
function exportedComponents(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/export (?:default )?function ([A-Z]\w*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export const ([A-Z]\w*)\s*[:=]/g)) names.add(m[1]);
  return [...names];
}

const DOMAIN_COMPONENTS = [...new Set(Object.values(PACKAGE_UI).flatMap(exportedComponents))].sort();

/** Host pages that are glue, not domain: each binds a platform page or the hubs. */
const HOST_PAGES: Record<string, string> = {
  'pages/TestLoginPage.tsx': 'development-only test sign-in against the API test route',
  'pages/UserSettingsHubPage.tsx': 'binding of the packaged SettingsHub over USER_SETTINGS_SECTIONS',
  'pages/admin/AdminSettingsHubPage.tsx': 'binding of the packaged SettingsHub over ADMIN_SECTIONS',
  'pages/admin/DbBackupSettingsPage.tsx': 'the platform DbBackupPage with the host adapters',
  'pages/DataExportRoute.tsx': 'the platform data-export page with the Vault notice slot',
  'pages/UserDataPages.tsx': 'the platform Danger Zone and factory-reset pages with the Vault notice slots',
};

/** Host component folders: the shell binding and the slots of platform pages. */
const HOST_COMPONENT_DIRS: Record<string, string> = {
  'components/common': 'Layout.tsx, the ShellLayout binding',
  'components/onboarding': 'the platform onboarding pages, refreshed on mount',
  'components/exports': 'the notice slot of the platform data-export page',
  'components/user-data': 'the notice slots of the platform Danger Zone pages',
};

describe('packages first: apps/web is a host', () => {
  it('reads the package (sanity)', () => {
    expect(Object.keys(PACKAGE_UI).length).toBeGreaterThan(50);
    expect(DOMAIN_COMPONENTS).toEqual(
      expect.arrayContaining(['SecretDetailPage', 'SecretsPage', 'CardsPage', 'HomePage', 'MediaFoldersPage', 'BrandLockup']),
    );
    expect(Object.keys(HOST).length).toBeGreaterThan(20);
  });

  it('defines no domain page or component in the app', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(HOST)) {
      for (const name of DOMAIN_COMPONENTS) {
        // `const SecretsPage = lazy(() => import('@marinoscar/vault-web/...'))` is a route binding, not a definition.
        const definition = new RegExp(`(?:function|class)\\s+${name}\\b|const\\s+${name}\\s*[:=](?!\\s*lazy\\()`);
        if (definition.test(source)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no domain folders (hooks, utils, types, assets) and no domain component folder', () => {
    const files = Object.keys(HOST);
    expect(files.filter((f) => /^(hooks|utils|types|assets)\//.test(f))).toEqual([]);
    const componentDirs = [...new Set(files.filter((f) => f.startsWith('components/')).map((f) => f.split('/').slice(0, 2).join('/')))];
    expect(componentDirs.filter((d) => !(d in HOST_COMPONENT_DIRS))).toEqual([]);
    expect(files.filter((f) => f.startsWith('components/common/'))).toEqual(['components/common/Layout.tsx']);
  });

  it('keeps only host glue under pages/', () => {
    const pages = Object.keys(HOST).filter((f) => f.startsWith('pages/'));
    expect(pages.filter((f) => !(f in HOST_PAGES))).toEqual([]);
  });

  it('lists no stale host page', () => {
    for (const file of Object.keys(HOST_PAGES)) expect(HOST[file]).toBeDefined();
  });

  it('routes to the domain pages from the package', () => {
    for (const page of ['HomePage', 'SecretsPage', 'SecretDetailPage', 'CardsPage', 'ImportCardPage', 'MediaFoldersPage', 'MyBackupsPage', 'SecretTypesPage']) {
      expect(appSource).toMatch(
        new RegExp(`const ${page} = lazy\\(\\(\\) => import\\('@marinoscar/vault-web/[a-z]+/ui'\\)`),
      );
    }
  });

  it('imports the package only through its public subpaths', () => {
    const deep = Object.entries(HOST)
      .filter(([, source]) => /@marinoscar\/vault-web\/(src|dist)\b|packages\/vault-web/.test(source))
      .map(([file]) => file);
    expect(deep).toEqual([]);
  });
});
