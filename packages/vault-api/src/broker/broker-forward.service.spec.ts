import { HttpException } from '@nestjs/common';
import { responseHeadersOf } from '@marinoscar/platform-api/core';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { InMemoryAgentRateLimiter } from '../agent/agent-rate-limiter';
import { InMemoryAudit, TestCrypto } from '../testing';
import { BROKER_FORWARD_OPTIONS, BrokerForwardService, type BrokerCaller, type BrokerForwardRequest } from './broker-forward.service';
import { BrokerResolver, BrokerUpstream, BrokerUpstreamFailure, type BrokerUpstreamRequest, type BrokerUpstreamResponse } from './broker-upstream';

const KEY = 'sk-live-Canary_9f3a7c1e2b4d';
const OWNER = 'user-aaa';
const SECRET = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const HOST = 'api.service-x.example';
const PUBLIC_ADDRESS = { address: '93.184.216.34', family: 4 as const };

const apiKeyType = { id: 't1', name: 'API Key', isSystem: true, fields: [{ name: 'key', type: 'string', sensitive: true }, { name: 'provider', type: 'string', sensitive: false }] };

class FakeResolver extends BrokerResolver {
  calls: string[] = [];
  answer: () => Promise<Array<{ address: string; family: 4 | 6 }>> = async () => [PUBLIC_ADDRESS];
  async resolveAll(hostname: string) {
    this.calls.push(hostname);
    return this.answer();
  }
}

class FakeUpstream extends BrokerUpstream {
  calls: BrokerUpstreamRequest[] = [];
  answer: (req: BrokerUpstreamRequest) => Promise<BrokerUpstreamResponse> = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}') });
  async send(req: BrokerUpstreamRequest) {
    this.calls.push(req);
    // Like the real connector: an error on the request body stream fails the call.
    if (req.body) {
      await new Promise<void>((resolve, reject) => {
        req.body!.on('error', reject);
        req.body!.on('end', resolve);
        req.body!.on('data', () => undefined);
      });
    }
    return this.answer(req);
  }
}

function setup(over: { settings?: Record<string, unknown>; secret?: Record<string, unknown> | null; options?: { allowLoopbackForTests?: boolean } } = {}) {
  const crypto = new TestCrypto();
  const encrypted = crypto.encrypt(JSON.stringify({ key: KEY, provider: 'Provider X' }));
  const secretRow = over.secret === null ? null : { id: SECRET, createdById: OWNER, brokerAccess: true, brokerOrigins: [`https://${HOST}`], brokerInjection: null, brokerField: null, type: apiKeyType, ...(over.secret ?? {}) };
  const prisma = {
    secret: { findFirst: jest.fn().mockResolvedValue(secretRow) },
    secretVersion: { findFirst: jest.fn().mockResolvedValue({ encryptedData: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag }) },
  };
  const decrypt = jest.spyOn(crypto, 'decrypt');
  const settings = { getNamespace: jest.fn().mockResolvedValue({ enabled: true, broker: { enabled: true }, ...(over.settings ?? {}) }), getSettings: jest.fn() };
  const audit = new InMemoryAudit();
  const limiter = new InMemoryAgentRateLimiter();
  const resolver = new FakeResolver();
  const upstream = new FakeUpstream();
  const service = new BrokerForwardService(prisma as never, crypto, settings as never, audit, limiter, resolver, upstream, over.options);
  const caller: BrokerCaller = { kind: 'broker', userId: OWNER, tokenId: 'tok-1', secretIds: [] };
  const request = (r: Partial<BrokerForwardRequest> = {}): BrokerForwardRequest => ({
    caller, secretId: SECRET, upstreamHost: HOST, path: '/v1/messages', query: '', method: 'POST', headers: { 'content-type': 'application/json' }, body: undefined, ...r,
  });
  return { service, prisma, decrypt, settings, audit, limiter, resolver, upstream, caller, request };
}

async function refusal(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}
const codeOf = (e: HttpException) => (e.getResponse() as { code?: string }).code;

