// Tests of the clean-install smoke test's pure helpers (#192). Run: npm run test:package-scripts
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  collectPeers,
  hasRequireCondition,
  isCodeSubpath,
  isInside,
  parseArgs,
  registryVerdict,
  specifier,
  subpaths,
  typeSmokeSource,
} from '../smoke-install.mjs';

const contract = {
  name: '@marinoscar/vault-contract',
  type: 'module',
  exports: {
    '.': { import: { default: './dist/esm/index.js' }, require: { default: './dist/cjs/index.js' } },
    './agent': { import: { default: './dist/esm/agent/index.js' }, require: { default: './dist/cjs/agent/index.js' } },
    './package.json': './package.json',
  },
  peerDependencies: { zod: '^4.4.3' },
};
const api = {
  name: '@marinoscar/vault-api',
  type: 'commonjs',
  exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' }, './package.json': './package.json' },
  peerDependencies: { '@marinoscar/vault-contract': '>=0.0.0-0', zod: '^4.4.3', '@nestjs/common': '^11.1.12' },
};
const web = {
  name: '@marinoscar/vault-web',
  type: 'module',
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './brand/assets/vault-mark.png': './dist/brand/assets/vault-mark.png',
    './package.json': './package.json',
  },
  peerDependencies: { react: '^19.2.7', '@marinoscar/vault-contract': '>=0.0.0-0' },
  peerDependenciesMeta: { react: { optional: false } },
};

describe('parseArgs', () => {
  it('reads each mode', () => {
    assert.equal(parseArgs(['--pack']).mode, 'pack');
    assert.deepEqual(parseArgs(['--tarballs', 'out']), { mode: 'tarballs', tarballs: 'out', tag: 'next', work: null, keep: false });
    assert.equal(parseArgs(['--registry', '--tag', 'canary']).tag, 'canary');
  });

  it('refuses no mode, two modes, a missing value and an unknown flag', () => {
    assert.throws(() => parseArgs([]), /choose one/);
    assert.throws(() => parseArgs(['--pack', '--registry']), /choose one/);
    assert.throws(() => parseArgs(['--tarballs']), /needs a value/);
    assert.throws(() => parseArgs(['--pack', '--frobnicate']), /unknown argument/);
  });
});

describe('subpaths and conditions', () => {
  it('lists subpaths without ./package.json and builds specifiers', () => {
    assert.deepEqual(subpaths(contract), ['.', './agent']);
    assert.equal(specifier(contract.name, '.'), '@marinoscar/vault-contract');
    assert.equal(specifier(contract.name, './agent'), '@marinoscar/vault-contract/agent');
  });

  it('tells code from assets', () => {
    assert.equal(isCodeSubpath(web, '.'), true);
    assert.equal(isCodeSubpath(web, './brand/assets/vault-mark.png'), false);
  });

  it('knows which subpaths can be required', () => {
    assert.equal(hasRequireCondition(contract, './agent'), true);
    assert.equal(hasRequireCondition(api, '.'), true); // CommonJS package, plain default
    assert.equal(hasRequireCondition(web, '.'), false); // ESM-only package
  });
});

describe('collectPeers', () => {
  it('merges peers, drops the packages under test and optional peers', () => {
    const { peers, conflicts } = collectPeers([contract, api, web, { name: 'x', peerDependencies: { opt: '1' }, peerDependenciesMeta: { opt: { optional: true } } }]);
    assert.deepEqual(conflicts, []);
    assert.deepEqual(peers, { '@nestjs/common': '^11.1.12', react: '^19.2.7', zod: '^4.4.3' });
  });

  it('reports two ranges for one peer', () => {
    const other = { name: '@marinoscar/vault-db', peerDependencies: { zod: '^3.0.0' } };
    assert.equal(collectPeers([contract, other]).conflicts.length, 1);
  });
});

describe('typeSmokeSource', () => {
  it('imports every code subpath with an exports assertion', () => {
    const { source, count } = typeSmokeSource([contract, web]);
    assert.equal(count, 3);
    assert.match(source, /import \* as m1 from '@marinoscar\/vault-contract\/agent';/);
    assert.match(source, /m2HasExports: \[keyof typeof m2\] extends \[never\]/);
    assert.ok(!source.includes('vault-mark.png'));
  });

  it('keeps only requirable subpaths for a CommonJS consumer', () => {
    const { source, count } = typeSmokeSource([contract, web], { cjsOnly: true });
    assert.equal(count, 2);
    assert.ok(!source.includes('@marinoscar/vault-web'));
  });
});

describe('registryVerdict', () => {
  it('skips when nothing is published', () => {
    assert.deepEqual(registryVerdict(2, [], ['a@next', 'b@next']), { missing: ['a@next', 'b@next'] });
  });

  it('fails a half-published release', () => {
    assert.throws(() => registryVerdict(2, [contract], ['b@next']), /only 1 of 2/);
  });

  it('tests a complete release', () => {
    assert.deepEqual(registryVerdict(1, [contract], []), { manifests: [contract] });
  });
});

describe('isInside', () => {
  it('detects a folder inside the workspace', () => {
    assert.equal(isInside('/repo/packages/x', '/repo'), true);
    assert.equal(isInside('/repo', '/repo'), true);
    assert.equal(isInside(join(tmpdir(), 'vault-smoke-1'), '/repo'), false);
    assert.equal(isInside('/repo-other', '/repo'), false);
  });
});
