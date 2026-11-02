import { test, describe, beforeAll as before, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';

import {
  BACKUP_FILENAME_TOKENS,
  DEFAULT_BACKUP_TEMPLATE,
  expandBackupFilename,
  sanitizeTokenValue,
  templateTokens,
  templateUsesUser,
  withCollisionSuffix,
} from '../lib/backup-filename.js';

// Pin the local time zone so "local" tokens are deterministic. UTC-8/-7 (Los
// Angeles) is far enough from UTC that a local/UTC mix-up changes the day.
const ORIGINAL_TZ = process.env.TZ;
before(() => {
  process.env.TZ = 'America/Los_Angeles';
});
after(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

// 2026-03-09 04:05:06 UTC. In Los Angeles (PDT, UTC-7) that is 2026-03-08 21:05:06.
const INSTANT = new Date(Date.UTC(2026, 2, 9, 4, 5, 6));
const UTC = { utc: true } as const;

describe('time zone pin', () => {
  test('local time really differs from UTC for the test instant', () => {
    assert.equal(INSTANT.getDate(), 8);
    assert.equal(INSTANT.getUTCDate(), 9);
  });
});

describe('expandBackupFilename tokens (UTC)', () => {
  const cases: Array<[string, string]> = [
    ['{date}', '2026-03-09'],
    ['{time}', '040506'],
    ['{datetime}', '2026-03-09_040506'],
    ['{timestamp}', String(Math.floor(INSTANT.getTime() / 1000))],
    ['{year}', '2026'],
    ['{month}', '03'],
    ['{day}', '09'],
    ['{hour}', '04'],
    ['{minute}', '05'],
    ['{second}', '06'],
  ];
  for (const [template, expected] of cases) {
    test(`${template} -> ${expected}`, () => {
      assert.equal(expandBackupFilename(template, INSTANT, UTC), expected);
    });
  }

  test('the default template expands to a .zip name', () => {
    assert.equal(
      expandBackupFilename(DEFAULT_BACKUP_TEMPLATE, INSTANT, UTC),
      'vault-backup-2026-03-09_040506.zip',
    );
  });

  test('timestamp is unix seconds (not ms) and independent of --utc', () => {
    const a = expandBackupFilename('{timestamp}', INSTANT, UTC);
    const b = expandBackupFilename('{timestamp}', INSTANT);
    assert.equal(a, b);
    assert.match(a, /^\d{10}$/);
  });

  test('truncates (floors) milliseconds in the timestamp', () => {
    const d = new Date(1_700_000_000_999);
    assert.equal(expandBackupFilename('{timestamp}', d), '1700000000');
  });

  test('zero pads single digits and keeps two-digit values', () => {
    const d = new Date(Date.UTC(2026, 10, 12, 13, 14, 15));
    assert.equal(expandBackupFilename('{month}{day}{hour}{minute}{second}', d, UTC), '1112131415');
    const e = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    assert.equal(expandBackupFilename('{month}{day}{hour}{minute}{second}', e, UTC), '0101000000');
  });

  test('pads the year to four digits', () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    d.setUTCFullYear(5);
    assert.equal(expandBackupFilename('{year}', d, UTC), '0005');
  });

  test('a token may repeat and combine with literal text', () => {
    assert.equal(
      expandBackupFilename('v-{year}{year}-{day}.zip', INSTANT, UTC),
      'v-20262026-09.zip',
    );
  });
});

describe('expandBackupFilename local vs --utc', () => {
  test('local tokens use the process time zone', () => {
    assert.equal(expandBackupFilename('{date}_{time}', INSTANT), '2026-03-08_210506');
    assert.equal(expandBackupFilename('{hour}', INSTANT), '21');
    assert.equal(expandBackupFilename('{day}', INSTANT), '08');
  });

  test('--utc uses UTC', () => {
    assert.equal(expandBackupFilename('{date}_{time}', INSTANT, UTC), '2026-03-09_040506');
  });

  test('utc: false behaves as local', () => {
    assert.equal(expandBackupFilename('{day}', INSTANT, { utc: false }), '08');
  });

  test('local date built from local components round-trips', () => {
    const d = new Date(2026, 11, 31, 23, 59, 58);
    assert.equal(expandBackupFilename('{datetime}', d), '2026-12-31_235958');
  });
});

describe('expandBackupFilename host and user', () => {
  test('sanitizes {host}', () => {
    assert.equal(
      expandBackupFilename('{host}.zip', INSTANT, { host: 'My Laptop: (work)' }),
      'My-Laptop-work.zip',
    );
  });

  test('{user} is the sanitized local part of the email', () => {
    assert.equal(
      expandBackupFilename('{user}.zip', INSTANT, { user: 'Person.A+tag@example.test' }),
      'Person.A-tag.zip',
    );
  });

  test('{user} accepts a bare name without @', () => {
    assert.equal(expandBackupFilename('{user}', INSTANT, { user: 'person_a' }), 'person_a');
  });

  test('empty or hostile values become "unknown" or safe text', () => {
    assert.equal(expandBackupFilename('{host}', INSTANT, { host: '' }), 'unknown');
    assert.equal(expandBackupFilename('{user}', INSTANT, { user: '@example.test' }), 'unknown');
    assert.equal(
      expandBackupFilename('{host}', INSTANT, { host: '../../etc' }),
      'etc',
    );
    assert.equal(
      expandBackupFilename('{host}', INSTANT, { host: 'a/b\\c' }),
      'a-b-c',
    );
  });

  test('errors when {host} or {user} is used without a value', () => {
    assert.throws(() => expandBackupFilename('{host}', INSTANT), /\{host\}/);
    assert.throws(() => expandBackupFilename('{user}', INSTANT), /\{user\}/);
  });

  test('a sanitized value can never contain a path separator or colon', () => {
    const out = expandBackupFilename('{host}', INSTANT, { host: 'a:b/c\\d*e?f"g<h>i|j' });
    assert.doesNotMatch(out, /[:/\\*?"<>|]/);
  });
});

describe('expandBackupFilename never emits a colon from tokens', () => {
  test('all time tokens together contain no ":"', () => {
    const template = BACKUP_FILENAME_TOKENS.filter((t) => t !== 'host' && t !== 'user')
      .map((t) => `{${t}}`)
      .join('_');
    const out = expandBackupFilename(template, INSTANT, UTC);
    assert.equal(out.includes(':'), false);
    const local = expandBackupFilename(template, INSTANT);
    assert.equal(local.includes(':'), false);
  });
});

describe('expandBackupFilename errors', () => {
  test('unknown token lists the valid tokens', () => {
    assert.throws(
      () => expandBackupFilename('x-{nope}.zip', INSTANT, UTC),
      (err: Error) => {
        assert.match(err.message, /Unknown token/);
        assert.match(err.message, /\{nope\}/);
        for (const t of BACKUP_FILENAME_TOKENS) {
          assert.ok(err.message.includes(`{${t}}`), `message should list {${t}}`);
        }
        return true;
      },
    );
  });

  test('reports each unknown token once', () => {
    assert.throws(
      () => expandBackupFilename('{a}{a}{b}', INSTANT, UTC),
      (err: Error) => {
        const unknownPart = err.message.split('Valid tokens')[0];
        assert.equal((unknownPart.match(/\{a\}/g) ?? []).length, 1);
        assert.ok(unknownPart.includes('{b}'));
        return true;
      },
    );
  });

  test('tokens are case sensitive', () => {
    assert.throws(() => expandBackupFilename('{Date}', INSTANT, UTC), /Unknown token/);
  });

  test('an empty token is unknown', () => {
    assert.throws(() => expandBackupFilename('{}', INSTANT, UTC), /Unknown token/);
  });

  test('rejects an empty or blank template', () => {
    assert.throws(() => expandBackupFilename('', INSTANT, UTC), /must not be empty/);
    assert.throws(() => expandBackupFilename('   ', INSTANT, UTC), /must not be empty/);
  });

  test('text without tokens is returned unchanged', () => {
    assert.equal(expandBackupFilename('plain.zip', INSTANT, UTC), 'plain.zip');
  });
});

describe('expandBackupFilename ~ expansion', () => {
  const homeDir = '/home/person-a';

  test('expands a leading ~/', () => {
    assert.equal(
      expandBackupFilename('~/backups/{year}/vault-{datetime}.zip', INSTANT, { ...UTC, homeDir }),
      '/home/person-a/backups/2026/vault-2026-03-09_040506.zip',
    );
  });

  test('expands a bare ~ and ~\\ (Windows style)', () => {
    assert.equal(expandBackupFilename('~', INSTANT, { homeDir }), '/home/person-a');
    assert.equal(
      expandBackupFilename('~\\backups\\x.zip', INSTANT, { homeDir: 'C:\\Users\\person-a' }),
      'C:\\Users\\person-a\\backups\\x.zip',
    );
  });

  test('does not expand ~user, a mid-path ~, or without a homeDir', () => {
    assert.equal(expandBackupFilename('~other/x.zip', INSTANT, { homeDir }), '~other/x.zip');
    assert.equal(expandBackupFilename('a/~/x.zip', INSTANT, { homeDir }), 'a/~/x.zip');
    assert.equal(expandBackupFilename('~/x.zip', INSTANT), '~/x.zip');
  });

  test('keeps directories in the template', () => {
    assert.equal(
      expandBackupFilename('out/{year}/{month}/v.zip', INSTANT, UTC),
      'out/2026/03/v.zip',
    );
  });
});

describe('templateTokens / templateUsesUser', () => {
  test('lists tokens in order, valid or not', () => {
    assert.deepEqual(templateTokens('{a}-{date}-{b}'), ['a', 'date', 'b']);
    assert.deepEqual(templateTokens('none'), []);
  });

  test('templateUsesUser detects {user}', () => {
    assert.equal(templateUsesUser('vault-{user}-{date}.zip'), true);
    assert.equal(templateUsesUser('vault-{date}.zip'), false);
    assert.equal(templateUsesUser('vault-user.zip'), false);
    assert.equal(templateUsesUser('{username}'), false);
  });
});

describe('sanitizeTokenValue', () => {
  test('keeps safe characters', () => {
    assert.equal(sanitizeTokenValue('abc.DEF_123-x'), 'abc.DEF_123-x');
  });

  test('replaces runs of unsafe characters with one dash and trims edges', () => {
    assert.equal(sanitizeTokenValue('  a  b  '), 'a-b');
    assert.equal(sanitizeTokenValue('--a--'), 'a');
    assert.equal(sanitizeTokenValue('...a...'), 'a');
  });

  test('falls back to "unknown"', () => {
    assert.equal(sanitizeTokenValue(''), 'unknown');
    assert.equal(sanitizeTokenValue('***'), 'unknown');
    assert.equal(sanitizeTokenValue('...'), 'unknown');
  });
});

describe('withCollisionSuffix', () => {
  test('attempt 0 (or negative) returns the path unchanged', () => {
    assert.equal(withCollisionSuffix('x.zip', 0), 'x.zip');
    assert.equal(withCollisionSuffix('x.zip', -1), 'x.zip');
  });

  test('x.zip -> x-1.zip -> x-2.zip', () => {
    assert.equal(withCollisionSuffix('x.zip', 1), 'x-1.zip');
    assert.equal(withCollisionSuffix('x.zip', 2), 'x-2.zip');
  });

  test('only the last extension is moved', () => {
    assert.equal(withCollisionSuffix('x.tar.zip', 1), 'x.tar-1.zip');
  });

  test('a name without an extension gets the suffix at the end', () => {
    assert.equal(withCollisionSuffix('backup', 1), 'backup-1');
  });

  test('a leading-dot name is not treated as an extension', () => {
    assert.equal(withCollisionSuffix('.zip', 1), '.zip-1');
    assert.equal(withCollisionSuffix('dir/.zip', 2), 'dir/.zip-2');
    assert.equal(withCollisionSuffix('.hidden.zip', 1), '.hidden-1.zip');
  });

  test('a dot in a directory name is not an extension', () => {
    assert.equal(withCollisionSuffix('a.b/c', 1), 'a.b/c-1');
    assert.equal(withCollisionSuffix('a.b/c.zip', 1), 'a.b/c-1.zip');
    assert.equal(withCollisionSuffix('/home/p.a/backups/c', 3), '/home/p.a/backups/c-3');
  });

  test('handles Windows separators', () => {
    assert.equal(withCollisionSuffix('a.b\\c', 1), 'a.b\\c-1');
    assert.equal(withCollisionSuffix('C:\\a.b\\c.zip', 2), 'C:\\a.b\\c-2.zip');
  });

  test('a trailing dot counts as an extension separator', () => {
    assert.equal(withCollisionSuffix('x.', 1), 'x-1.');
  });
});