describe('BrokerForwardService: the happy path', () => {
  it('adds the key as Authorization: Bearer, pins the validated address, resolves once and returns the raw response', async () => {
    const t = setup();
    const result = await t.service.forward(t.request({ headers: { 'content-type': 'application/json', authorization: 'Bearer vbk_caller', cookie: 'a=b', 'x-custom': 'keep' } }));
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe('{"ok":true}');
    expect(result.headers).toMatchObject({ 'content-type': 'application/json', 'x-vault-broker': '1' });

    expect(t.resolver.calls).toEqual([HOST]);
    expect(t.upstream.calls).toHaveLength(1);
    const sent = t.upstream.calls[0]!;
    expect(sent).toMatchObject({ hostname: HOST, port: 443, address: PUBLIC_ADDRESS.address, family: 4, method: 'POST', path: '/v1/messages' });
    expect(sent.headers).toEqual({ 'content-type': 'application/json', 'x-custom': 'keep', authorization: `Bearer ${KEY}`, 'accept-encoding': 'identity' });
  });

  it('injects into a custom header, a query parameter, and Basic, as the owner configured', async () => {
    const header = setup({ secret: { brokerInjection: { kind: 'header', name: 'X-Api-Key' } } });
    await header.service.forward(header.request({ headers: { 'x-api-key': 'caller-chose' } }));
    expect(header.upstream.calls[0]!.headers).toMatchObject({ 'x-api-key': KEY });
    expect(header.upstream.calls[0]!.headers.authorization).toBeUndefined();

    const query = setup({ secret: { brokerInjection: { kind: 'query', name: 'api_key' } } });
    await query.service.forward(query.request({ method: 'GET', query: 'q=1&api_key=caller' }));
    expect(query.upstream.calls[0]!.path).toBe(`/v1/messages?q=1&api_key=${encodeURIComponent(KEY)}`);

    const basicKey = 'user:pw';
    const crypto = new TestCrypto();
    const enc = crypto.encrypt(JSON.stringify({ key: basicKey }));
    const basic = setup({ secret: { brokerInjection: { kind: 'header', name: 'Authorization', prefix: 'Basic' } } });
    basic.prisma.secretVersion.findFirst.mockResolvedValue({ encryptedData: enc.ciphertext, iv: enc.iv, authTag: enc.authTag });
    (basic.service as unknown as { crypto: TestCrypto }).crypto = crypto;
    await basic.service.forward(basic.request());
    expect(basic.upstream.calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(basicKey).toString('base64')}`);
  });

  it('uses the origin port, and matches the host without regard to case', async () => {
    const t = setup({ secret: { brokerOrigins: [`https://${HOST}:8443`] } });
    await t.service.forward(t.request({ upstreamHost: `${HOST.toUpperCase()}:8443` }));
    expect(t.upstream.calls[0]).toMatchObject({ hostname: HOST, port: 8443 });
  });

  it('forwards the request body as a counted stream and records its size', async () => {
    const t = setup();
    await t.service.forward(t.request({ body: Readable.from([Buffer.from('{"hello":'), Buffer.from('"world"}')]), headers: { 'content-type': 'application/json', 'content-length': '17' } }));
    expect(t.upstream.calls[0]!.headers['content-length']).toBe('17');
    expect(t.audit.events[0]!.meta).toMatchObject({ requestBytes: 17 });
  });

  it('returns a redirect as it is, Location included, and sends exactly one request', async () => {
    const t = setup();
    t.upstream.answer = async () => ({ status: 302, headers: { location: 'https://elsewhere.example.test/next', 'set-cookie': ['s=1'] }, body: Buffer.alloc(0) });
    const result = await t.service.forward(t.request({ method: 'GET' }));
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('https://elsewhere.example.test/next');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(t.upstream.calls).toHaveLength(1);
    expect(t.resolver.calls).toHaveLength(1);
  });

  it('decodes a gzip response (so it can be scanned) and drops the encoding header', async () => {
    const t = setup();
    t.upstream.answer = async () => ({ status: 200, headers: { 'content-encoding': 'gzip', 'content-type': 'text/plain' }, body: gzipSync(Buffer.from('plain answer')) });
    const result = await t.service.forward(t.request());
    expect(result.body.toString()).toBe('plain answer');
    expect(result.headers['content-encoding']).toBeUndefined();
  });

  it('records a PAT caller as such', async () => {
    const t = setup();
    await t.service.forward(t.request({ caller: { kind: 'pat', userId: OWNER, tokenId: 'pat-1', secretIds: [] } }));
    expect(t.audit.events[0]!.meta).toMatchObject({ credential: 'pat', tokenId: 'pat-1' });
  });
});

