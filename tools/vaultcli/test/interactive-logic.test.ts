import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScheduleInstructions,
  describePasswordSetting,
  describeRetention,
  parseRetentionInput,
  parseTimeOfDay,
  previewTemplate,
  scheduleWarnings,
  tokenHelp,
  type ScheduleInput,
} from '../src/interactive/logic.js';
import { BACKUP_FILENAME_TOKENS } from '../src/lib/backup-filename.js';
import { DEFAULT_PASSWORD_ENV } from '../src/lib/backup-settings.js';

const NOW = new Date(Date.UTC(2026, 2, 9, 4, 5, 6));
const PV = { utc: true, host: 'My Box', homeDir: '/home/me' };

describe('previewTemplate', () => {
  test('expands tokens and ~', () => {
    const r = previewTemplate('~/bk/{host}-{datetime}.zip', NOW, PV);
    assert.deepEqual(r, { ok: true, path: '/home/me/bk/My-Box-2026-03-09_040506.zip' });
  });
  test('{user} uses the email local part, or a placeholder', () => {
    assert.deepEqual(previewTemplate('{user}.zip', NOW, { ...PV, userEmail: 'jane@example.test' }), { ok: true, path: 'jane.zip' });
    assert.deepEqual(previewTemplate('{user}.zip', NOW, PV), { ok: true, path: 'your-name.zip' });
  });
  test('errors come back as a value, not a throw', () => {
    const r = previewTemplate('{bogus}.zip', NOW, PV);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /Unknown token/);
    assert.equal(previewTemplate('', NOW, PV).ok, false);
  });
});

test('tokenHelp lists every token', () => {
  const h = tokenHelp();
  for (const t of BACKUP_FILENAME_TOKENS) assert.ok(h.includes(`{${t}}`), t);
});

describe('parseRetentionInput', () => {
  test('blank and 0 mean off', () => {
    for (const s of ['', '   ', '0', ' 0 ']) assert.deepEqual(parseRetentionInput(s), { ok: true, value: undefined });
  });
  test('positive integers', () => {
    assert.deepEqual(parseRetentionInput('30'), { ok: true, value: 30 });
    assert.deepEqual(parseRetentionInput(' 1 '), { ok: true, value: 1 });
  });
  test('rejects negatives, decimals, junk, unsafe numbers', () => {
    for (const s of ['-1', '1.5', 'abc', '1e2', '99999999999999999999']) assert.equal(parseRetentionInput(s).ok, false, s);
  });
});

describe('parseTimeOfDay', () => {
  test('valid', () => {
    assert.deepEqual(parseTimeOfDay('02:30'), { hour: 2, minute: 30 });
    assert.deepEqual(parseTimeOfDay(' 9:05 '), { hour: 9, minute: 5 });
    assert.deepEqual(parseTimeOfDay('00:00'), { hour: 0, minute: 0 });
    assert.deepEqual(parseTimeOfDay('23:59'), { hour: 23, minute: 59 });
  });
  test('invalid', () => {
    for (const s of ['24:00', '12:60', '1230', '12:5', 'ab:cd', '', '12:30:00', '-1:00']) assert.equal(parseTimeOfDay(s), null, s);
  });
});

describe('describe helpers', () => {
  test('describePasswordSetting', () => {
    assert.equal(describePasswordSetting({ passwordFile: '/p', passwordEnv: 'E' }, {}), 'password file /p');
    assert.equal(describePasswordSetting({ passwordEnv: 'E' }, { E: 'x' }), 'environment variable E');
    assert.equal(describePasswordSetting({ passwordEnv: 'E' }, {}), 'environment variable E (not set right now)');
    assert.equal(describePasswordSetting({}, { [DEFAULT_PASSWORD_ENV]: 'x' }), `environment variable ${DEFAULT_PASSWORD_ENV}`);
    assert.equal(describePasswordSetting({}, {}), 'ask every time');
  });
  test('describeRetention', () => {
    assert.equal(describeRetention({}), 'off (nothing is deleted)');
    assert.equal(describeRetention({ keepDays: 30 }), 'delete after 30 day(s)');
    assert.equal(describeRetention({ keepLast: 5 }), 'keep the newest 5');
    assert.equal(describeRetention({ keepDays: 30, keepLast: 5 }), 'delete after 30 day(s), keep the newest 5');
  });
});

describe('scheduleWarnings', () => {
  const w = (saved: ScheduleInput['saved'], defaultEnvSet = false) => scheduleWarnings({ saved, defaultEnvSet, platform: 'linux' });
  test('fully configured: no warnings', () => {
    assert.deepEqual(w({ passwordFile: '/p', keepDays: 30, output: '/abs/{date}.zip' }), []);
    assert.deepEqual(w({ passwordFile: '/p', keepLast: 3, output: '~/x.zip' }), []);
    assert.deepEqual(w({ passwordFile: '/p', keepDays: 1, output: 'C:\\b\\x.zip' }), []);
  });
  test('no password source, with and without default env', () => {
    const a = w({ keepDays: 1 });
    assert.equal(a.length, 1);
    assert.match(a[0], /cannot ask for a password/);
    const b = w({ keepDays: 1 }, true);
    assert.match(b[0], new RegExp(DEFAULT_PASSWORD_ENV));
  });
  test('env-only password source warns', () => {
    const a = w({ passwordEnv: 'MY_PW', keepDays: 1 });
    assert.equal(a.length, 1);
    assert.match(a[0], /\$MY_PW/);
  });
  test('retention off and relative output warn', () => {
    const a = w({ passwordFile: '/p', output: 'rel/{date}.zip' });
    assert.equal(a.length, 2);
    assert.ok(a.some((x) => /Retention is off/.test(x)));
    assert.ok(a.some((x) => /relative/.test(x)));
  });
});

