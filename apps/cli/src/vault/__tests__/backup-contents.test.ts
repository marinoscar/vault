import { test, describe, beforeAll as before, afterAll as after, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  BACKUP_CONTENT_KEYS,
  DEFAULT_BACKUP_SETTINGS,
  buildExportBody,
  contentKeys,
  contentsFromKeys,
  describeContents,
  effectiveContents,
  parseContentsOption,
  resolveBackupSettings,
  validateBackupSettings,
} from '../lib/backup-settings.js';
import { performBackup } from '../lib/backup-runner.js';
import { backupContentChoices, validateContentSelection } from '../interactive/logic.js';

describe('parseContentsOption', () => {
  test('secrets,media: listed keys on, the rest off', () => {
    assert.deepEqual(parseContentsOption('secrets,media'), {
      includeSecrets: true,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  test('all keys; spaces, case and duplicates are tolerated', () => {
    assert.deepEqual(parseContentsOption(' Secrets , attachments,VERSIONS,media,secrets '), {
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: true,
    });
  });

  test('media alone is valid', () => {
    assert.deepEqual(parseContentsOption('media'), {
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  test('unknown key fails and lists the valid ones', () => {
    assert.throws(() => parseContentsOption('secrets,photos,audit'), (err: Error) => {
      assert.match(err.message, /photos, audit/);
      assert.match(err.message, /Valid values: secrets, attachments, versions, media/);
      return true;
    });
  });

  test('system is not offered at the user level', () => {
    assert.throws(() => parseContentsOption('system'), /Unknown --contents value\(s\): system/);
  });

  test('attachments without secrets fails', () => {
    assert.throws(() => parseContentsOption('attachments,media'), /attachments require secrets/);
  });

  test('versions without secrets fails', () => {
    assert.throws(() => parseContentsOption('versions'), /versions require secrets/);
  });

  test('attachments and versions without secrets are named together', () => {
    assert.throws(() => parseContentsOption('attachments,versions,media'), /attachments and versions require secrets/);
  });

  test('empty list fails', () => {
    assert.throws(() => parseContentsOption(''), /comma-separated list/);
    assert.throws(() => parseContentsOption(' , ,'), /comma-separated list/);
  });

  test('contentsFromKeys with an empty list: nothing to back up', () => {
    assert.throws(() => contentsFromKeys([]), /Choose at least one thing to back up/);
  });
});

describe('defaults', () => {
  test('secrets and attachments on, versions and media off', () => {
    assert.equal(DEFAULT_BACKUP_SETTINGS.includeSecrets, true);
    assert.equal(DEFAULT_BACKUP_SETTINGS.includeAttachments, true);
    assert.equal(DEFAULT_BACKUP_SETTINGS.includeVersions, false);
    assert.equal(DEFAULT_BACKUP_SETTINGS.includeMedia, false);
    const { settings, sources } = resolveBackupSettings({}, {});
    assert.deepEqual(contentKeys(settings), ['secrets', 'attachments']);
    assert.equal(sources.includeSecrets, 'default');
    assert.equal(sources.includeMedia, 'default');
    assert.equal(describeContents(settings), 'secrets with attachments');
  });

  test('BACKUP_CONTENT_KEYS order', () => {
    assert.deepEqual([...BACKUP_CONTENT_KEYS], ['secrets', 'attachments', 'versions', 'media']);
  });
});

describe('merging content flags with saved settings', () => {
  test('saved includeMedia / includeSecrets are used when no flag is given', () => {
    const { settings, sources } = resolveBackupSettings({}, { includeMedia: true, includeSecrets: false });
    assert.equal(settings.includeMedia, true);
    assert.equal(settings.includeSecrets, false);
    assert.equal(sources.includeMedia, 'saved');
    assert.deepEqual(effectiveContents(settings, sources), {
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  test('flag beats saved for each content key', () => {
    const { settings, sources } = resolveBackupSettings(
      { includeMedia: false, includeSecrets: true },
      { includeMedia: true, includeSecrets: false, includeVersions: true },
    );
    assert.equal(settings.includeMedia, false);
    assert.equal(sources.includeMedia, 'flag');
    assert.equal(settings.includeSecrets, true);
    assert.equal(settings.includeVersions, true);
    assert.equal(sources.includeVersions, 'saved');
  });

  test('--contents (parsed) overrides every saved content setting', () => {
    const flags = parseContentsOption('media');
    const { settings, sources } = resolveBackupSettings(flags, {
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: false,
    });
    assert.deepEqual(effectiveContents(settings, sources), {
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  test('--no-secrets with saved attachments/versions drops them silently', () => {
    const { settings, sources } = resolveBackupSettings(
      { includeSecrets: false, includeMedia: true },
      { includeAttachments: true, includeVersions: true },
    );
    assert.deepEqual(effectiveContents(settings, sources), {
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
  });

  test('--no-secrets with --include-versions on the same command fails', () => {
    const { settings, sources } = resolveBackupSettings({ includeSecrets: false, includeVersions: true, includeMedia: true }, {});
    assert.throws(() => effectiveContents(settings, sources), /--include-versions require secrets/);
  });

  test('--no-secrets with --attachments on the same command fails', () => {
    const { settings, sources } = resolveBackupSettings({ includeSecrets: false, includeAttachments: true, includeMedia: true }, {});
    assert.throws(() => effectiveContents(settings, sources), /--attachments require secrets/);
  });

  test('--no-secrets without media: nothing to back up', () => {
    const { settings, sources } = resolveBackupSettings({ includeSecrets: false }, {});
    assert.throws(() => effectiveContents(settings, sources), /Choose at least one thing to back up/);
  });

  test('saved secrets off + flag --secrets restores secrets with the default attachments', () => {
    const { settings, sources } = resolveBackupSettings({ includeSecrets: true }, { includeSecrets: false, includeMedia: true });
    assert.deepEqual(contentKeys(effectiveContents(settings, sources)), ['secrets', 'attachments', 'media']);
  });

  test('backup.json validation accepts and type-checks the new keys', () => {
    assert.deepEqual(validateBackupSettings({ includeSecrets: false, includeMedia: true }), {
      includeSecrets: false,
      includeMedia: true,
    });
    assert.throws(() => validateBackupSettings({ includeMedia: 'yes' }), /includeMedia must be true or false/);
    assert.throws(() => validateBackupSettings({ includeSecrets: 1 }), /includeSecrets must be true or false/);
  });
});

describe('buildExportBody', () => {
  test('defaults', () => {
    const { settings, sources } = resolveBackupSettings({}, {});
    assert.deepEqual(buildExportBody(effectiveContents(settings, sources), 'secret-pw'), {
      password: 'secret-pw',
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: false,
    });
  });

  test('never sends attachments/versions without secrets', () => {
    assert.deepEqual(
      buildExportBody({ includeSecrets: false, includeAttachments: true, includeVersions: true, includeMedia: true }, 'pw1234'),
      { password: 'pw1234', includeSecrets: false, includeAttachments: false, includeVersions: false, includeMedia: true },
    );
  });
});

describe('setup wizard checkbox helpers', () => {
  test('choices are checked from current settings (defaults: secrets + attachments)', () => {
    const { settings } = resolveBackupSettings({}, {});
    const choices = backupContentChoices(settings);
    assert.deepEqual(
      choices.map((c) => [c.value, c.checked]),
      [['secrets', true], ['attachments', true], ['versions', false], ['media', false]],
    );
  });

  test('saved media on and secrets off', () => {
    const { settings } = resolveBackupSettings({}, { includeSecrets: false, includeMedia: true, includeAttachments: true });
    assert.deepEqual(
      backupContentChoices(settings).filter((c) => c.checked).map((c) => c.value),
      ['media'],
    );
  });

  test('validation messages', () => {
    assert.equal(validateContentSelection(['secrets']), true);
    assert.equal(validateContentSelection(['media']), true);
    assert.match(String(validateContentSelection([])), /Choose at least one thing to back up/);
    assert.match(String(validateContentSelection(['attachments', 'media'])), /require secrets/);
  });
});

// ---------------------------------------------------------------------------
// The request performBackup actually sends (fetch mocked)
// ---------------------------------------------------------------------------

describe('performBackup request', () => {
  let dir: string;
  const prevConfigDir = process.env.VAULTCLI_CONFIG_DIR;
  const prevServerUrl = process.env.VAULTCLI_SERVER_URL;
  const realFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit }[] = [];
  let responseHeaders: Record<string, string> = {};

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vaultcli-contents-'));
    process.env.VAULTCLI_CONFIG_DIR = join(dir, 'config');
    process.env.VAULTCLI_SERVER_URL = 'https://vault.example.test';
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevConfigDir === undefined) delete process.env.VAULTCLI_CONFIG_DIR;
    else process.env.VAULTCLI_CONFIG_DIR = prevConfigDir;
    if (prevServerUrl === undefined) delete process.env.VAULTCLI_SERVER_URL;
    else process.env.VAULTCLI_SERVER_URL = prevServerUrl;
  });

  beforeEach(() => {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(
      join(dir, 'config', 'auth.json'),
      JSON.stringify({ token: 'test-token', serverUrl: 'https://vault.example.test' }),
    );
    calls = [];
    responseHeaders = { 'content-type': 'application/zip', 'x-vault-export-secrets': '3', 'x-vault-export-attachments': '2' };
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), { status: 200, headers: responseHeaders });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function run(flags: Parameters<typeof resolveBackupSettings>[0], saved: Parameters<typeof resolveBackupSettings>[1], name: string) {
    const { settings, sources } = resolveBackupSettings({ ...flags, output: join(dir, `${name}.zip`) }, saved);
    return performBackup({ settings, contents: effectiveContents(settings, sources), password: 'pw-123456', overwrite: true });
  }

  test('default run sends includeSecrets/includeMedia with the existing flags', async () => {
    const result = await run({}, {}, 'default');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://vault.example.test/api/secrets/export');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      password: 'pw-123456',
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: false,
    });
    // Missing media header counts as 0.
    assert.equal(result.mediaFiles, 0);
    assert.deepEqual(result.contents, ['secrets', 'attachments']);
    assert.equal(result.secrets, 3);
    assert.equal(result.attachments, 2);
    assert.equal(readFileSync(result.path).length, 7);
  });

  test('--contents media sends only media and reads the media count header', async () => {
    responseHeaders['x-vault-export-media-files'] = '12';
    const result = await run(parseContentsOption('media'), { includeVersions: true }, 'media');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      password: 'pw-123456',
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
    });
    assert.equal(result.mediaFiles, 12);
    assert.equal(result.includeSecrets, false);
    assert.equal(result.includeMedia, true);
    assert.deepEqual(result.contents, ['media']);
  });

  test('saved media + versions with flags', async () => {
    responseHeaders['x-vault-export-media-files'] = 'not-a-number';
    const result = await run({ includeAttachments: false }, { includeMedia: true, includeVersions: true }, 'mixed');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      password: 'pw-123456',
      includeSecrets: true,
      includeAttachments: false,
      includeVersions: true,
      includeMedia: true,
    });
    assert.equal(result.mediaFiles, 0);
    assert.deepEqual(result.contents, ['secrets', 'versions', 'media']);
  });
});