describe('BrokerForwardService: the order of checks (ADR-0006 decision 7)', () => {
  it.each([
    ['agentAccess.enabled off', { enabled: false, broker: { enabled: true } }],
    ['agentAccess.broker.enabled off', { enabled: true, broker: { enabled: false } }],
    ['the broker block missing (default off)', { enabled: true }],
    ['both off', {}],
  ])('%s: 403 BROKER_DISABLED before anything is looked up, resolved or decrypted', async (_label, settings) => {
    const t = setup({ settings: { enabled: false, broker: undefined, ...settings } });
    const error = await refusal(t.service.forward(t.request()));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('BROKER_DISABLED');
    expect(t.prisma.secret.findFirst).not.toHaveBeenCalled();
    expect(t.resolver.calls).toHaveLength(0);
    expect(t.decrypt).not.toHaveBeenCalled();
    expect(t.upstream.calls).toHaveLength(0);
    expect(t.audit.events).toHaveLength(1);
    expect(t.audit.events[0]!.meta).toMatchObject({ result: 'denied:disabled', outcome: 'denied' });
  });

  it('the rate limit comes before the lookup: 429 RATE_LIMITED with Retry-After, own bucket per token', async () => {
    const t = setup({ settings: { enabled: true, broker: { enabled: true, forwardsPerMinute: 2 } } });
    await t.service.forward(t.request());
    await t.service.forward(t.request());
    const lookups = t.prisma.secret.findFirst.mock.calls.length;
    const dns = t.resolver.calls.length;
    const error = await refusal(t.service.forward(t.request()));
    expect(error.getStatus()).toBe(429);
    expect(codeOf(error)).toBe('RATE_LIMITED');
    expect(Number(responseHeadersOf(error, {})['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(t.prisma.secret.findFirst.mock.calls.length).toBe(lookups);
    expect(t.resolver.calls.length).toBe(dns);
    expect(t.audit.events.at(-1)!.meta).toMatchObject({ result: 'denied:rate_limited' });
    // another token has its own bucket
    await t.service.forward(t.request({ caller: { ...t.caller, tokenId: 'tok-2' } }));
  });

  it('every way the secret can be unavailable is the SAME 404, with no DNS and no decryption', async () => {
    const cases: Array<[string, ReturnType<typeof setup>, Partial<BrokerForwardRequest>]> = [
      ['missing or foreign or broker off (the query filters on all three)', setup({ secret: null }), {}],
      ['an unsupported type', setup({ secret: { type: { name: 'Credential', isSystem: true, fields: [{ name: 'password', sensitive: true }] } } }), {}],
      ['a corrupt injection', setup({ secret: { brokerInjection: { kind: 'header', name: 'Host' } } }), {}],
      ['not a uuid', setup(), { secretId: 'not-a-uuid' }],
    ];
    const restricted = setup();
    cases.push(['outside the token restriction', restricted, { caller: { ...restricted.caller, secretIds: ['00000000-0000-4000-8000-000000000001'] } }]);

    const bodies: unknown[] = [];
    for (const [label, t, over] of cases) {
      const error = await refusal(t.service.forward(t.request(over)));
      expect([label, error.getStatus()]).toEqual([label, 404]);
      bodies.push(error.getResponse());
      expect(t.resolver.calls).toHaveLength(0);
      expect(t.decrypt).not.toHaveBeenCalled();
      expect(t.upstream.calls).toHaveLength(0);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('looks the secret up by owner and broker flag', async () => {
    const t = setup();
    await t.service.forward(t.request());
    expect(t.prisma.secret.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: SECRET, createdById: OWNER, brokerAccess: true } }));
  });

  it.each([
    ['another host', 'other.service-x.example'],
    ['a subdomain', `v2.${HOST}`],
    ['a parent', 'service-x.example'],
    ['another port', `${HOST}:8443`],
    ['userinfo', `user@${HOST}`],
    ['an encoded slash trick', `${HOST}%2F@evil.example`],
    ['a prefix match', `${HOST}.evil.example`],
    ['an IP literal', '93.184.216.34'],
  ])('refuses %s: 403 BROKER_ORIGIN_MISMATCH before any DNS or decryption', async (_label, upstreamHost) => {
    const t = setup();
    const error = await refusal(t.service.forward(t.request({ upstreamHost })));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('BROKER_ORIGIN_MISMATCH');
    expect(t.resolver.calls).toHaveLength(0);
    expect(t.decrypt).not.toHaveBeenCalled();
    expect(t.upstream.calls).toHaveLength(0);
  });

  it('the announced request size is refused before DNS and decryption', async () => {
    const t = setup({ settings: { enabled: true, broker: { enabled: true, maxRequestBytes: 10 } } });
    const error = await refusal(t.service.forward(t.request({ headers: { 'content-length': '11' } })));
    expect(error.getStatus()).toBe(413);
    expect(codeOf(error)).toBe('BROKER_REQUEST_TOO_LARGE');
    expect(t.resolver.calls).toHaveLength(0);
    expect(t.decrypt).not.toHaveBeenCalled();
  });
});

describe('BrokerForwardService: SSRF controls (ADR-0006 decision 8)', () => {
  it.each([
    [['93.184.216.34', '10.0.0.5'], 'one private address among public ones'],
    [['169.254.169.254'], 'cloud metadata'],
    [['127.0.0.1'], 'loopback'],
    [['::1'], 'IPv6 loopback'],
    [['::ffff:10.0.0.1'], 'IPv4-mapped private'],
    [['64:ff9b::a00:1'], 'NAT64 private'],
    [['fe80::1'], 'IPv6 link-local'],
    [['100.64.1.1'], 'CGNAT'],
    [['192.168.1.1', '8.8.8.8'], 'a private address second'],
  ])('refuses %j (%s) with 403 BROKER_DESTINATION_BLOCKED and decrypts nothing', async (addresses) => {
    const t = setup();
    t.resolver.answer = async () => addresses.map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }));
    const error = await refusal(t.service.forward(t.request()));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('BROKER_DESTINATION_BLOCKED');
    expect(t.decrypt).not.toHaveBeenCalled();
    expect(t.upstream.calls).toHaveLength(0);
    expect(t.resolver.calls).toHaveLength(1);
    expect(t.audit.events[0]!.meta).toMatchObject({ result: 'denied:destination_blocked' });
  });

  it('connects to the first validated address, from ONE resolution (a rebinding second answer is never asked for)', async () => {
    const t = setup();
    let n = 0;
    t.resolver.answer = async () => (n++ === 0 ? [PUBLIC_ADDRESS] : [{ address: '127.0.0.1', family: 4 }]);
    await t.service.forward(t.request());
    expect(t.resolver.calls).toHaveLength(1);
    expect(t.upstream.calls[0]!.address).toBe(PUBLIC_ADDRESS.address);
  });

  it('an unresolvable name is 502 BROKER_UPSTREAM_ERROR; a resolver that hangs is 504', async () => {
    const gone = setup();
    gone.resolver.answer = async () => { throw new Error('ENOTFOUND api.service-x.example 10.1.2.3'); };
    const e1 = await refusal(gone.service.forward(gone.request()));
    expect([e1.getStatus(), codeOf(e1)]).toEqual([502, 'BROKER_UPSTREAM_ERROR']);
    expect(JSON.stringify(e1.getResponse())).not.toMatch(/10\.1\.2\.3|ENOTFOUND/);

    const empty = setup();
    empty.resolver.answer = async () => [];
    expect(codeOf(await refusal(empty.service.forward(empty.request())))).toBe('BROKER_UPSTREAM_ERROR');

    const slow = setup({ settings: { enabled: true, broker: { enabled: true, timeoutMs: 1000 } } });
    slow.resolver.answer = () => new Promise(() => undefined);
    const e2 = await refusal(slow.service.forward(slow.request()));
    expect([e2.getStatus(), codeOf(e2)]).toEqual([504, 'BROKER_UPSTREAM_TIMEOUT']);
  });

  it('the loopback allowance exists only through the explicit option, and only for loopback', async () => {
    const off = setup();
    off.resolver.answer = async () => [{ address: '127.0.0.1', family: 4 }];
    expect(codeOf(await refusal(off.service.forward(off.request())))).toBe('BROKER_DESTINATION_BLOCKED');

    const on = setup({ options: { allowLoopbackForTests: true } });
    on.resolver.answer = async () => [{ address: '127.0.0.1', family: 4 }];
    expect((await on.service.forward(on.request())).status).toBe(200);

    const stillBlocked = setup({ options: { allowLoopbackForTests: true } });
    stillBlocked.resolver.answer = async () => [{ address: '169.254.169.254', family: 4 }];
    expect(codeOf(await refusal(stillBlocked.service.forward(stillBlocked.request())))).toBe('BROKER_DESTINATION_BLOCKED');
  });

  it('the options token is not part of the package\'s public broker entry point', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const entry = require('./index') as Record<string, unknown>;
    expect(entry.BROKER_FORWARD_OPTIONS).toBeUndefined();
    expect(typeof BROKER_FORWARD_OPTIONS).toBe('symbol');
  });
});