describe('buildScheduleInstructions', () => {
  const base: ScheduleInput = {
    platform: 'linux',
    nodePath: '/usr/bin/node',
    cliPath: '/opt/vaultcli/bin/vaultcli.js',
    hour: 2,
    minute: 5,
    env: {},
    logPath: '/home/me/.config/vaultcli/backup.log',
    homeDir: '/home/me',
    saved: { passwordFile: '/p', keepDays: 30 },
    defaultEnvSet: false,
  };

  test('linux: crontab line format', () => {
    const r = buildScheduleInstructions(base);
    assert.equal(r.kind, 'cron');
    assert.equal(
      r.content,
      `5 2 * * * '/usr/bin/node' '/opt/vaultcli/bin/vaultcli.js' backup --json >> '/home/me/.config/vaultcli/backup.log' 2>&1`,
    );
    assert.equal(r.filePath, undefined);
    assert.match(r.title, /02:05/);
    assert.deepEqual(r.warnings, []);
    assert.ok(r.steps.length >= 3);
  });

  test('linux: env vars prefixed, quotes and % escaped', () => {
    const r = buildScheduleInstructions({
      ...base,
      cliPath: "/o'p/100%/v.js",
      env: { VAULTCLI_CONFIG_DIR: '/cfg dir', VAULTCLI_SERVER_URL: 'https://vault.example.test' },
    });
    assert.ok(r.content.startsWith(`5 2 * * * VAULTCLI_CONFIG_DIR='/cfg dir' VAULTCLI_SERVER_URL='https://vault.example.test' '/usr/bin/node' `));
    assert.ok(r.content.includes(`'/o'\\''p/100\\%/v.js'`));
    assert.ok(!/[^\\]%/.test(r.content));
  });

  test('unknown platforms fall back to cron', () => {
    assert.equal(buildScheduleInstructions({ ...base, platform: 'freebsd' }).kind, 'cron');
  });

  test('darwin: plist path and content', () => {
    const r = buildScheduleInstructions({ ...base, platform: 'darwin', env: { VAULTCLI_CONFIG_DIR: '/cfg&dir' } });
    assert.equal(r.kind, 'launchd');
    assert.equal(r.filePath, '/home/me/Library/LaunchAgents/local.vaultcli.backup.plist');
    assert.ok(r.content.includes('<string>/usr/bin/node</string>'));
    assert.ok(r.content.includes('<string>/opt/vaultcli/bin/vaultcli.js</string>'));
    assert.ok(r.content.includes('<string>backup</string>'));
    assert.ok(r.content.includes('<string>--json</string>'));
    assert.ok(r.content.includes('<key>Hour</key><integer>2</integer>'));
    assert.ok(r.content.includes('<key>Minute</key><integer>5</integer>'));
    assert.ok(r.content.includes('<key>VAULTCLI_CONFIG_DIR</key><string>/cfg&amp;dir</string>'));
    assert.ok(r.content.includes('<key>StandardOutPath</key><string>/home/me/.config/vaultcli/backup.log</string>'));
    assert.ok(r.steps.some((s) => s.includes('launchctl bootstrap')));
    assert.ok(r.steps.some((s) => s.includes(r.filePath!)));
  });

  test('darwin: no EnvironmentVariables block without env', () => {
    const r = buildScheduleInstructions({ ...base, platform: 'darwin' });
    assert.ok(!r.content.includes('EnvironmentVariables'));
  });

  test('win32: schtasks command', () => {
    const r = buildScheduleInstructions({
      ...base,
      platform: 'win32',
      hour: 3,
      minute: 0,
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      cliPath: 'C:\\v\\vaultcli.js',
      logPath: 'C:\\v\\backup.log',
      env: { VAULTCLI_SERVER_URL: 'https://vault.example.test' },
    });
    assert.equal(r.kind, 'schtasks');
    assert.ok(r.content.startsWith('schtasks /Create /TN "vaultcli backup" /SC DAILY /ST 03:00 /TR "'));
    assert.ok(r.content.includes('set \\"VAULTCLI_SERVER_URL=https://vault.example.test\\" && '));
    assert.ok(r.content.includes('\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\v\\vaultcli.js\\" backup --json'));
    assert.ok(r.content.includes('2>&1'));
    assert.ok(r.steps.some((s) => s.includes('/Delete')));
  });

  test('pads single-digit times and carries warnings', () => {
    const r = buildScheduleInstructions({ ...base, saved: {}, hour: 0, minute: 7, platform: 'win32' });
    assert.ok(r.content.includes('/ST 00:07'));
    assert.ok(r.warnings.length >= 2);
  });

  test('never includes a password', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const r = buildScheduleInstructions({ ...base, platform, saved: { passwordFile: '/p', passwordEnv: 'E' } });
      assert.ok(!/--password\b/.test(r.content));
    }
  });
});
