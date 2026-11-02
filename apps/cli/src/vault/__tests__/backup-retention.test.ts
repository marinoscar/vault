import { test, describe, beforeAll as before, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, utimesSync, existsSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  templateToMatcher,
  planRetention,
  retentionEnabled,
  listBackupCandidates,
  applyRetention,
  formatAge,
} from '../lib/backup-retention.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const CWD = '/work';
const opts = { cwd: CWD, homeDir: '/home/me', separator: '/' };
const m = (tpl: string, extra = {}) => templateToMatcher(tpl, { ...opts, ...extra });

describe('templateToMatcher: token patterns', () => {
  const cases: Array<[string, string, string[], string[]]> = [
    ['date', '/b/x-{date}.zip', ['/b/x-2026-03-09.zip'], ['/b/x-2026-3-9.zip', '/b/x-20260309.zip']],
    ['time', '/b/x-{time}.zip', ['/b/x-040506.zip'], ['/b/x-04050.zip', '/b/x-04:05:06.zip']],
    ['datetime', '/b/x-{datetime}.zip', ['/b/x-2026-03-09_040506.zip'], ['/b/x-2026-03-09-040506.zip']],
    ['timestamp', '/b/x-{timestamp}.zip', ['/b/x-1773029106.zip'], ['/b/x-abc.zip', '/b/x-.zip']],
    ['year', '/b/{year}.zip', ['/b/2026.zip'], ['/b/26.zip']],
    ['month', '/b/m{month}.zip', ['/b/m03.zip'], ['/b/m3.zip']],
    ['day', '/b/d{day}.zip', ['/b/d09.zip'], ['/b/d9.zip']],
    ['hour', '/b/h{hour}.zip', ['/b/h23.zip'], ['/b/h2.zip']],
    ['minute', '/b/n{minute}.zip', ['/b/n59.zip'], ['/b/n5.zip']],
    ['second', '/b/s{second}.zip', ['/b/s00.zip'], ['/b/s0.zip']],
    ['host', '/b/{host}.zip', ['/b/my-host_1.local.zip'], ['/b/my host.zip']],
    ['user', '/b/{user}.zip', ['/b/jane.doe.zip'], ['/b/jane@x.zip']],
  ];
  for (const [name, tpl, good, bad] of cases) {
    test(`{${name}}`, () => {
      const mt = m(tpl);
      for (const g of good) assert.equal(mt.matches(g), true, g);
      for (const b of bad) assert.equal(mt.matches(b), false, b);
    });
  }

  test('literal parts are regex-escaped', () => {
    const mt = m('/b/a+b(1).{date}.zip');
    assert.equal(mt.matches('/b/a+b(1).2026-01-01.zip'), true);
    assert.equal(mt.matches('/b/aab(1).2026-01-01.zip'), false);
    assert.equal(m('/b/v.zip').matches('/b/vXzip'), false);
  });

  test('optional -N collision suffix before the extension', () => {
    const mt = m('/b/v-{date}.zip');
    assert.equal(mt.matches('/b/v-2026-01-01-2.zip'), true);
    assert.equal(mt.matches('/b/v-2026-01-01-12.zip'), true);
    assert.equal(mt.matches('/b/v-2026-01-01-x.zip'), false);
    assert.equal(mt.matches('/b/v-2026-01-01.zip.bak'), false);
  });

  test('template without extension takes suffix at the end', () => {
    const mt = m('/b/v-{date}');
    assert.equal(mt.matches('/b/v-2026-01-01'), true);
    assert.equal(mt.matches('/b/v-2026-01-01-3'), true);
  });

  test('rejects .partial and other extensions', () => {
    const mt = m('/b/v-{date}.zip');
    assert.equal(mt.matches('/b/v-2026-01-01.zip.partial'), false);
    assert.equal(mt.matches('/b/v-2026-01-01.tar'), false);
    assert.equal(mt.matches('/b/v-2026-01-01.ZIP'), false);
  });

  test('badly formed dates are rejected', () => {
    const mt = m('/b/v-{date}.zip');
    for (const n of ['v-2026-1-01.zip', 'v-26-01-01.zip', 'v-2026-01-01x.zip', 'v-.zip', 'xv-2026-01-01.zip'])
      assert.equal(mt.matches('/b/' + n), false, n);
  });

  test('{host} / {user} match the exact sanitized value when given', () => {
    const mt = m('/b/{host}-{user}.zip', { host: 'My Host!', user: 'Jane@corp.test' });
    assert.equal(mt.matches('/b/My-Host-Jane.zip'), true);
    assert.equal(mt.matches('/b/other-Jane.zip'), false);
    assert.equal(mt.matches('/b/My-Host-Bob.zip'), false);
  });
});