describe('BrokerForwardService: caps and failures', () => {
  it('a request body above the cap is 413 and the upstream call is abandoned', async () => {
    const t = setup({ settings: { enabled: true, broker: { enabled: true, maxRequestBytes: 8 } } });
    const error = await refusal(t.service.forward(t.request({ body: Readable.from([Buffer.from('12345'), Buffer.from('67890')]) })));
    expect([error.getStatus(), codeOf(error)]).toEqual([413, 'BROKER_REQUEST_TOO_LARGE']);
    expect(t.audit.events[0]!.meta).toMatchObject({ result: 'denied:request_too_large' });
  });

  it.each([
    ['a response above the cap', () => new BrokerUpstreamFailure('too_large'), 502, 'BROKER_RESPONSE_TOO_LARGE'],
    ['a timeout', () => new BrokerUpstreamFailure('timeout'), 504, 'BROKER_UPSTREAM_TIMEOUT'],
    ['a connection failure', () => new BrokerUpstreamFailure('error'), 502, 'BROKER_UPSTREAM_ERROR'],
    ['an unexpected error naming an address', () => new Error('connect ECONNREFUSED 10.0.0.9:443'), 502, 'BROKER_UPSTREAM_ERROR'],
  ])('maps %s to %i %s with no internal detail', async (_label, failure, status, code) => {
    const t = setup();
    t.upstream.answer = async () => { throw failure(); };
    const error = await refusal(t.service.forward(t.request()));
    expect([error.getStatus(), codeOf(error)]).toEqual([status, code]);
    expect(JSON.stringify(error.getResponse())).not.toMatch(/10\.0\.0\.9|ECONNREFUSED/);
  });

  it('a decoded response above the cap is 502 BROKER_RESPONSE_TOO_LARGE (a compression bomb)', async () => {
    const t = setup({ settings: { enabled: true, broker: { enabled: true, maxResponseBytes: 1000 } } });
    t.upstream.answer = async () => ({ status: 200, headers: { 'content-encoding': 'gzip' }, body: gzipSync(Buffer.alloc(100_000, 97)) });
    expect(codeOf(await refusal(t.service.forward(t.request())))).toBe('BROKER_RESPONSE_TOO_LARGE');
  });

  it('an encoding it cannot decode (so cannot scan) fails closed', async () => {
    const t = setup();
    t.upstream.answer = async () => ({ status: 200, headers: { 'content-encoding': 'zstd' }, body: Buffer.from('xx') });
    expect(codeOf(await refusal(t.service.forward(t.request())))).toBe('BROKER_UPSTREAM_ERROR');
  });

  it('a secret with no value in its field is 422 BROKER_KEY_MISSING and sends nothing', async () => {
    const t = setup();
    const crypto = new TestCrypto();
    const enc = crypto.encrypt(JSON.stringify({ key: '', provider: 'x' }));
    t.prisma.secretVersion.findFirst.mockResolvedValue({ encryptedData: enc.ciphertext, iv: enc.iv, authTag: enc.authTag });
    (t.service as unknown as { crypto: TestCrypto }).crypto = crypto;
    const error = await refusal(t.service.forward(t.request()));
    expect([error.getStatus(), codeOf(error)]).toEqual([422, 'BROKER_KEY_MISSING']);
    expect(t.upstream.calls).toHaveLength(0);
  });
});

