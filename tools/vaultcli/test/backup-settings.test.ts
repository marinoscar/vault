import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_PASSWORD_ENV,
  assertValidTemplate,
  choosePasswordSource,
  getBackupSettingsPath,
  loadBackupSettings,
  normalizeSettingKey,
  parsePositiveInt,
  resetBackupSettings,
  resolveBackupSettings,
  saveBackupSettings,
  unsetBackupSettings,
  validateBackupSettings,
  writePasswordFile,
} from '../src/lib/backup-settings.js';
import { DEFAULT_BACKUP_TEMPLATE } from '../src/lib/backup-filename.js';

describe('resolveBackupSettings', () => {
  test('defaults when nothing is given; retention off and unset', () => {
    const { settings, sources } = resolveBackupSettings({}, {});
    assert.equal(settings.output, DEFAULT_BACKUP_TEMPLATE);
    assert.equal(settings.includeAttachments, true);
    assert.equal(settings.includeVersions, false);
    assert.equal(settings.utc, false);
    assert.equal(settings.keepDays, undefined);
    assert.equal(settings.keepLast, undefined);
    assert.equal(sources.output, 'default');
    assert.equal(sources.utc, 'default');
    assert.equal(sources.keepDays, 'unset');
    assert.equal(sources.passwordEnv, 'unset');
  });

  test('saved beats default, flag beats saved', () => {
    const { settings, sources } = resolveBackupSettings(
      { output: 'flag.zip', keepDays: 5 },
      { output: 'saved.zip', keepDays: 9, keepLast: 3, utc: true },
    );
    assert.equal(settings.output, 'flag.zip');
    assert.equal(sources.output, 'flag');
    assert.equal(settings.keepDays, 5);
    assert.equal(settings.keepLast, 3);
    assert.equal(sources.keepLast, 'saved');
    assert.equal(settings.utc, true);
    assert.equal(sources.utc, 'saved');
  });

  test('explicit false flag overrides a saved true', () => {
    const { settings, sources } = resolveBackupSettings({ includeAttachments: false }, { includeAttachments: true });
    assert.equal(settings.includeAttachments, false);
    assert.equal(sources.includeAttachments, 'flag');
  });

  test('a password flag ignores saved password sources entirely', () => {
    const r = resolveBackupSettings({ passwordEnv: 'MY_ENV' }, { passwordFile: '/p', passwordEnv: 'SAVED' });
    assert.equal(r.settings.passwordEnv, 'MY_ENV');
    assert.equal(r.settings.passwordFile, undefined);
    assert.equal(r.sources.passwordFile, 'unset');
    const s = resolveBackupSettings({}, { passwordFile: '/p' });
    assert.equal(s.settings.passwordFile, '/p');
    assert.equal(s.sources.passwordFile, 'saved');
  });

  test('custom defaults are honoured and inputs are not mutated', () => {
    const saved = { keepLast: 2 };
    const r = resolveBackupSettings({}, saved, { output: 'd.zip', keepDays: 7 });
    assert.equal(r.settings.output, 'd.zip');
    assert.equal(r.settings.keepDays, 7);
    assert.equal(r.sources.keepDays, 'default');
    assert.deepEqual(saved, { keepLast: 2 });
    assert.equal(Object.isFrozen(DEFAULT_BACKUP_SETTINGS), true);
  });
});

describe('choosePasswordSource', () => {
  const env = { [DEFAULT_PASSWORD_ENV]: 'x' };
  test('order: password > password-file > password-env > saved file > saved env > default env > prompt', () => {
    assert.deepEqual(
      choosePasswordSource({ password: 'p', passwordFile: 'f', passwordEnv: 'e' }, { passwordFile: 's' }, env),
      { kind: 'literal', value: 'p', from: 'flag' },
    );
    assert.deepEqual(choosePasswordSource({ passwordFile: 'f', passwordEnv: 'e' }, { passwordFile: 's' }, env), {
      kind: 'file', path: 'f', from: 'flag',
    });
    assert.deepEqual(choosePasswordSource({ passwordEnv: 'e' }, { passwordFile: 's' }, env), {
      kind: 'env', name: 'e', from: 'flag',
    });
    assert.deepEqual(choosePasswordSource({}, { passwordFile: 's', passwordEnv: 'se' }, env), {
      kind: 'file', path: 's', from: 'saved',
    });
    assert.deepEqual(choosePasswordSource({}, { passwordEnv: 'se' }, env), { kind: 'env', name: 'se', from: 'saved' });
    assert.deepEqual(choosePasswordSource({}, {}, env), { kind: 'env', name: DEFAULT_PASSWORD_ENV, from: 'default' });
    assert.deepEqual(choosePasswordSource({}, {}, {}), { kind: 'prompt' });
    assert.deepEqual(choosePasswordSource({}, {}, { [DEFAULT_PASSWORD_ENV]: '' }), { kind: 'prompt' });
  });

  test('an empty literal password flag still counts as given', () => {
    assert.equal(choosePasswordSource({ password: '' }, {}, {}).kind, 'literal');
  });
});