describe('templateToMatcher: root and depth', () => {
  test('flat file: root is the directory, depth 1', () => {
    const mt = m('/data/backups/v-{date}.zip');
    assert.equal(mt.root, '/data/backups');
    assert.equal(mt.depth, 1);
  });

  test('nested {year}/{month} dirs', () => {
    const mt = m('/data/{year}/{month}/v-{date}.zip');
    assert.equal(mt.root, '/data');
    assert.equal(mt.depth, 3);
    assert.equal(mt.matches('/data/2026/03/v-2026-03-09.zip'), true);
    assert.equal(mt.matches('/data/2026/3/v-2026-03-09.zip'), false);
    assert.equal(mt.matches('/data/2026/v-2026-03-09.zip'), false);
    assert.equal(mt.matches('/data/2026/03/04/v-2026-03-09.zip'), false);
    assert.equal(mt.matches('/other/2026/03/v-2026-03-09.zip'), false);
  });

  test('token-free directories above the first token stay in root', () => {
    const mt = m('/a/b/{host}/c/v.zip');
    assert.equal(mt.root, '/a/b');
    assert.equal(mt.depth, 3);
  });

  test('literal template (no tokens): root is parent, depth 1', () => {
    const mt = m('/a/b/v.zip');
    assert.equal(mt.root, '/a/b');
    assert.equal(mt.depth, 1);
    assert.equal(mt.matches('/a/b/v.zip'), true);
    assert.equal(mt.matches('/a/b/v-2.zip'), true);
  });

  test('root-level file uses the separator as root', () => {
    assert.equal(m('/v-{date}.zip').root, '/');
  });

  test('~ expands to homeDir and relative templates resolve against cwd', () => {
    assert.equal(m('~/bk/v-{date}.zip').root, '/home/me/bk');
    assert.equal(m('bk/v-{date}.zip').root, '/work/bk');
    assert.equal(m('./v-{date}.zip').root, '/work');
  });

  test('non-matching directory is rejected', () => {
    assert.equal(m('/data/bk/v-{date}.zip').matches('/data/other/v-2026-01-01.zip'), false);
  });

  test('invalid templates throw', () => {
    assert.throws(() => m('/b/{nope}.zip'), /Unknown token/);
    assert.throws(() => m(''), /empty/);
    // A trailing slash is normalized away by path.resolve, so it is treated as a file named "dir"
    // (the "must end with a file name" guard is unreachable); only regular files named dir match.
    assert.equal(m('/b/dir/').depth, 1);
  });
});