describe('BrokerForwardService: the key never comes back (no echo)', () => {
  const echoes: Array<[string, (key: string) => Partial<BrokerUpstreamResponse>]> = [
    ['in the body', (k) => ({ body: Buffer.from(`{"received":"${k}"}`) })],
    ['base64 in the body', (k) => ({ body: Buffer.from(`x ${Buffer.from(k).toString('base64')} y`) })],
    ['unpadded base64 in the body', (k) => ({ body: Buffer.from(Buffer.from(k).toString('base64').replace(/=+$/, '')) })],
    ['percent-encoded in the body', (k) => ({ body: Buffer.from(`?key=${encodeURIComponent(k)}`) })],
    ['the whole injected header value', (k) => ({ body: Buffer.from(`Authorization: Bearer ${k}`) })],
    ['in a header', (k) => ({ headers: { 'x-debug-auth': k } })],
    ['in Set-Cookie', (k) => ({ headers: { 'set-cookie': [`session=${k}`] } })],
    ['in Location', (k) => ({ status: 302, headers: { location: `https://x.example/?k=${k}` } })],
    ['in a gzip body', (k) => ({ headers: { 'content-encoding': 'gzip' }, body: gzipSync(Buffer.from(`echo ${k}`)) })],
  ];

  it.each(echoes)('withholds a response that has the key %s: 502 BROKER_KEY_ECHO, audited, nothing returned', async (_label, build) => {
    const t = setup();
    t.upstream.answer = async () => ({ status: 200, headers: {}, body: Buffer.from('clean'), ...build(KEY) });
    const error = await refusal(t.service.forward(t.request()));
    expect([error.getStatus(), codeOf(error)]).toEqual([502, 'BROKER_KEY_ECHO']);
    expect(JSON.stringify(error.getResponse())).not.toContain(KEY);
    expect(t.audit.events).toHaveLength(1);
    expect(t.audit.events[0]!.meta).toMatchObject({ result: 'denied:key_echo', outcome: 'denied' });
    expect(JSON.stringify(t.audit.events)).not.toContain(KEY);
  });

  it('a clean response passes, with the broker header', async () => {
    const t = setup();
    expect((await t.service.forward(t.request())).headers['x-vault-broker']).toBe('1');
  });
});