describe('parsePositiveInt', () => {
  test('accepts positive integers (string or number, trimmed)', () => {
    assert.equal(parsePositiveInt('7', 'x'), 7);
    assert.equal(parsePositiveInt(' 30 ', 'x'), 30);
    assert.equal(parsePositiveInt(1, 'x'), 1);
  });
  test('rejects 0, negative, non-integer, junk, empty', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1e3', '+2', 0, -3, 2.5, NaN])
      assert.throws(() => parsePositiveInt(bad as string | number, 'keep-days'), /keep-days/, String(bad));
  });
  test('rejects unsafe integers', () => {
    assert.throws(() => parsePositiveInt('99999999999999999999', 'n'), /at least 1/);
  });
});

describe('validateBackupSettings', () => {
  test('accepts a full valid object', () => {
    const v = validateBackupSettings({
      output: '~/b/{date}.zip', passwordEnv: 'E', passwordFile: '/p',
      includeAttachments: false, includeVersions: true, utc: true, keepDays: 30, keepLast: '5',
    });
    assert.equal(v.keepLast, 5);
    assert.equal(v.utc, true);
  });
  test('drops unknown keys including password; ignores null/undefined', () => {
    const v = validateBackupSettings({ password: 'secret', foo: 1, keepDays: null, utc: undefined, output: 'a.zip' });
    assert.deepEqual(v, { output: 'a.zip' });
  });
  test('rejects non-objects', () => {
    for (const bad of [null, [], 'x', 3, undefined]) assert.throws(() => validateBackupSettings(bad), /JSON object/);
  });
  test('rejects bad values', () => {
    assert.throws(() => validateBackupSettings({ keepDays: 0 }));
    assert.throws(() => validateBackupSettings({ keepDays: -1 }));
    assert.throws(() => validateBackupSettings({ keepLast: 1.5 }));
    assert.throws(() => validateBackupSettings({ keepLast: true }), /whole number/);
    assert.throws(() => validateBackupSettings({ utc: 'yes' }), /true or false/);
    assert.throws(() => validateBackupSettings({ passwordEnv: '  ' }), /non-empty/);
    assert.throws(() => validateBackupSettings({ output: 5 }), /non-empty string/);
    assert.throws(() => validateBackupSettings({ output: 'a-{bogus}.zip' }), /Unknown token/);
  });
});

describe('normalizeSettingKey', () => {
  test('camel, kebab, snake, case-insensitive', () => {
    assert.equal(normalizeSettingKey('keepDays'), 'keepDays');
    assert.equal(normalizeSettingKey('keep-days'), 'keepDays');
    assert.equal(normalizeSettingKey('keep_last'), 'keepLast');
    assert.equal(normalizeSettingKey('password-env'), 'passwordEnv');
    assert.equal(normalizeSettingKey('PASSWORD-FILE'), 'passwordFile');
    assert.equal(normalizeSettingKey('include-attachments'), 'includeAttachments');
    assert.equal(normalizeSettingKey(' utc '), 'utc');
    assert.equal(normalizeSettingKey('output'), 'output');
  });
  test('unknown keys (including password) return null', () => {
    assert.equal(normalizeSettingKey('password'), null);
    assert.equal(normalizeSettingKey(''), null);
    assert.equal(normalizeSettingKey('keep-everything'), null);
  });
});

describe('unsetBackupSettings', () => {
  test('removes only the named keys and does not mutate', () => {
    const saved = { output: 'a.zip', keepDays: 3, keepLast: 2 };
    const r = unsetBackupSettings(saved, ['keepDays', 'utc']);
    assert.deepEqual(r, { output: 'a.zip', keepLast: 2 });
    assert.deepEqual(saved, { output: 'a.zip', keepDays: 3, keepLast: 2 });
    assert.deepEqual(unsetBackupSettings(saved, []), saved);
  });
});

