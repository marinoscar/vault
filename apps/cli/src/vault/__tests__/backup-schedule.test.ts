import { describe, expect, it } from 'vitest';

import {
  BLOCK_BEGIN,
  BLOCK_END,
  applyInstall,
  applyRemove,
  buildCronCommand,
  buildCronLine,
  cronPath,
  cronQuote,
  findBlock,
  getScheduleStatus,
  hasBlockingIssue,
  installSchedule,
  parseInstalled,
  presetFromFlags,
  presetToCron,
  readCrontab,
  removeSchedule,
  renderBlock,
  resolveCliEntry,
  schedulePreflight,
  supportsCrontab,
  type CrontabRunner,
  type PreflightInput,
} from '../lib/backup-schedule.js';

const OTHER = ['# my own jobs', 'MAILTO=""', '*/5 * * * * /usr/local/bin/example-sync --quiet', '0 4 * * 0 /opt/tool/cleanup.sh'].join('\n') + '\n';
const INSTALLED_AT = new Date('2026-03-10T08:00:00.000Z');
const COMMAND = "HOME='/home/person-a' '/usr/bin/node' '/opt/vault/dist/cli.js' backup --json --scheduled >> '/home/person-a/.vault/backup.log' 2>&1";

/** An in-memory crontab behind the `crontab` runner interface. */
function fakeCrontab(initial: string | null): { run: CrontabRunner; text: () => string | null; calls: string[][] } {
  let current = initial;
  const calls: string[][] = [];
  const run: CrontabRunner = async (args, input) => {
    calls.push(args);
    if (args[0] === '-l') {
      return current === null ? { code: 1, stdout: '', stderr: 'no crontab for person-a\n' } : { code: 0, stdout: current, stderr: '' };
    }
    if (args[0] === '-') {
      current = input ?? '';
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, text: () => current, calls };
}

describe('presets', () => {
  it('turns presets into cron expressions', () => {
    expect(presetToCron({ kind: 'daily', hour: 2, minute: 30 })).toBe('30 2 * * *');
    expect(presetToCron({ kind: 'hourly', every: 1 })).toBe('0 * * * *');
    expect(presetToCron({ kind: 'hourly', every: 6 })).toBe('0 */6 * * *');
    expect(presetToCron({ kind: 'weekly', day: 0, hour: 3, minute: 5 })).toBe('5 3 * * 0');
    expect(presetToCron({ kind: 'cron', expression: '15  1 * * 1-5' })).toBe('15 1 * * 1-5');
  });

  it('rejects out-of-range presets', () => {
    expect(() => presetToCron({ kind: 'daily', hour: 24, minute: 0 })).toThrow(/Hour/);
    expect(() => presetToCron({ kind: 'hourly', every: 24 })).toThrow(/Every N hours/);
    expect(() => presetToCron({ kind: 'cron', expression: '* * *' })).toThrow(/5 fields/);
  });

  it('reads exactly one schedule flag', () => {
    expect(presetFromFlags({ daily: '02:30' })).toEqual({ kind: 'daily', hour: 2, minute: 30 });
    expect(presetFromFlags({ everyHours: '6' })).toEqual({ kind: 'hourly', every: 6 });
    expect(presetFromFlags({ weekly: 'sun' })).toEqual({ kind: 'weekly', day: 0, hour: 2, minute: 30 });
    expect(presetFromFlags({ weekly: 'friday', at: '23:15' })).toEqual({ kind: 'weekly', day: 5, hour: 23, minute: 15 });
    expect(presetFromFlags({ cron: '0 1 * * *' })).toEqual({ kind: 'cron', expression: '0 1 * * *' });
  });

  it('explains bad flag combinations', () => {
    expect(() => presetFromFlags({})).toThrow(/Choose when to run/);
    expect(() => presetFromFlags({ daily: '02:30', everyHours: '6' })).toThrow(/only one/);
    expect(() => presetFromFlags({ daily: '25:00' })).toThrow(/HH:MM/);
    expect(() => presetFromFlags({ everyHours: 'x' })).toThrow(/1 to 23/);
    expect(() => presetFromFlags({ daily: '02:30', at: '03:00' })).toThrow(/--at goes with --weekly/);
    expect(() => presetFromFlags({ cron: '61 * * * *' })).toThrow(/Invalid --cron/);
  });
});

describe('the cron command line', () => {
  it('quotes for sh and escapes % for cron', () => {
    expect(cronQuote('/a b/c')).toBe("'/a b/c'");
    expect(cronQuote("it's")).toBe(`'it'\\''s'`);
    expect(cronQuote('/backups/100%')).toBe("'/backups/100\\%'");
  });

  it('puts node first on PATH, without duplicates', () => {
    expect(cronPath('/opt/node/bin/node')).toBe('/opt/node/bin:/usr/local/bin:/usr/bin:/bin');
    expect(cronPath('/usr/bin/node')).toBe('/usr/bin:/usr/local/bin:/bin');
  });

  it('runs node and the CLI by absolute path with HOME, PATH and the config dir, appending to the log', () => {
    const cmd = buildCronCommand({
      nodePath: '/opt/node/bin/node',
      cliPath: '/opt/vault/apps/cli/dist/cli.js',
      homeDir: '/home/person-a',
      logPath: '/home/person-a/.vault/backup.log',
      env: { VAULT_CONFIG_DIR: '/srv/vault-state', VAULT_SERVER_URL: 'https://vault.example.test' },
    });
    expect(cmd).toBe(
      "HOME='/home/person-a' PATH='/opt/node/bin:/usr/local/bin:/usr/bin:/bin' VAULT_CONFIG_DIR='/srv/vault-state' " +
        "VAULT_SERVER_URL='https://vault.example.test' '/opt/node/bin/node' '/opt/vault/apps/cli/dist/cli.js' " +
        "backup --json --scheduled >> '/home/person-a/.vault/backup.log' 2>&1",
    );
  });

  it('never copies a token or a password variable into the crontab', () => {
    const cmd = buildCronCommand({
      nodePath: '/usr/bin/node',
      cliPath: '/opt/vault/dist/cli.js',
      homeDir: '/home/person-a',
      logPath: '/home/person-a/.vault/backup.log',
      env: { VAULT_TOKEN: 'pat_secret-value', VAULT_BACKUP_PASSWORD: 'hunter22', VAULTCLI_BACKUP_PASSWORD: 'hunter22' },
    });
    expect(cmd).not.toMatch(/TOKEN|PASSWORD|pat_secret|hunter22/);
  });

  it('builds the full line from the expression and the command', () => {
    expect(buildCronLine('30  2 * * *', 'cmd')).toBe('30 2 * * * cmd');
  });

  it('resolves the CLI entry to dist/cli.js of the package, else the running script', () => {
    const deps = (existing: string[]) => ({
      exists: (p: string) => existing.includes(p),
      realpath: (p: string) => p,
      moduleDir: '/repo/apps/cli/dist/vault/lib',
    });
    expect(resolveCliEntry('/usr/local/bin/vault', deps(['/repo/apps/cli/dist/cli.js']))).toBe('/repo/apps/cli/dist/cli.js');
    expect(resolveCliEntry('/opt/other/cli.js', deps(['/opt/other/cli.js']))).toBe('/opt/other/cli.js');
    expect(() => resolveCliEntry('/repo/apps/cli/src/cli.ts', deps([]))).toThrow(/Build it first/);
  });
});

describe('the managed crontab block', () => {
  const block = renderBlock('30 2 * * *', COMMAND, INSTALLED_AT);

  it('renders markers, a description and the job', () => {
    expect(block[0]).toBe(BLOCK_BEGIN);
    expect(block[1]).toBe('# Every day at 02:30 · installed 2026-03-10T08:00:00.000Z');
    expect(block[2]).toBe(`30 2 * * * ${COMMAND}`);
    expect(block[3]).toBe(BLOCK_END);
  });

  it('appends to an empty crontab, ending with a newline', () => {
    const out = applyInstall('', block);
    expect(out).toBe(block.join('\n') + '\n');
  });

  it('appends after other lines, keeping every one of them', () => {
    const out = applyInstall(OTHER, block);
    expect(out.startsWith(OTHER)).toBe(true);
    expect(out.endsWith(`${BLOCK_END}\n`)).toBe(true);
    expect(out).toContain(`\n\n${BLOCK_BEGIN}`);
  });

  it('adds the final newline a crontab without one lacks', () => {
    const out = applyInstall('0 4 * * 0 /opt/tool/cleanup.sh', block);
    expect(out.startsWith('0 4 * * 0 /opt/tool/cleanup.sh\n\n')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('is idempotent and replaces only the block, in place', () => {
    const once = applyInstall(OTHER + '\n# after\n', block);
    expect(applyInstall(once, block)).toBe(once);
    const changed = applyInstall(once, renderBlock('0 */6 * * *', COMMAND, INSTALLED_AT));
    expect(changed).toContain('0 */6 * * *');
    expect(changed).not.toContain('30 2 * * *');
    expect(changed.split(BLOCK_BEGIN)).toHaveLength(2);
    for (const line of OTHER.trim().split('\n')) expect(changed).toContain(line);
  });

  it('keeps lines after the block where they were', () => {
    const text = `${OTHER}${block.join('\n')}\n# trailing comment\n`;
    const out = applyInstall(text, renderBlock('0 1 * * *', COMMAND, INSTALLED_AT));
    expect(out.trimEnd().endsWith('# trailing comment')).toBe(true);
  });

  it('removes the block and the separator it added, leaving other lines intact', () => {
    const installed = applyInstall(OTHER, block);
    const { text, removed } = applyRemove(installed);
    expect(removed).toBe(true);
    expect(text).toBe(OTHER);
  });

  it('removing from a crontab without the block changes nothing', () => {
    expect(applyRemove(OTHER)).toEqual({ text: OTHER, removed: false });
    expect(applyRemove('')).toEqual({ text: '', removed: false });
  });

  it('removing the only block leaves an empty crontab', () => {
    expect(applyRemove(applyInstall('', block))).toEqual({ text: '', removed: true });
  });

  it('refuses a half block or two blocks', () => {
    expect(() => findBlock(`${BLOCK_BEGIN}\n* * * * * x\n`)).toThrow(/without an end/);
    expect(() => findBlock(`* * * * * x\n${BLOCK_END}\n`)).toThrow(/without a start/);
    const twice = `${block.join('\n')}\n${block.join('\n')}\n`;
    expect(() => findBlock(twice)).toThrow(/more than one/);
  });

  it('parses the installed schedule back', () => {
    const installed = parseInstalled(applyInstall(OTHER, block));
    expect(installed).toEqual({
      cron: '30 2 * * *',
      command: COMMAND,
      line: `30 2 * * * ${COMMAND}`,
      description: 'Every day at 02:30',
      installedAt: '2026-03-10T08:00:00.000Z',
    });
    expect(parseInstalled(OTHER)).toBeNull();
  });
});

describe('reading and writing through the crontab runner', () => {
  it('treats "no crontab for user" as empty', async () => {
    expect(await readCrontab(fakeCrontab(null).run)).toBe('');
  });

  it('reports other crontab failures', async () => {
    const run: CrontabRunner = async () => ({ code: 1, stdout: '', stderr: 'permission denied' });
    await expect(readCrontab(run)).rejects.toThrow(/permission denied/);
  });

  it('installs, re-installs and removes, never touching the other lines', async () => {
    const cron = fakeCrontab(OTHER);
    const first = await installSchedule('30 2 * * *', COMMAND, { run: cron.run, now: INSTALLED_AT });
    expect(first.description).toBe('Every day at 02:30');
    const afterFirst = cron.text()!;
    await installSchedule('30 2 * * *', COMMAND, { run: cron.run, now: INSTALLED_AT });
    expect(cron.text()).toBe(afterFirst);

    const status = await getScheduleStatus({ run: cron.run, platform: 'linux', now: new Date(2026, 2, 10, 1, 0) });
    expect(status.installed?.cron).toBe('30 2 * * *');
    expect(status.next).toEqual([new Date(2026, 2, 10, 2, 30), new Date(2026, 2, 11, 2, 30), new Date(2026, 2, 12, 2, 30)]);

    expect(await removeSchedule({ run: cron.run })).toBe(true);
    expect(cron.text()).toBe(OTHER);
    expect(await removeSchedule({ run: cron.run })).toBe(false);
  });

  it('installs into a user with no crontab yet', async () => {
    const cron = fakeCrontab(null);
    await installSchedule('0 */6 * * *', COMMAND, { run: cron.run, now: INSTALLED_AT });
    expect(parseInstalled(cron.text()!)?.description).toBe('Every 6 hours');
  });

  it('does not write when removing from a crontab without the block', async () => {
    const cron = fakeCrontab(OTHER);
    await removeSchedule({ run: cron.run });
    expect(cron.calls).toEqual([['-l']]);
  });

  it('reports an unreadable crontab in the status instead of throwing', async () => {
    const run: CrontabRunner = async () => ({ code: 1, stdout: '', stderr: 'cron is broken' });
    const status = await getScheduleStatus({ run, platform: 'linux' });
    expect(status).toMatchObject({ supported: true, installed: null, error: expect.stringMatching(/cron is broken/) });
  });

  it('has no crontab on Windows', async () => {
    expect(supportsCrontab('win32')).toBe(false);
    expect(supportsCrontab('linux')).toBe(true);
    expect(supportsCrontab('darwin')).toBe(true);
    expect(await getScheduleStatus({ platform: 'win32' })).toEqual({ supported: false, installed: null, next: [] });
  });
});

describe('schedulePreflight', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');
  const good: PreflightInput = {
    platform: 'linux',
    hasSavedSettings: true,
    saved: { output: '~/vault-backups/vault-{datetime}.zip', passwordFile: '/home/person-a/.vault/backup-password', keepDays: 30 },
    env: {},
    passwordFile: { exists: true, mode: 0o100600, empty: false },
    tokenSource: 'config',
    fileTokenPresent: true,
    tokenExpiresAt: '2027-03-10T12:00:00.000Z',
    nextRunAt: new Date('2026-03-11T02:30:00.000Z'),
    now,
  };
  const messages = (i: PreflightInput) => schedulePreflight(i).map((x) => `${x.level}:${x.message}`);

  it('is clean when everything is in place', () => {
    expect(schedulePreflight(good)).toEqual([]);
  });

  it('flags missing saved settings and an "ask every time" password as blocking', () => {
    const issues = schedulePreflight({ ...good, hasSavedSettings: false, saved: {}, passwordFile: undefined });
    expect(issues[0]).toMatchObject({ level: 'warning', message: expect.stringMatching(/No saved backup settings/) });
    expect(issues.some((i) => i.level === 'error' && /No saved password source/.test(i.message))).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('warns that cron will not see a password in an environment variable', () => {
    const out = messages({ ...good, saved: { ...good.saved, passwordFile: undefined, passwordEnv: 'BACKUP_PW' }, passwordFile: undefined });
    expect(out.some((m) => m.startsWith('warning:') && m.includes('$BACKUP_PW'))).toBe(true);
    const defaultEnv = schedulePreflight({ ...good, saved: { keepDays: 30 }, passwordFile: undefined, env: { VAULT_BACKUP_PASSWORD: 'x' } });
    expect(defaultEnv[0]).toMatchObject({ level: 'error', message: expect.stringMatching(/scheduled jobs do not see/) });
  });

  it('checks the password file: missing, empty, readable by others', () => {
    expect(messages({ ...good, passwordFile: { exists: false } })).toContainEqual(expect.stringMatching(/^error:.*does not exist/));
    expect(messages({ ...good, passwordFile: { exists: true, mode: 0o100600, empty: true } })).toContainEqual(expect.stringMatching(/^error:.*is empty/));
    expect(messages({ ...good, passwordFile: { exists: true, mode: 0o100644, empty: false } })).toContainEqual(
      expect.stringMatching(/^warning:.*mode 644.*chmod 600/),
    );
  });

  it('needs a stored token, not only VAULT_TOKEN', () => {
    expect(messages({ ...good, tokenSource: undefined, fileTokenPresent: false, tokenExpiresAt: undefined })).toContainEqual(
      expect.stringMatching(/^error:Not signed in/),
    );
    expect(messages({ ...good, tokenSource: 'environment', fileTokenPresent: false, tokenExpiresAt: undefined })).toContainEqual(
      expect.stringMatching(/^error:.*VAULT_TOKEN.*vault auth token create/),
    );
    expect(messages({ ...good, tokenSource: 'environment' })).toContainEqual(expect.stringMatching(/^warning:VAULT_TOKEN is set/));
  });

  it('checks the stored token against now, the next run and 14 days', () => {
    expect(messages({ ...good, tokenExpiresAt: '2026-03-01T00:00:00.000Z' })).toContainEqual(expect.stringMatching(/^error:The stored token has expired/));
    expect(messages({ ...good, tokenExpiresAt: '2026-03-10T20:00:00.000Z' })).toContainEqual(
      expect.stringMatching(/^error:The stored token expires before the next scheduled run.*Access token/),
    );
    expect(messages({ ...good, tokenExpiresAt: '2026-03-15T12:00:00.000Z' })).toContainEqual(
      expect.stringMatching(/^warning:The stored token expires in 5 day\(s\)/),
    );
  });

  it('reuses the schedule-entry warnings (retention off, relative output path)', () => {
    const out = messages({ ...good, saved: { passwordFile: good.saved.passwordFile, output: 'backups/vault-{date}.zip' } });
    expect(out).toContainEqual(expect.stringMatching(/^warning:Retention is off/));
    expect(out).toContainEqual(expect.stringMatching(/^warning:The output path is relative/));
  });

  it('marks which issues matter for a manual run', () => {
    const issues = schedulePreflight({ ...good, saved: {}, passwordFile: undefined, tokenExpiresAt: '2026-03-01T00:00:00.000Z' });
    const always = issues.filter((i) => i.scope === 'always').map((i) => i.message);
    expect(always).toEqual([expect.stringMatching(/has expired/)]);
  });
});
