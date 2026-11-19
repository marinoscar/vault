import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runApp } from '../../run.js';
import { fieldValueLines, formatSecretDetail, formatVersionDetail } from '../lib/formatters.js';
import type { Secret, SecretVersion } from '../utils/types.js';

// Issue #206: a `keyvalue` field value prints as `label: value` lines, never `[object Object]`.

const EXTRAS = [
  { key: 'member_number', label: 'Member number', value: 'M-0001', sensitive: false },
  { key: 'group_number', label: 'Group number', value: 'G-0002', sensitive: true },
];

function capture(fn: () => void): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('fieldValueLines', () => {
  it('reads a keyvalue value as one label: value line per entry', () => {
    expect(fieldValueLines(EXTRAS)).toEqual({ inline: '', lines: ['Member number: M-0001', 'Group number: G-0002'] });
    expect(fieldValueLines([])).toEqual({ inline: '-', lines: [] });
  });

  it('prints other objects as JSON and scalars as text', () => {
    expect(fieldValueLines({ a: 1 })).toEqual({ inline: '{"a":1}', lines: [] });
    expect(fieldValueLines('plain')).toEqual({ inline: 'plain', lines: [] });
    expect(fieldValueLines(null)).toEqual({ inline: '', lines: [] });
  });
});

describe('secret and version detail with a keyvalue field', () => {
  const values = { title: 'Plan A', extra_fields: EXTRAS };

  it('formatSecretDetail prints indented label: value lines', () => {
    const secret = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Plan A',
      description: null,
      typeId: '00000000-0000-4000-8000-000000000002',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentVersion: 1,
      values,
    } as unknown as Secret;
    const out = capture(() => formatSecretDetail(secret));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('      Member number: M-0001');
    expect(out).toContain('      Group number: G-0002');
    expect(out).toContain('Plan A');
  });

  it('formatVersionDetail prints indented label: value lines', () => {
    const version = {
      id: '00000000-0000-4000-8000-000000000003',
      version: 2,
      isCurrent: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      values,
    } as unknown as SecretVersion;
    const out = capture(() => formatVersionDetail(version));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('      Member number: M-0001');
  });
});

describe('vault secrets create --data with a keyvalue array', () => {
  const realFetch = globalThis.fetch;
  const saved = { ...process.env };
  let home: string;
  let bodies: unknown[] = [];

  beforeEach(() => {
    resetCliForTests();
    home = mkdtempSync(join(tmpdir(), 'vault-cli-kv-'));
    process.env.HOME = home;
    delete process.env.VAULTCLI_SERVER_URL;
    delete process.env.VAULTCLI_CONFIG_DIR;
    process.env.VAULT_SERVER_URL = 'https://vault.example.test';
    process.env.VAULT_TOKEN = 'pat_test';
    bodies = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      bodies.push(body);
      return new Response(
        JSON.stringify({ data: { id: 'id-1', name: 'Plan A', updatedAt: '2026-01-01T00:00:00.000Z', values: body?.data ?? {} } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
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

  it('sends the array unchanged', async () => {
    const data = { title: 'Plan A', extra_fields: EXTRAS };
    const code = await runApp([
      'secrets', 'create', '--name', 'Plan A', '--type-id', '00000000-0000-4000-8000-000000000002', '--data', JSON.stringify(data), '--json',
    ]);
    expect(code).toBe(0);
    expect(bodies[0]).toMatchObject({ name: 'Plan A', data });
  });
});
