import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/config.js', () => ({
  config: { apiUrl: 'https://vault.example.test/api' },
  getToken: () => 'test-token',
}));

import { registerSecretCommands, parseOnOff } from '../commands/secrets.js';
import { formatSecretTable, formatSecretDetail } from '../lib/formatters.js';

const ID = '11111111-2222-3333-4444-555555555555';

interface Call { url: string; init: RequestInit }
let calls: Call[];
let responder: (url: string, init: RequestInit) => Response;
let out: string[];
let err: string[];
const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function secret(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: 'api-key-example',
    description: null,
    typeId: 'type-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    currentVersion: 1,
    values: { key: 'v' },
    assistantReveal: false,
    assistantRevealChangedAt: null,
    ...extra,
  };
}

async function run(...args: string[]): Promise<number | undefined> {
  const program = new Command();
  program.option('--json').option('-q, --quiet');
  program.exitOverride();
  registerSecretCommands(program);
  let exitCode: number | undefined;
  const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    exitCode = c ?? 0;
    throw new Error('__exit__');
  }) as never);
  try {
    await program.parseAsync(['node', 'vault', ...args]);
  } catch (e) {
    if (!(e instanceof Error) || e.message !== '__exit__') throw e;
  } finally {
    exit.mockRestore();
  }
  return exitCode;
}

beforeEach(() => {
  calls = [];
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => (out.push(String(s)), true)) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => (err.push(String(s)), true)) as never);
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init ?? {});
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('parseOnOff', () => {
  test('accepts on/off case-insensitively, rejects others', () => {
    expect(parseOnOff('on')).toBe(true);
    expect(parseOnOff('OFF')).toBe(false);
    expect(parseOnOff('yes')).toBeUndefined();
  });
});

describe('secrets reveal-access', () => {
  test('on by id sends PATCH { enabled: true } and warns', async () => {
    responder = (url, init) =>
      init.method === 'PATCH' ? json(200, { data: secret({ assistantReveal: true }) }) : json(200, { data: secret() });
    const code = await run('secrets', 'reveal-access', ID, 'on');
    expect(code).toBeUndefined();
    const patch = calls.find((c) => c.init.method === 'PATCH')!;
    expect(patch.url).toBe(`https://vault.example.test/api/secrets/${ID}/assistant-reveal`);
    expect(JSON.parse(patch.init.body as string)).toEqual({ enabled: true });
    const text = out.join('\n');
    expect(text).toContain('Reveal to assistants: on for "api-key-example"');
    expect(text).toContain('Agent activity');
  });

  test('off by name resolves the name first and prints no warning', async () => {
    responder = (url, init) =>
      init.method === 'PATCH' ? json(200, { data: secret() }) : json(200, { data: secret({ assistantReveal: true }) });
    await run('secrets', 'reveal-access', 'api-key-example', 'off');
    expect(calls[0]!.url).toContain('/secrets/by-name/api-key-example');
    const patch = calls.find((c) => c.init.method === 'PATCH')!;
    expect(JSON.parse(patch.init.body as string)).toEqual({ enabled: false });
    const text = out.join('\n');
    expect(text).toContain('Reveal to assistants: off for "api-key-example"');
    expect(text).not.toContain('Agent activity');
  });

  test('--json prints the envelope with the flag and no secret values', async () => {
    responder = () => json(200, { data: secret({ assistantReveal: true }) });
    await run('--json', 'secrets', 'reveal-access', ID, 'on');
    const env = JSON.parse(out.join(''));
    expect(env.success).toBe(true);
    expect(env.data.assistantReveal).toBe(true);
    expect(env.data.values).toBeUndefined();
  });

  test('422 maps to the unsupported-type message and exit 1', async () => {
    responder = (url, init) =>
      init.method === 'PATCH'
        ? json(422, { code: 'ASSISTANT_REVEAL_UNSUPPORTED_TYPE', message: 'x' })
        : json(200, { data: secret() });
    const code = await run('secrets', 'reveal-access', ID, 'on');
    expect(code).toBe(1);
    expect(err.join('\n')).toContain(
      'This secret type cannot be revealed to assistants (cards and identity documents are excluded).',
    );
  });

  test('404 maps to the existing not-found message', async () => {
    responder = () => json(404, { code: 'NOT_FOUND', message: 'nope' });
    const code = await run('secrets', 'reveal-access', ID, 'on');
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('Failed to get secret: 404');
  });

  test('invalid state fails without calling the API', async () => {
    responder = () => json(200, { data: secret() });
    const code = await run('secrets', 'reveal-access', ID, 'maybe');
    expect(code).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe('secrets list --assistant-reveal', () => {
  const page = { data: { items: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } } };

  test('on maps to assistantReveal=true', async () => {
    responder = () => json(200, page);
    await run('secrets', 'list', '--assistant-reveal', 'on');
    expect(new URL(calls[0]!.url).searchParams.get('assistantReveal')).toBe('true');
  });

  test('off maps to assistantReveal=false', async () => {
    responder = () => json(200, page);
    await run('secrets', 'list', '--assistant-reveal', 'off');
    expect(new URL(calls[0]!.url).searchParams.get('assistantReveal')).toBe('false');
  });

  test('omitted sends no param; invalid value fails', async () => {
    responder = () => json(200, page);
    await run('secrets', 'list');
    expect(new URL(calls[0]!.url).searchParams.has('assistantReveal')).toBe(false);
    calls.length = 0;
    expect(await run('secrets', 'list', '--assistant-reveal', 'x')).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe('secrets get and list output', () => {
  test('get --json keeps assistantReveal', async () => {
    responder = () => json(200, { data: secret({ assistantReveal: true, assistantRevealChangedAt: '2026-03-01T00:00:00Z' }) });
    await run('--json', 'secrets', 'get', ID);
    const env = JSON.parse(out.join(''));
    expect(env.data.assistantReveal).toBe(true);
    expect(env.data.assistantRevealChangedAt).toBe('2026-03-01T00:00:00Z');
  });

  test('detail shows the Reveal to assistants line', () => {
    formatSecretDetail(secret({ assistantReveal: true }) as never);
    expect(out.join('\n')).toMatch(/Reveal to assistants.*on/);
    out.length = 0;
    formatSecretDetail(secret() as never);
    expect(out.join('\n')).toMatch(/Reveal to assistants.*off/);
  });

  test('table marks revealed secrets', () => {
    formatSecretTable({
      items: [secret({ assistantReveal: true }) as never],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    } as never);
    const text = out.join('\n');
    expect(text).toContain('Reveal');
    expect(text).toContain('on');
  });
});