describe('BrokerForwardService: the audit trail', () => {
  it('records ids, origin, method, path WITHOUT the query, status, sizes and timing, and never the key, body, query or headers', async () => {
    const t = setup();
    const query = 'token=QUERY-CANARY-77&a=1';
    await t.service.forward(t.request({
      path: '/v1/things/42', query, headers: { 'content-type': 'application/json', 'x-secret-header': 'HEADER-CANARY-88', 'content-length': '19' },
      body: Readable.from([Buffer.from('{"v":"BODY-CANARY-99"}')]),
    }));
    expect(t.audit.events).toHaveLength(1);
    const event = t.audit.events[0]!;
    expect(event).toMatchObject({ actorUserId: OWNER, action: 'broker.forward', targetType: 'secret', targetId: SECRET });
    expect(event.meta).toEqual({
      result: 'ok', outcome: 'forwarded', reason: null, credential: 'broker', tokenId: 'tok-1', secretId: SECRET,
      origin: `https://${HOST}`, method: 'POST', path: '/v1/things/42', status: 200, requestBytes: 22, responseBytes: 11, durationMs: expect.any(Number),
    });
    const text = JSON.stringify(t.audit.events);
    for (const canary of [KEY, 'QUERY-CANARY-77', 'HEADER-CANARY-88', 'BODY-CANARY-99', 'vbk_']) expect(text).not.toContain(canary);
  });

  it('refusals are audited too, once each, with their reason', async () => {
    const t = setup();
    await refusal(t.service.forward(t.request({ upstreamHost: 'evil.example' })));
    expect(t.audit.events).toHaveLength(1);
    expect(t.audit.events[0]!.meta).toMatchObject({ result: 'denied:origin_mismatch', status: null, secretId: SECRET });

    const t2 = setup({ secret: null });
    await refusal(t2.service.forward(t2.request()));
    expect(t2.audit.events[0]!.meta).toMatchObject({ result: 'denied:not_found' });
  });

  it('an unwritable trail fails a success closed, and does not mask a refusal', async () => {
    const t = setup();
    jest.spyOn(t.audit, 'record').mockRejectedValue(new Error('db down'));
    await expect(t.service.forward(t.request())).rejects.toThrow('db down');

    const refused = setup();
    jest.spyOn(refused.audit, 'record').mockRejectedValue(new Error('db down'));
    expect(codeOf(await refusal(refused.service.forward(refused.request({ upstreamHost: 'evil.example' }))))).toBe('BROKER_ORIGIN_MISMATCH');
  });
});
