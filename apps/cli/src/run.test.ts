import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runApp } from './run.js';
import { choosePasswordSource } from './vault/lib/backup-settings.js';

// =============================================================================
// One invocation through createCli: a domain command, its global options,
// credentials from the VAULT_ environment, and the VAULT_ password alias.
// =============================================================================

describe('vault secrets list', () => {
  const realFetch = globalThis.fetch;
  const saved = { ...process.env };
  let home: string;
  let out = '';
  let calls: { url: string; auth: string | null }[] = [];

  beforeEach(() => {
    resetCliForTests();
    home = mkdtempSync(join(tmpdir(), 'vault-cli-run-'));
    process.env.HOME = home;
    delete process.env.VAULTCLI_SERVER_URL;
    delete process.env.VAULTCLI_CONFIG_DIR;
    process.env.VAULT_SERVER_URL = 'https://vault.example.test';
    process.env.VAULT_TOKEN = 'pat_test';
    out = '';
    calls = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    }) as typeof process.stdout.write);
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get('authorization') });
      return new Response(
        JSON.stringify({ data: { items: [{ id: 'id-1', name: 'Alpha login' }], page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(home, { recursive: true, force: true });
  });

  it('sends the VAULT_TOKEN to the VAULT_SERVER_URL and prints the JSON envelope', async () => {
    const code = await runApp(['secrets', 'list', '--json']);

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/^https:\/\/vault\.example\.test\/api\/secrets\?/);
    expect(calls[0]?.auth).toBe('Bearer pat_test');
    const parsed = JSON.parse(out) as { success: boolean; data: { items: { id: string }[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.items[0]?.id).toBe('id-1');
  });

  it('accepts the global options before the subcommand too, and --quiet prints bare ids', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });

    const code = await runApp(['secrets', '-q', 'list']);

    expect(code).toBe(0);
    expect(lines).toEqual(['id-1']);
  });

  it('--server overrides the server for this invocation', async () => {
    await runApp(['secrets', 'list', '--json', '--server', 'https://other.example.test']);

    expect(calls[0]?.url).toMatch(/^https:\/\/other\.example\.test\/api\/secrets/);
  });

  it('exits non-zero from the platform guard when called with an unknown command', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    expect(await runApp(['nope'])).not.toBe(0);
  });
});

describe('the backup password environment variable', () => {
  it('accepts VAULTCLI_BACKUP_PASSWORD and its VAULT_ alias, the old name first', () => {
    expect(choosePasswordSource({}, {}, { VAULT_BACKUP_PASSWORD: 'x' })).toEqual({
      kind: 'env',
      name: 'VAULT_BACKUP_PASSWORD',
      from: 'default',
    });
    expect(choosePasswordSource({}, {}, { VAULTCLI_BACKUP_PASSWORD: 'x', VAULT_BACKUP_PASSWORD: 'y' })).toEqual({
      kind: 'env',
      name: 'VAULTCLI_BACKUP_PASSWORD',
      from: 'default',
    });
  });

  it('prompts when neither is set, and a saved source still wins over both', () => {
    expect(choosePasswordSource({}, {}, {})).toEqual({ kind: 'prompt' });
    expect(choosePasswordSource({}, { passwordFile: '/x' }, { VAULT_BACKUP_PASSWORD: 'y' })).toMatchObject({ kind: 'file' });
  });
});
