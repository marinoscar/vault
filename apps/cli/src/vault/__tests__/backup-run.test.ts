import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exportMock = vi.fn<(body: unknown) => Promise<Response>>();
vi.mock('../lib/api-client.js', () => ({
  exportSecretsBackup: (body: unknown) => exportMock(body),
  getCurrentUser: async () => ({ email: 'person-a@example.test' }),
}));

const { executeBackup, recordFailure } = await import('../lib/backup-run.js');
const { performBackup } = await import('../lib/backup-runner.js');
const { parseBackupLog } = await import('../lib/backup-status.js');
const { resolveBackupSettings } = await import('../lib/backup-settings.js');

const PASSWORD = 'invented-password-1';
const ZIP = Buffer.from('PK\u0003\u0004 not really a zip, but bytes');

function zipResponse(withLength = true): Response {
  const headers: Record<string, string> = { 'content-type': 'application/zip', 'x-vault-export-secrets': '3' };
  if (withLength) headers['content-length'] = String(ZIP.length);
  return new Response(ZIP, { status: 200, headers });
}

describe('backup runs with history', () => {
  let dir: string;
  let log: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-run-'));
    log = join(dir, 'backup.log');
    exportMock.mockReset();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const settings = (extra = {}) => resolveBackupSettings({ output: join(dir, 'out', 'vault-{datetime}.zip'), ...extra }, {}).settings;

  it('reports structured progress when asked, and writes the file', async () => {
    exportMock.mockResolvedValue(zipResponse());
    const events: string[] = [];
    const result = await performBackup({
      settings: settings(),
      password: PASSWORD,
      overwrite: false,
      onProgress: (e) => events.push(e.phase === 'download' ? `download:${e.bytes}/${e.total}` : e.phase),
    });
    expect(readFileSync(result.path)).toEqual(ZIP);
    expect(events[0]).toBe('request');
    expect(events).toContain(`download:0/${ZIP.length}`);
    expect(events).toContain(`download:${ZIP.length}/${ZIP.length}`);
    expect(events[events.length - 1]).toBe('write');
  });

  it('downloads the same way without a progress callback (existing callers)', async () => {
    exportMock.mockResolvedValue(zipResponse(false));
    const result = await performBackup({ settings: settings(), password: PASSWORD, overwrite: false });
    expect(result.size).toBe(ZIP.length);
    expect(result.secrets).toBe(3);
  });

  it('records a successful run with retention, never the password', async () => {
    const out = join(dir, 'out');
    exportMock.mockResolvedValue(zipResponse());
    // Two older backups matching the template; keep the newest one only.
    const { mkdirSync, utimesSync } = await import('node:fs');
    mkdirSync(out, { recursive: true });
    for (const [name, when] of [
      ['vault-2026-01-01_000000.zip', '2026-01-01T00:00:00Z'],
      ['vault-2026-01-02_000000.zip', '2026-01-02T00:00:00Z'],
    ] as const) {
      writeFileSync(join(out, name), 'old');
      utimesSync(join(out, name), new Date(when), new Date(when));
    }
    let retentionStarted = false;
    const { result, prune } = await executeBackup({
      settings: settings({ keepLast: 1 }),
      password: PASSWORD,
      overwrite: false,
      trigger: 'tui',
      logFile: log,
      onRetention: () => (retentionStarted = true),
    });
    expect(retentionStarted).toBe(true);
    expect(prune && 'deleted' in prune ? prune.deleted.length : -1).toBe(2);
    expect(readdirSync(out)).toEqual([result.path.split('/').pop()]);

    const text = readFileSync(log, 'utf8');
    expect(text).not.toContain(PASSWORD);
    const [run] = parseBackupLog(text);
    expect(run).toMatchObject({ trigger: 'tui', outcome: 'success', path: result.path, size: ZIP.length, retentionDeleted: 2 });
  });

  it('records a failed run and re-throws', async () => {
    exportMock.mockRejectedValue(new Error('fetch failed'));
    await expect(
      executeBackup({ settings: settings(), password: PASSWORD, overwrite: false, trigger: 'schedule', logFile: log }),
    ).rejects.toThrow(/fetch failed/);
    const [run] = parseBackupLog(readFileSync(log, 'utf8'));
    expect(run).toMatchObject({ trigger: 'schedule', outcome: 'failure', error: expect.stringMatching(/fetch failed/) });
    expect(existsSync(join(dir, 'out'))).toBe(true);
    expect(readdirSync(join(dir, 'out'))).toEqual([]);
  });

  it('records a run that never started', () => {
    recordFailure('schedule', new Date('2026-03-10T02:30:00Z'), new Error('Cannot read password file /x (ENOENT)'), log);
    expect(parseBackupLog(readFileSync(log, 'utf8'))[0]).toMatchObject({ outcome: 'failure', error: 'Cannot read password file /x (ENOENT)' });
  });
});