describe('assertValidTemplate', () => {
  test('accepts valid, rejects empty/blank/unknown', () => {
    assert.doesNotThrow(() => assertValidTemplate('b/{year}/{month}/{host}-{datetime}.zip'));
    assert.doesNotThrow(() => assertValidTemplate('plain.zip'));
    assert.throws(() => assertValidTemplate(''), /empty/);
    assert.throws(() => assertValidTemplate('   '), /empty/);
    assert.throws(() => assertValidTemplate('{a}{b}{a}'), /\{a\}, \{b\}/);
  });
});

describe('settings file layer', () => {
  let dir: string;
  let prev: string | undefined;
  before(() => {
    prev = process.env.VAULTCLI_CONFIG_DIR;
  });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vaultcli-cfg-'));
    process.env.VAULTCLI_CONFIG_DIR = dir;
  });
  after(() => {
    if (prev === undefined) delete process.env.VAULTCLI_CONFIG_DIR;
    else process.env.VAULTCLI_CONFIG_DIR = prev;
  });

  test('path honours VAULTCLI_CONFIG_DIR; load returns {} when missing', () => {
    assert.equal(getBackupSettingsPath(), join(dir, 'backup.json'));
    assert.deepEqual(loadBackupSettings(), {});
    rmSync(dir, { recursive: true, force: true });
  });

  test('save then load round-trips', () => {
    saveBackupSettings({ output: '~/b/{date}.zip', keepDays: 14, utc: false });
    assert.deepEqual(loadBackupSettings(), { output: '~/b/{date}.zip', utc: false, keepDays: 14 });
    rmSync(dir, { recursive: true, force: true });
  });

  test('file mode is 0600 (also when overwriting a looser file)', { skip: process.platform === 'win32' }, () => {
    const file = saveBackupSettings({ keepLast: 3 });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    writeFileSync(file, '{}', { mode: 0o644 });
    saveBackupSettings({ keepLast: 4 });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  test('never persists a password field and drops unknown keys, in stable key order', () => {
    const file = saveBackupSettings({
      keepLast: 2, output: 'a.zip', password: 'hunter2', extra: 1,
    } as unknown as Parameters<typeof saveBackupSettings>[0]);
    const text = readFileSync(file, 'utf-8');
    assert.ok(!text.includes('hunter2'));
    assert.ok(!text.includes('password"'));
    assert.deepEqual(Object.keys(JSON.parse(text)), ['output', 'keepLast']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a hand-edited file with a password is loaded without it', () => {
    writeFileSync(join(dir, 'backup.json'), JSON.stringify({ password: 'x', keepDays: 3 }));
    assert.deepEqual(loadBackupSettings(), { keepDays: 3 });
    rmSync(dir, { recursive: true, force: true });
  });

  test('invalid JSON or values throw with the file path', () => {
    const file = join(dir, 'backup.json');
    writeFileSync(file, '{nope');
    assert.throws(() => loadBackupSettings(), (e: Error) => e.message.includes(file) && /Cannot read/.test(e.message));
    writeFileSync(file, JSON.stringify({ keepDays: 0 }));
    assert.throws(() => loadBackupSettings(), (e: Error) => e.message.includes(file) && /Invalid backup settings/.test(e.message));
    rmSync(dir, { recursive: true, force: true });
  });

  test('save rejects invalid settings without writing', () => {
    assert.throws(() => saveBackupSettings({ keepDays: 0 }));
    assert.equal(existsSync(join(dir, 'backup.json')), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('reset removes the file and reports whether it existed', () => {
    assert.equal(resetBackupSettings(), false);
    saveBackupSettings({ utc: true });
    assert.equal(resetBackupSettings(), true);
    assert.equal(existsSync(join(dir, 'backup.json')), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('writePasswordFile writes password + newline with mode 0600', { skip: process.platform === 'win32' }, () => {
    const p = join(dir, 'sub', 'pw');
    writePasswordFile(p, 'correct horse');
    assert.equal(readFileSync(p, 'utf-8'), 'correct horse\n');
    assert.equal(statSync(p).mode & 0o777, 0o600);
    rmSync(dir, { recursive: true, force: true });
  });
});