describe('planRetention', () => {
  const f = (name: string, ageDays: number) => ({ path: `/b/${name}`, mtimeMs: NOW - ageDays * DAY });
  const names = (xs: Array<{ path: string }>) => xs.map((x) => x.path.slice(3));

  test('empty input', () => {
    const p = planRetention([], { keepDays: 1, keepLast: 1, now: NOW });
    assert.deepEqual(p, { delete: [], keep: [] });
  });

  test('disabled when neither limit is set (or both are < 1)', () => {
    const files = [f('a', 1), f('b', 400)];
    assert.equal(planRetention(files, { now: NOW }).delete.length, 0);
    assert.equal(planRetention(files, { keepDays: 0, keepLast: 0, now: NOW }).delete.length, 0);
    assert.equal(retentionEnabled({}), false);
    assert.equal(retentionEnabled({ keepDays: 0, keepLast: 0 }), false);
    assert.equal(retentionEnabled({ keepDays: 1 }), true);
    assert.equal(retentionEnabled({ keepLast: 3 }), true);
  });

  test('keepDays only', () => {
    const p = planRetention([f('new', 1), f('mid', 10), f('old', 40), f('older', 90)], { keepDays: 30, now: NOW });
    assert.deepEqual(names(p.delete), ['old', 'older']);
    assert.deepEqual(names(p.keep), ['new', 'mid']);
    assert.ok(p.delete.every((d) => d.reasons.length === 1 && d.reasons[0] === 'age'));
  });

  test('keepLast only', () => {
    const p = planRetention([f('a', 1), f('b', 2), f('c', 3), f('d', 4)], { keepLast: 2, now: NOW });
    assert.deepEqual(names(p.keep), ['a', 'b']);
    assert.deepEqual(names(p.delete), ['c', 'd']);
    assert.ok(p.delete.every((d) => d.reasons.length === 1 && d.reasons[0] === 'count'));
  });

  test('combined: deleted when older OR outside newest N, reasons list both', () => {
    const files = [f('a', 1), f('b', 2), f('c', 3), f('d', 50)];
    const p = planRetention(files, { keepDays: 30, keepLast: 3, now: NOW });
    assert.deepEqual(names(p.keep), ['a', 'b', 'c']);
    assert.deepEqual(names(p.delete), ['d']);
    assert.deepEqual(p.delete[0].reasons, ['age', 'count']);

    const q = planRetention(files, { keepDays: 2.5, keepLast: 10, now: NOW });
    assert.deepEqual(names(q.delete), ['c', 'd']);
    assert.deepEqual(q.delete[0].reasons, ['age']);
  });

  test('boundary: exactly N days old is kept, 1ms older is deleted', () => {
    const edge = { path: '/b/edge', mtimeMs: NOW - 30 * DAY };
    const over = { path: '/b/over', mtimeMs: NOW - 30 * DAY - 1 };
    const newest = f('newest', 0);
    const p = planRetention([newest, edge, over], { keepDays: 30, now: NOW });
    assert.deepEqual(names(p.keep), ['newest', 'edge']);
    assert.deepEqual(names(p.delete), ['over']);
  });

  test('keepLast boundary: exactly N kept', () => {
    const p = planRetention([f('a', 1), f('b', 2), f('c', 3)], { keepLast: 3, now: NOW });
    assert.equal(p.delete.length, 0);
  });

  test('the newest file is always kept even if older than keepDays', () => {
    const p = planRetention([f('x', 100), f('y', 200)], { keepDays: 1, now: NOW });
    assert.deepEqual(names(p.keep), ['x']);
    assert.deepEqual(names(p.delete), ['y']);
  });

  test('single file is never deleted', () => {
    assert.equal(planRetention([f('x', 999)], { keepDays: 1, keepLast: 1, now: NOW }).delete.length, 0);
  });

  test('protect list is respected (also with unnormalized paths)', () => {
    const p = planRetention([f('a', 1), f('b', 60), f('c', 90)], {
      keepDays: 30,
      now: NOW,
      protect: ['/b/x/../c'],
    });
    assert.deepEqual(names(p.delete), ['b']);
    assert.ok(names(p.keep).includes('c'));
  });

  test('protected file still counts toward keepLast ordering', () => {
    const p = planRetention([f('a', 1), f('b', 2), f('c', 3)], { keepLast: 1, now: NOW, protect: ['/b/c'] });
    assert.deepEqual(names(p.delete), ['b']);
  });

  test('ties on mtime are ordered deterministically and input is not mutated', () => {
    const files = [{ path: '/b/a', mtimeMs: NOW }, { path: '/b/b', mtimeMs: NOW }];
    const copy = JSON.stringify(files);
    const p1 = planRetention(files, { keepLast: 1, now: NOW });
    const p2 = planRetention([...files].reverse(), { keepLast: 1, now: NOW });
    assert.deepEqual(p1.delete.map((d) => d.path), p2.delete.map((d) => d.path));
    assert.equal(JSON.stringify(files), copy);
  });

  test('extra properties on files are preserved', () => {
    const p = planRetention([{ path: '/b/a', mtimeMs: NOW, size: 5 }, { path: '/b/b', mtimeMs: NOW - 99 * DAY, size: 7 }], {
      keepDays: 1,
      now: NOW,
    });
    assert.equal(p.delete[0].size, 7);
  });
});

describe('formatAge', () => {
  test('formats', () => {
    assert.equal(formatAge(-5), '0m');
    assert.equal(formatAge(5 * 60000), '5m');
    assert.equal(formatAge(5 * 3600000), '5h');
    assert.equal(formatAge(3 * DAY), '3d');
    assert.equal(formatAge(3 * DAY + 4 * 3600000), '3d 4h');
  });
});

