import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PLATFORM_API_PACKAGE,
  SUPPORTED_PLATFORM_RANGE,
  assertSupportedPlatform,
  compareVersions,
  readInstalledPlatformVersion,
  satisfiesRange,
} from './platform-compat';

const PEERS = require('../../package.json').peerDependencies as Record<string, string>;

describe('platform compatibility', () => {
  it('the supported range is the explicit peer range of the package', () => {
    expect(PEERS[PLATFORM_API_PACKAGE]).toBe(SUPPORTED_PLATFORM_RANGE);
    expect(PEERS['@marinoscar/platform-contract']).toBe(SUPPORTED_PLATFORM_RANGE);
    expect(SUPPORTED_PLATFORM_RANGE).toMatch(/^>=\S+ <=\S+$/);
  });

  it('orders pre-releases numerically and before their release', () => {
    expect(compareVersions('0.1.0-next.9', '0.1.0-next.10')).toBe(-1);
    expect(compareVersions('0.1.0-next.39', '0.1.0-next.39')).toBe(0);
    expect(compareVersions('0.1.0', '0.1.0-next.99')).toBe(1);
    expect(compareVersions('0.1.0-next.1', '0.1.0-next')).toBe(1);
    expect(compareVersions('0.1.0-alpha', '0.1.0-1')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  it('checks both ends of an explicit range', () => {
    const range = '>=0.1.0-next.37 <=0.1.0-next.39';
    expect(satisfiesRange('0.1.0-next.37', range)).toBe(true);
    expect(satisfiesRange('0.1.0-next.38', range)).toBe(true);
    expect(satisfiesRange('0.1.0-next.39', range)).toBe(true);
    expect(satisfiesRange('0.1.0-next.36', range)).toBe(false);
    expect(satisfiesRange('0.1.0-next.40', range)).toBe(false);
    expect(satisfiesRange('0.1.0', range)).toBe(false);
    expect(satisfiesRange('0.2.0', '>=0.1.0 <0.3.0')).toBe(true);
  });

  it('refuses a caret or tilde rather than guessing what it means for a pre-release', () => {
    expect(() => satisfiesRange('0.1.0-next.37', '^0.1.0-next.37')).toThrow(/Unsupported version range/);
    expect(() => satisfiesRange('0.1.0-next.37', '~0.1.0-next.37')).toThrow(/Unsupported version range/);
  });

  it('reads the installed platform-api version', () => {
    const installed = readInstalledPlatformVersion();
    expect(installed).toBe(require(`${PLATFORM_API_PACKAGE}/package.json`).version);
  });

  it('reads the version from the package root when ./package.json is not exported', () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-platform-compat-'));
    try {
      const pkg = join(root, 'node_modules', '@marinoscar', 'platform-api');
      mkdirSync(join(pkg, 'dist'), { recursive: true });
      writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({
          name: PLATFORM_API_PACKAGE,
          version: '0.1.0-next.38',
          exports: { '.': './dist/index.js' },
        }),
      );
      writeFileSync(join(pkg, 'dist', 'index.js'), 'module.exports = {};');
      expect(readInstalledPlatformVersion(root)).toBe('0.1.0-next.38');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts the installed platform', () => {
    expect(() => assertSupportedPlatform()).not.toThrow();
  });

  it('fails with one error naming the installed and the supported versions', () => {
    expect(() => assertSupportedPlatform('0.1.0-next.36', '>=0.1.0-next.37 <=0.1.0-next.39')).toThrow(
      '@marinoscar/vault-api supports @marinoscar/platform-api >=0.1.0-next.37 <=0.1.0-next.39, but 0.1.0-next.36 is installed.',
    );
    expect(() => assertSupportedPlatform('not-a-version')).toThrow(/but not-a-version is installed/);
  });
});

describe('VaultApiModule.forRoot platform check', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock(`${PLATFORM_API_PACKAGE}/package.json`);
  });

  function forRootWithInstalled(version: string) {
    let call: (() => unknown) | undefined;
    jest.isolateModules(() => {
      jest.doMock(`${PLATFORM_API_PACKAGE}/package.json`, () => ({ name: PLATFORM_API_PACKAGE, version }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { VaultApiModule } = require('../vault-api.module') as typeof import('../vault-api.module');
      call = () => VaultApiModule.forRoot({ bindings: {} as never });
    });
    return call!;
  }

  it('refuses to boot on a platform below the range', () => {
    expect(forRootWithInstalled('0.1.0-next.1')).toThrow(
      `@marinoscar/vault-api supports @marinoscar/platform-api ${SUPPORTED_PLATFORM_RANGE}, but 0.1.0-next.1 is installed.`,
    );
  });

  it('refuses to boot on a platform above the range', () => {
    expect(forRootWithInstalled('0.1.0-next.99')).toThrow(/but 0\.1\.0-next\.99 is installed/);
  });

  it('boots on a platform inside the range', () => {
    const high = SUPPORTED_PLATFORM_RANGE.split('<=')[1];
    expect(forRootWithInstalled(high)).not.toThrow();
  });
});
