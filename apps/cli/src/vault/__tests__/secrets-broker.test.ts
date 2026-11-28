import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../utils/config.js', () => ({
  config: { apiUrl: 'https://vault.example.test/api' },
  getToken: () => 'test-token',
}));

import { registerSecretCommands } from '../commands/secrets.js';
import { registerBrokerCommands } from '../commands/broker.js';
import { brokerBaseUrl, buildInjection, parseExpiresDays } from '../lib/broker.js';
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
    brokerAccess: false,
    brokerOrigins: [],
    brokerInjection: null,
    brokerField: null,
    ...extra,
  };
}

async function run(...args: string[]): Promise<number | undefined> {
  const program = new Command();
  program.option('--json').option('-q, --quiet');
  program.exitOverride();
  registerSecretCommands(program);
  registerBrokerCommands(program);
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


const ORIGIN = 'https://api.service-x.example';
const BASE = `https://vault.example.test/api/broker/v1/${ID}/api.service-x.example`;
const on = (extra: Record<string, unknown> = {}) =>
  secret({ brokerAccess: true, brokerOrigins: [ORIGIN], brokerInjection: null, ...extra });
const patchOf = () => calls.find((c) => c.init.method === 'PATCH')!;

describe('lib helpers', () => {
  test('brokerBaseUrl strips the scheme and trailing slash', () => {
    expect(brokerBaseUrl(ID, 'https://h.example:8443/')).toBe(`https://vault.example.test/api/broker/v1/${ID}/h.example:8443`);
  });
  test('buildInjection defaults, header, prefix none and query', () => {
    expect(buildInjection({})).toBeUndefined();
    expect(buildInjection({ header: 'X-Api-Key', prefix: 'none' })).toEqual({ kind: 'header', name: 'X-Api-Key', prefix: '' });
    expect(buildInjection({ prefix: 'token' })).toEqual({ kind: 'header', name: 'Authorization', prefix: 'Token' });
    expect(buildInjection({ query: 'api_key' })).toEqual({ kind: 'query', name: 'api_key' });
    expect(() => buildInjection({ header: 'a', query: 'b' })).toThrow();
    expect(() => buildInjection({ prefix: 'Nope' })).toThrow();
  });
  test('parseExpiresDays', () => {
    expect(parseExpiresDays('90')).toBe(90);
    expect(parseExpiresDays('30d')).toBe(30);
    expect(() => parseExpiresDays('0')).toThrow();
    expect(() => parseExpiresDays('abc')).toThrow();
  });
});

describe('secrets broker', () => {
  test('on sends origins/injection/field and prints base URLs', async () => {
    responder = (_u, init) =>
      init.method === 'PATCH' ? json(200, { data: on({ brokerInjection: { kind: 'header', name: 'X-Api-Key', prefix: '' } }) }) : json(200, { data: secret() });
    const code = await run('secrets', 'broker', ID, 'on', '--origin', ORIGIN, '--origin', 'https://b.service-x.example', '--header', 'X-Api-Key', '--prefix', 'none', '--field', 'key');
    expect(code).toBeUndefined();
    expect(patchOf().url).toBe(`https://vault.example.test/api/secrets/${ID}/broker-access`);
    expect(JSON.parse(patchOf().init.body as string)).toEqual({
      enabled: true,
      origins: [ORIGIN, 'https://b.service-x.example'],
      injection: { kind: 'header', name: 'X-Api-Key', prefix: '' },
      field: 'key',
    });
    const text = out.join('\n');
    expect(text).toContain('Broker: on for "api-key-example"');
    expect(text).toContain(BASE);
  });

  test('on with --query sends a query injection', async () => {
    responder = (_u, init) => (init.method === 'PATCH' ? json(200, { data: on() }) : json(200, { data: secret() }));
    await run('secrets', 'broker', 'api-key-example', 'on', '--origin', ORIGIN, '--query', 'api_key');
    expect(calls[0]!.url).toContain('/secrets/by-name/api-key-example');
    expect(JSON.parse(patchOf().init.body as string).injection).toEqual({ kind: 'query', name: 'api_key' });
  });

  test('on without origins and none stored fails locally', async () => {
    responder = () => json(200, { data: secret() });
    const code = await run('secrets', 'broker', ID, 'on');
    expect(code).toBe(1);
    expect(calls.some((c) => c.init.method === 'PATCH')).toBe(false);
    expect(err.join('\n')).toContain('at least one origin');
  });

  test('on without --origin reuses stored origins', async () => {
    responder = (_u, init) => (init.method === 'PATCH' ? json(200, { data: on() }) : json(200, { data: on() }));
    await run('secrets', 'broker', ID, 'on');
    expect(JSON.parse(patchOf().init.body as string)).toEqual({ enabled: true });
  });

  test('off sends only enabled:false and prints no URL', async () => {
    responder = (_u, init) => (init.method === 'PATCH' ? json(200, { data: secret() }) : json(200, { data: on() }));
    await run('secrets', 'broker', ID, 'off');
    expect(JSON.parse(patchOf().init.body as string)).toEqual({ enabled: false });
    expect(out.join('\n')).toContain('Broker: off');
    expect(out.join('\n')).not.toContain('/broker/v1/');
  });

  test('--json envelope carries baseUrls and no values', async () => {
    responder = () => json(200, { data: on() });
    await run('--json', 'secrets', 'broker', ID, 'on', '--origin', ORIGIN);
    const env = JSON.parse(out.join(''));
    expect(env.data.brokerAccess).toBe(true);
    expect(env.data.baseUrls).toEqual([BASE]);
    expect(env.data.values).toBeUndefined();
  });

  test.each([
    ['BROKER_UNSUPPORTED_TYPE', 'cannot be used through the broker'],
    ['BROKER_ORIGINS_REQUIRED', 'at least one origin'],
    ['BROKER_ORIGIN_INVALID', 'exact, public HTTPS origin'],
    ['BROKER_FIELD_INVALID', 'not a sensitive field'],
  ])('422 %s is mapped', async (code, text) => {
    responder = (_u, init) => (init.method === 'PATCH' ? json(422, { code, message: 'x' }) : json(200, { data: secret() }));
    expect(await run('secrets', 'broker', ID, 'on', '--origin', ORIGIN)).toBe(1);
    expect(err.join('\n')).toContain(text);
  });

  test('404 maps to not found; bad state and header+query fail without a call', async () => {
    responder = (_u, init) => (init.method === 'PATCH' ? json(404, { code: 'NOT_FOUND', message: 'n' }) : json(200, { data: secret() }));
    expect(await run('secrets', 'broker', ID, 'on', '--origin', ORIGIN)).toBe(1);
    expect(err.join('\n')).toContain('Not found (404)');
    calls.length = 0;
    expect(await run('secrets', 'broker', ID, 'maybe')).toBe(1);
    expect(await run('secrets', 'broker', ID, 'on', '--origin', ORIGIN, '--header', 'a', '--query', 'b')).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe('secrets list --broker and get output', () => {
  const page = { data: { items: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } } };
  test('on/off map to brokerAccess=true/false; omitted none; invalid fails', async () => {
    responder = () => json(200, page);
    await run('secrets', 'list', '--broker', 'on');
    expect(new URL(calls[0]!.url).searchParams.get('brokerAccess')).toBe('true');
    await run('secrets', 'list', '--broker', 'off');
    expect(new URL(calls[1]!.url).searchParams.get('brokerAccess')).toBe('false');
    await run('secrets', 'list');
    expect(new URL(calls[2]!.url).searchParams.has('brokerAccess')).toBe(false);
    calls.length = 0;
    expect(await run('secrets', 'list', '--broker', 'x')).toBe(1);
    expect(calls).toHaveLength(0);
  });

  test('get --json keeps the broker fields', async () => {
    responder = () => json(200, { data: on({ brokerField: 'key' }) });
    await run('--json', 'secrets', 'get', ID);
    const env = JSON.parse(out.join(''));
    expect(env.data.brokerAccess).toBe(true);
    expect(env.data.brokerOrigins).toEqual([ORIGIN]);
    expect(env.data.brokerField).toBe('key');
  });

  test('detail shows broker state and injection; table has a Broker column', () => {
    formatSecretDetail(on({ brokerInjection: { kind: 'query', name: 'api_key' } }) as never);
    const text = out.join('\n');
    expect(text).toMatch(/Broker.*on/);
    expect(text).toContain(ORIGIN);
    expect(text).toContain('query ?api_key=');
    out.length = 0;
    formatSecretDetail(secret() as never);
    expect(out.join('\n')).toMatch(/Broker.*off/);
    out.length = 0;
    formatSecretTable({ items: [on() as never], meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } } as never);
    expect(out.join('\n')).toContain('Broker');
  });
});

describe('broker url', () => {
  test('prints one URL per origin, or the chosen one', async () => {
    responder = () => json(200, { data: on({ brokerOrigins: [ORIGIN, 'https://b.service-x.example'] }) });
    await run('broker', 'url', ID);
    expect(out.join('\n')).toContain(BASE);
    expect(out.join('\n')).toContain(`/${ID}/b.service-x.example`);
    out.length = 0;
    await run('broker', 'url', ID, '--origin', 'https://B.service-x.example/');
    expect(out.join('\n')).not.toContain('api.service-x.example');
    expect(out.join('\n')).toContain('b.service-x.example');
  });
  test('fails when off or the origin is not allowed', async () => {
    responder = () => json(200, { data: secret() });
    expect(await run('broker', 'url', ID)).toBe(1);
    responder = () => json(200, { data: on() });
    expect(await run('broker', 'url', ID, '--origin', 'https://other.example')).toBe(1);
  });
});

describe('broker token', () => {
  const tok = {
    id: 'tok-1', name: 'agent', tokenPrefix: 'vbk_abcdefgh', secretIds: [ID], expiresAt: '2027-01-01T00:00:00Z',
    lastUsedAt: null, revokedAt: null, createdAt: '2026-01-01T00:00:00Z',
  };

  test('create resolves --secret, sends days, prints the token once with a warning', async () => {
    responder = (url, init) =>
      init.method === 'POST' ? json(201, { data: { ...tok, token: 'vbk_' + 'a'.repeat(40) } }) : json(200, { data: secret() });
    await run('broker', 'token', 'create', '--name', 'agent', '--expires', '30d', '--secret', 'api-key-example');
    const post = calls.find((c) => c.init.method === 'POST')!;
    expect(post.url).toBe('https://vault.example.test/api/broker/tokens');
    expect(JSON.parse(post.init.body as string)).toEqual({ name: 'agent', expiresInDays: 30, secretIds: [ID] });
    const text = out.join('\n') + err.join('\n');
    expect(text).toContain('vbk_' + 'a'.repeat(40));
    expect(text).toContain('shown once');
  });

  test('create defaults to 90 days and --json returns the token', async () => {
    responder = () => json(201, { data: { ...tok, secretIds: [], token: 'vbk_' + 'b'.repeat(40) } });
    await run('--json', 'broker', 'token', 'create', '--name', 'agent');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ name: 'agent', expiresInDays: 90 });
    expect(JSON.parse(out.join('')).data.token).toBe('vbk_' + 'b'.repeat(40));
  });

  test('create maps BROKER_TOKEN_SECRET_INVALID and rejects a bad --expires', async () => {
    responder = (_u, init) => (init.method === 'POST' ? json(422, { code: 'BROKER_TOKEN_SECRET_INVALID', message: 'x' }) : json(200, { data: secret() }));
    expect(await run('broker', 'token', 'create', '--name', 'a', '--secret', ID)).toBe(1);
    expect(err.join('\n')).toContain('broker on');
    calls.length = 0;
    expect(await run('broker', 'token', 'create', '--name', 'a', '--expires', '0')).toBe(1);
    expect(calls).toHaveLength(0);
  });

  test('list never shows a token and --json is the array', async () => {
    responder = () => json(200, { data: [tok] });
    await run('broker', 'token', 'list');
    expect(out.join('\n')).toContain('vbk_abcdefgh');
    out.length = 0;
    await run('--json', 'broker', 'token', 'list');
    expect(JSON.parse(out.join('')).data).toHaveLength(1);
  });

  test('revoke --yes posts; without --yes and no terminal it refuses', async () => {
    responder = () => json(200, { data: { ok: true } });
    await run('broker', 'token', 'revoke', 'tok-1', '--yes');
    expect(calls[0]!.url).toBe('https://vault.example.test/api/broker/tokens/tok-1/revoke');
    expect(calls[0]!.init.method).toBe('POST');
    calls.length = 0;
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    expect(await run('broker', 'token', 'revoke', 'tok-1')).toBe(1);
    Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    expect(calls).toHaveLength(0);
  });

  test('revoke 404 is mapped', async () => {
    responder = () => json(404, { code: 'NOT_FOUND', message: 'n' });
    expect(await run('broker', 'token', 'revoke', 'nope', '--yes')).toBe(1);
    expect(err.join('\n')).toContain('Not found (404)');
  });
});