describe('listBackupCandidates / applyRetention (real filesystem)', () => {
  let dir: string;
  const touch = (p: string, ageDays: number) => {
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, 'x');
    const t = new Date(Date.now() - ageDays * DAY);
    utimesSync(p, t, t);
  };

  before(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'vaultcli-ret-')));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('flat directory: deletes only matching regular files', () => {
    const d = join(dir, 'flat');
    const keep = ['notes.txt', 'vault-backup-2026-01-01.zip.partial', 'vault-backup-2026-01-01.tar', 'other-2026-01-01.zip'];
    touch(join(d, 'vault-backup-2026-01-03.zip'), 1);
    touch(join(d, 'vault-backup-2026-01-02.zip'), 40);
    touch(join(d, 'vault-backup-2026-01-01.zip'), 50);
    touch(join(d, 'vault-backup-2026-01-01-2.zip'), 60);
    for (const k of keep) touch(join(d, k), 500);
    // a directory that looks like a backup, and a symlink to a matching target
    mkdirSync(join(d, 'vault-backup-2026-02-02.zip'));
    touch(join(dir, 'elsewhere', 'precious.zip'), 500);
    symlinkSync(join(dir, 'elsewhere', 'precious.zip'), join(d, 'vault-backup-2026-03-03.zip'));

    const mt = templateToMatcher(join(d, 'vault-backup-{date}.zip'));
    const found = listBackupCandidates(mt);
    assert.equal(found.length, 4);
    assert.ok(found.every((x) => x.size === 1));

    const plan = planRetention(found, { keepDays: 30, now: Date.now() });
    assert.equal(plan.delete.length, 3);
    const res = applyRetention(plan, mt);
    assert.equal(res.deleted.length, 3);
    assert.equal(res.errors.length, 0);
    assert.equal(res.kept, 1);

    assert.equal(existsSync(join(d, 'vault-backup-2026-01-03.zip')), true);
    assert.equal(existsSync(join(d, 'vault-backup-2026-01-02.zip')), false);
    assert.equal(existsSync(join(d, 'vault-backup-2026-01-01-2.zip')), false);
    for (const k of keep) assert.equal(existsSync(join(d, k)), true, k);
    assert.equal(existsSync(join(d, 'vault-backup-2026-02-02.zip')), true);
    assert.equal(existsSync(join(dir, 'elsewhere', 'precious.zip')), true);
  });

  test('symlink matching the template is not listed and not deleted', () => {
    const d = join(dir, 'sym');
    touch(join(d, 'b-2026-01-02.zip'), 1);
    touch(join(dir, 'target.zip'), 400);
    symlinkSync(join(dir, 'target.zip'), join(d, 'b-2026-01-01.zip'));
    const mt = templateToMatcher(join(d, 'b-{date}.zip'));
    assert.deepEqual(listBackupCandidates(mt).map((x) => x.path), [join(d, 'b-2026-01-02.zip')]);
  });

  test('applyRetention re-checks a planned symlink and skips it', () => {
    const d = join(dir, 'sym2');
    touch(join(dir, 'target2.zip'), 1);
    mkdirSync(d, { recursive: true });
    const link = join(d, 'b-2026-01-01.zip');
    symlinkSync(join(dir, 'target2.zip'), link);
    const mt = templateToMatcher(join(d, 'b-{date}.zip'));
    const res = applyRetention({ keep: [], delete: [{ path: link, mtimeMs: 0, reasons: ['age'] }] }, mt);
    assert.equal(res.deleted.length, 0);
    assert.equal(res.errors.length, 1);
    assert.equal(existsSync(join(dir, 'target2.zip')), true);
  });

  test('applyRetention refuses a non-matching path and reports a missing file', () => {
    const d = join(dir, 'guard');
    touch(join(d, 'unrelated.txt'), 1);
    const mt = templateToMatcher(join(d, 'b-{date}.zip'));
    const res = applyRetention(
      {
        keep: [],
        delete: [
          { path: join(d, 'unrelated.txt'), mtimeMs: 0, reasons: ['age'] },
          { path: join(d, 'b-2026-01-01.zip'), mtimeMs: 0, reasons: ['age'] },
        ],
      },
      mt,
    );
    assert.equal(res.deleted.length, 0);
    assert.equal(res.errors.length, 2);
    assert.equal(existsSync(join(d, 'unrelated.txt')), true);
  });

  test('dry run (plan only) deletes nothing', () => {
    const d = join(dir, 'dry');
    touch(join(d, 'b-2026-01-02.zip'), 1);
    touch(join(d, 'b-2026-01-01.zip'), 90);
    const mt = templateToMatcher(join(d, 'b-{date}.zip'));
    const plan = planRetention(listBackupCandidates(mt), { keepDays: 30, now: Date.now() });
    assert.equal(plan.delete.length, 1);
    assert.equal(existsSync(join(d, 'b-2026-01-01.zip')), true);
  });

  test('nested year/month directories, depth-limited', () => {
    const d = join(dir, 'nested');
    touch(join(d, '2026', '01', 'v-2026-01-01.zip'), 90);
    touch(join(d, '2026', '02', 'v-2026-02-01.zip'), 1);
    touch(join(d, '2026', 'v-2026-01-01.zip'), 90); // too shallow
    touch(join(d, '2026', '01', 'deeper', 'v-2026-01-01.zip'), 90); // too deep
    touch(join(d, 'abc', '01', 'v-2026-01-01.zip'), 90); // dir not a year
    const mt = templateToMatcher(join(d, '{year}', '{month}', 'v-{date}.zip'));
    assert.equal(mt.root, d);
    const found = listBackupCandidates(mt).map((x) => x.path).sort();
    assert.deepEqual(found, [join(d, '2026', '01', 'v-2026-01-01.zip'), join(d, '2026', '02', 'v-2026-02-01.zip')]);
  });

  test('missing root yields an empty list', () => {
    assert.deepEqual(listBackupCandidates(templateToMatcher(join(dir, 'nope', 'b-{date}.zip'))), []);
  });
});
