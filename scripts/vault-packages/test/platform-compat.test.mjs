// Tests of platform-compat.mjs: `node --test scripts/vault-packages/test/platform-compat.test.mjs`
// (run by `npm run check:platform-compat`). Each case builds a small fixture checkout.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  TABLE_END,
  TABLE_START,
  checkPlatformCompat,
  compareVersions,
  parseRange,
  parseTable,
  usePlatformVersion,
  writeTable,
} from '../platform-compat.mjs';

const RANGE = '>=0.1.0-next.37 <=0.1.0-next.39';
const roots = [];

function write(root, file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function table(rows) {
  return [
    '# Packages',
    '',
    TABLE_START,
    '| Vault packages | Platform range (`@marinoscar/platform-*`) | Date |',
    '|---|---|---|',
    ...rows.map(([v, r, d]) => `| \`${v}\` | \`${r}\` | ${d} |`),
    TABLE_END,
    '',
  ].join('\n');
}

/** A checkout that agrees everywhere; `over` replaces parts of it. */
function fixture(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'platform-compat-'));
  roots.push(root);
  const peer = over.peer ?? RANGE;
  const version = '0.1.0-next.1';
  write(root, 'package.json', { name: 'vault', devDependencies: { '@marinoscar/platform-infra': over.rootPin ?? '0.1.0-next.39' } });
  write(root, 'apps/api/package.json', { name: 'api', dependencies: { '@marinoscar/platform-api': '0.1.0-next.39' } });
  write(root, 'packages/vault-contract/package.json', { name: '@marinoscar/vault-contract', version });
  write(root, 'packages/vault-db/package.json', { name: '@marinoscar/vault-db', version });
  write(root, 'packages/vault-api/package.json', {
    name: '@marinoscar/vault-api',
    version,
    peerDependencies: { '@marinoscar/platform-api': peer, '@marinoscar/platform-contract': peer },
  });
  write(root, 'packages/vault-web/package.json', {
    name: '@marinoscar/vault-web',
    version,
    peerDependencies: { '@marinoscar/platform-web': peer },
    devDependencies: { '@marinoscar/platform-web': '0.1.0-next.39' },
  });
  write(
    root,
    'packages/vault-api/src/core/platform-compat.ts',
    `export const SUPPORTED_PLATFORM_RANGE = '${over.constant ?? RANGE}';\n`,
  );
  write(root, 'docs/PACKAGES.md', table(over.rows ?? [[version, RANGE, '2026-11-19'], ['0.1.0-next.0', '>=0.1.0-next.21 <=0.1.0-next.21', '2026-11-10']]));
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('platform-compat', () => {
  it('passes on this repository', () => {
    const { problems, range } = checkPlatformCompat();
    assert.deepEqual(problems, []);
    assert.ok(parseRange(range));
  });

  it('passes when the peers, the constant, the table and the pins agree', () => {
    assert.deepEqual(checkPlatformCompat(fixture()).problems, []);
  });

  it('fails when the table and the peerDependencies disagree', () => {
    const root = fixture({ rows: [['0.1.0-next.1', '>=0.1.0-next.36 <=0.1.0-next.39', '2026-11-19']] });
    const { problems } = checkPlatformCompat(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /row 0\.1\.0-next\.1 says ">=0\.1\.0-next\.36 <=0\.1\.0-next\.39", the peerDependencies say/);
  });

  it('fails when an Unreleased first row disagrees with the peerDependencies', () => {
    const root = fixture({ rows: [['Unreleased', '>=0.1.0-next.38 <=0.1.0-next.39', '2026-11-19'], ['0.1.0-next.1', RANGE, '2026-11-18']] });
    assert.match(checkPlatformCompat(root).problems.join('\n'), /row Unreleased says ">=0\.1\.0-next\.38/);
  });

  it('accepts an Unreleased first row over an older release with another range', () => {
    const root = fixture({ rows: [['Unreleased', RANGE, '2026-11-19'], ['0.1.0-next.1', '>=0.1.0-next.37 <=0.1.0-next.37', '2026-11-18']] });
    assert.deepEqual(checkPlatformCompat(root).problems, []);
  });

  it('fails when the first row is neither Unreleased nor the current version', () => {
    const root = fixture({ rows: [['0.1.0-next.0', RANGE, '2026-11-10']] });
    assert.match(checkPlatformCompat(root).problems.join('\n'), /the first row is 0\.1\.0-next\.0; it must be Unreleased or the current version 0\.1\.0-next\.1/);
  });

  it('fails when two peer ranges disagree', () => {
    const root = fixture();
    write(root, 'packages/vault-web/package.json', {
      name: '@marinoscar/vault-web',
      version: '0.1.0-next.1',
      peerDependencies: { '@marinoscar/platform-web': '>=0.1.0-next.38 <=0.1.0-next.39' },
    });
    assert.match(checkPlatformCompat(root).problems.join('\n'), /the platform peer ranges disagree/);
  });

  it('fails on a caret or an exact peer', () => {
    assert.match(checkPlatformCompat(fixture({ peer: '^0.1.0-next.37', constant: '^0.1.0-next.37' })).problems.join('\n'), /not the explicit form/);
    assert.match(checkPlatformCompat(fixture({ peer: '0.1.0-next.39', constant: '0.1.0-next.39' })).problems.join('\n'), /not the explicit form/);
  });

  it('fails when the boot-check constant disagrees', () => {
    const root = fixture({ constant: '>=0.1.0-next.38 <=0.1.0-next.39' });
    assert.match(checkPlatformCompat(root).problems.join('\n'), /SUPPORTED_PLATFORM_RANGE is ">=0\.1\.0-next\.38/);
  });

  it('fails when a workspace pin is not the highest of the range', () => {
    const root = fixture({ rootPin: '0.1.0-next.37' });
    assert.match(checkPlatformCompat(root).problems.join('\n'), /package\.json devDependencies @marinoscar\/platform-infra is "0\.1\.0-next\.37"/);
  });

  it('--write adds an Unreleased row first and keeps the history', () => {
    const root = fixture({ rows: [['0.1.0-next.1', '>=0.1.0-next.37 <=0.1.0-next.37', '2026-11-10']] });
    writeTable(root, 'unreleased', '2026-12-01');
    assert.deepEqual(checkPlatformCompat(root).problems, []);
    const md = readFileSync(join(root, 'docs/PACKAGES.md'), 'utf8');
    assert.match(md, /\| `Unreleased` \| `>=0\.1\.0-next\.37 <=0\.1\.0-next\.39` \| 2026-12-01 \|\n\| `0\.1\.0-next\.1` /);
  });

  it('--write changes nothing when the current release already carries the range', () => {
    const root = fixture();
    const before = readFileSync(join(root, 'docs/PACKAGES.md'), 'utf8');
    writeTable(root, 'unreleased', '2026-12-01');
    assert.equal(readFileSync(join(root, 'docs/PACKAGES.md'), 'utf8'), before);
  });

  it('--release turns the Unreleased row into the current version row', () => {
    const root = fixture({ rows: [['Unreleased', RANGE, '2026-11-19'], ['0.1.0-next.0', '>=0.1.0-next.37 <=0.1.0-next.37', '2026-11-10']] });
    writeTable(root, 'release', '2026-12-02');
    assert.deepEqual(checkPlatformCompat(root).problems, []);
    const rows = parseTable(readFileSync(join(root, 'docs/PACKAGES.md'), 'utf8'));
    assert.deepEqual(rows.map((r) => r.version), ['0.1.0-next.1', '0.1.0-next.0']);
    assert.equal(rows[0].date, '2026-12-02');
  });

  it('--use pins every workspace platform dependency, never a peer', () => {
    const root = fixture();
    usePlatformVersion(root, '0.1.0-next.37');
    const web = JSON.parse(readFileSync(join(root, 'packages/vault-web/package.json'), 'utf8'));
    const api = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8'));
    assert.equal(web.devDependencies['@marinoscar/platform-web'], '0.1.0-next.37');
    assert.equal(web.peerDependencies['@marinoscar/platform-web'], RANGE);
    assert.equal(api.dependencies['@marinoscar/platform-api'], '0.1.0-next.37');
  });

  it('orders pre-releases numerically', () => {
    assert.equal(compareVersions('0.1.0-next.9', '0.1.0-next.10'), -1);
    assert.equal(compareVersions('0.1.0', '0.1.0-next.10'), 1);
    assert.equal(compareVersions('0.1.0-next.39', '0.1.0-next.39'), 0);
  });
});
