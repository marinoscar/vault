// Tests of the pre-publish tarball rules (#192). Run: npm run test:package-scripts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkTarball } from '../check-package-pack.mjs';
import {
  checkAllowList,
  checkContents,
  checkPackageContents,
  checkPromised,
  findRealLookingPans,
  looksLikePan,
  luhnValid,
  promisedFiles,
} from '../tarball-rules.mjs';

const contractManifest = {
  name: '@marinoscar/vault-contract',
  main: './dist/cjs/index.js',
  types: './dist/cjs/index.d.ts',
  files: ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  exports: {
    '.': {
      import: { types: './dist/esm/index.d.ts', default: './dist/esm/index.js' },
      require: { types: './dist/cjs/index.d.ts', default: './dist/cjs/index.js' },
    },
    './agent': {
      import: { types: './dist/esm/agent/index.d.ts', default: './dist/esm/agent/index.js' },
      require: { types: './dist/cjs/agent/index.d.ts', default: './dist/cjs/agent/index.js' },
    },
    './package.json': './package.json',
  },
};

const contractFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/cjs/agent/index.d.ts',
  'dist/cjs/agent/index.js',
  'dist/cjs/index.d.ts',
  'dist/cjs/index.js',
  'dist/cjs/package.json',
  'dist/esm/agent/index.d.ts',
  'dist/esm/agent/index.js',
  'dist/esm/index.d.ts',
  'dist/esm/index.js',
  'dist/esm/package.json',
  'package.json',
];

const contractText = {
  'dist/cjs/package.json': '{"type":"commonjs"}\n',
  'dist/esm/package.json': '{"type":"module"}\n',
};
const readContract = (file) => contractText[file] ?? 'export {};\n';

describe('promisedFiles and checkPromised', () => {
  it('walks every condition of every subpath', () => {
    const files = promisedFiles(contractManifest);
    for (const f of ['dist/esm/agent/index.js', 'dist/esm/agent/index.d.ts', 'dist/cjs/agent/index.js', 'dist/cjs/agent/index.d.ts', 'package.json']) {
      assert.ok(files.includes(f), f);
    }
  });

  it('passes a complete tarball', () => {
    assert.deepEqual(checkPromised(contractManifest, contractFiles), []);
  });

  it('fails when a require target is missing', () => {
    const files = contractFiles.filter((f) => f !== 'dist/cjs/agent/index.js');
    const problems = checkPromised(contractManifest, files);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /dist\/cjs\/agent\/index\.js/);
  });

  it('fails when a types target is missing', () => {
    const files = contractFiles.filter((f) => f !== 'dist/esm/agent/index.d.ts');
    assert.match(checkPromised(contractManifest, files).join('\n'), /dist\/esm\/agent\/index\.d\.ts/);
  });

  it('accepts a wildcard pattern only when it matches a packed file', () => {
    const manifest = { exports: { './*': './dist/*.js' } };
    assert.deepEqual(checkPromised(manifest, ['dist/a.js']), []);
    assert.match(checkPromised(manifest, ['README.md'])[0], /matches no file/);
  });
});

describe('checkAllowList', () => {
  it('passes the contract tarball', () => {
    assert.deepEqual(checkAllowList('vault-contract', contractManifest, contractFiles), []);
  });

  for (const stray of [
    'dist/cjs/index.js.map',
    'dist/__tests__/a.test.js',
    'dist/fixtures/card.json',
    'dist/.env',
    'src/index.ts',
    'dist/cjs/index.spec.js',
    'notes.txt',
    'dist/brand/photo.png',
  ]) {
    it(`fails on the stray file ${stray}`, () => {
      const problems = checkAllowList('vault-contract', contractManifest, [...contractFiles, stray]);
      assert.equal(problems.length, 1, problems.join('\n'));
      assert.ok(problems[0].includes(stray));
    });
  }

  it('fails when the contract loses a dist stub', () => {
    const problems = checkAllowList('vault-contract', contractManifest, contractFiles.filter((f) => f !== 'dist/esm/package.json'));
    assert.match(problems.join('\n'), /dist\/esm\/package\.json/);
  });

  it('allows a media file an exports entry publishes (the vault-web brand mark)', () => {
    const manifest = { exports: { './brand/assets/vault-mark.png': './dist/brand/assets/vault-mark.png' } };
    assert.deepEqual(checkAllowList('vault-web', manifest, ['package.json', 'README.md', 'dist/brand/assets/vault-mark.png']), []);
  });

  it('allows a published testing subpath (fakes are part of the API)', () => {
    assert.deepEqual(checkAllowList('vault-api', {}, ['dist/testing/index.js', 'dist/testing/index.d.ts']), []);
  });

  describe('vault-db', () => {
    const dbFiles = [
      'package.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
      'bin/vault-db.js',
      'dist/index.js',
      'dist/index.d.ts',
      'schema/vault.secrets.prisma',
      'migrations/manifest.json',
      'migrations/20260101000000_add_things/migration.sql',
      'raw-sql-indexes.json',
      'extensions.json',
      'schema-objects.json',
    ];

    it('passes a complete tarball', () => {
      assert.deepEqual(checkAllowList('vault-db', {}, dbFiles), []);
    });

    for (const missing of ['bin/vault-db.js', 'migrations/manifest.json', 'raw-sql-indexes.json', 'extensions.json', 'schema-objects.json']) {
      it(`fails without ${missing}`, () => {
        assert.match(checkAllowList('vault-db', {}, dbFiles.filter((f) => f !== missing)).join('\n'), new RegExp(missing.replace(/\./g, '\\.')));
      });
    }

    it('fails without any schema fragment', () => {
      assert.match(checkAllowList('vault-db', {}, dbFiles.filter((f) => !f.startsWith('schema/'))).join('\n'), /schema\/\*\.prisma/);
    });

    it('checks every listed migration is packed, and no unlisted one', () => {
      const manifest = JSON.stringify({ migrations: [{ id: '20260101000000_add_things' }, { id: '20260202000000_more' }] });
      const read = (f) => (f === 'migrations/manifest.json' ? manifest : '');
      const problems = checkPackageContents('vault-db', [...dbFiles, 'migrations/20260303000000_extra/migration.sql'], read);
      assert.equal(problems.length, 2, problems.join('\n'));
      assert.match(problems[0], /20260202000000_more/);
      assert.match(problems[1], /20260303000000_extra/);
    });
  });
});

describe('checkPackageContents (contract stubs)', () => {
  it('passes correct stubs', () => {
    assert.deepEqual(checkPackageContents('vault-contract', contractFiles, readContract), []);
  });

  it('fails a stub with the wrong type', () => {
    const read = (f) => (f === 'dist/cjs/package.json' ? '{"type":"module"}' : readContract(f));
    assert.match(checkPackageContents('vault-contract', contractFiles, read).join('\n'), /dist\/cjs\/package\.json.*commonjs/);
  });
});

describe('card number scan', () => {
  it('implements Luhn', () => {
    assert.equal(luhnValid('4111111111111111'), true);
    assert.equal(luhnValid('4111111111111112'), false);
    assert.equal(luhnValid('79927398713'), true);
  });

  it('recognises brand prefixes and lengths', () => {
    assert.equal(looksLikePan('4111111111111111'), true);
    assert.equal(looksLikePan('378282246310005'), true);
    assert.equal(looksLikePan('20260403120000'), false); // a migration timestamp
    assert.equal(looksLikePan('1234567890123456'), false);
  });

  it('allows published test numbers in any grouping', () => {
    assert.deepEqual(findRealLookingPans('pan: "4111 1111 1111 1111", amex 3782-822463-10005, 4242424242424242'), []);
  });

  it('flags a Luhn-valid number that is not a test number', () => {
    // Built for this test: Visa prefix, Luhn-valid, on no test list.
    assert.equal(luhnValid('4539578763621486'), true);
    assert.deepEqual(findRealLookingPans('{"number":"4539 5787 6362 1486"}'), ['4539578763621486']);
  });

  it('ignores digits glued to hashes, ids and Luhn-invalid numbers', () => {
    assert.deepEqual(findRealLookingPans('sha256 "0edf4539578763621486abc" id 45395787636214861 4539578763621487'), []);
  });
});

describe('checkContents', () => {
  it('flags a leaked absolute checkout path', () => {
    const problems = checkContents(['dist/index.js'], () => 'require("/work/checkout/packages/x/src/a")', { forbiddenPaths: ['/work/checkout'] });
    assert.match(problems[0], /absolute path '\/work\/checkout'/);
  });

  it('flags a source map with absolute sources', () => {
    const map = JSON.stringify({ version: 3, sources: ['/home/someone/repo/src/a.ts'] });
    assert.match(checkContents(['dist/a.js.map'], () => map).join('\n'), /absolute source/);
  });

  it('masks a flagged card number in the message', () => {
    const problems = checkContents(['dist/fixture.json'], () => '4539578763621486');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /453957\*{6}1486/);
    assert.ok(!problems[0].includes('4539578763621486'));
  });

  it('skips binary files', () => {
    assert.deepEqual(checkContents(['dist/brand/assets/vault-mark.png'], () => '4539578763621486'), []);
  });
});

describe('checkTarball', () => {
  it('passes a complete contract tarball', () => {
    assert.deepEqual(checkTarball(contractManifest, contractFiles, { dir: 'vault-contract', read: readContract, forbiddenPaths: ['/work/checkout'] }), []);
  });

  it('fails on a missing exports target and a stray file together', () => {
    const files = [...contractFiles.filter((f) => f !== 'dist/esm/agent/index.js'), 'dist/esm/agent/index.js.map'];
    const problems = checkTarball(contractManifest, files, { dir: 'vault-contract', read: readContract });
    assert.ok(problems.some((p) => p.includes("missing 'dist/esm/agent/index.js'")), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('index.js.map')), problems.join('\n'));
  });

  it('fails on a file no files entry names', () => {
    const problems = checkTarball(contractManifest, [...contractFiles, 'scripts/x.js'], { dir: 'vault-contract' });
    assert.ok(problems.some((p) => p.includes("no 'files' entry names")));
  });
});
