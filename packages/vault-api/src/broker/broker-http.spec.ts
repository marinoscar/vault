import { applyInjection, containsKey, echoNeedles, filterRequestHeaders, filterResponseHeaders, injectedHeaderValue } from './broker-http';

const KEY = 'sk-Test_Key+/=value 1';

describe('filterRequestHeaders (ADR-0006 decision 8)', () => {
  it('drops credentials, connection and proxy headers and keeps the rest', () => {
    const out = filterRequestHeaders({
      authorization: 'Bearer vbk_x', Cookie: 'a=b', host: 'vault.example.test', 'Proxy-Authorization': 'x', 'proxy-connection': 'x',
      forwarded: 'for=1', 'x-forwarded-for': '1.1.1.1', 'x-forwarded-host': 'h', 'x-real-ip': '1.1.1.1', 'x-vault-anything': '1',
      connection: 'keep-alive', 'keep-alive': 'x', te: 'trailers', trailer: 'x', 'transfer-encoding': 'chunked', upgrade: 'websocket',
      'content-length': '12', expect: '100-continue', 'accept-encoding': 'gzip',
      'content-type': 'application/json', accept: 'application/json', 'user-agent': 'sdk/1', 'x-custom-api': 'v', 'anthropic-version': '2023-06-01',
    });
    expect(Object.keys(out).sort()).toEqual(['accept', 'anthropic-version', 'content-type', 'user-agent', 'x-custom-api']);
  });
});

describe('filterResponseHeaders', () => {
  it('drops Set-Cookie, hop-by-hop, framing and X-Vault headers and keeps Location and content type', () => {
    const out = filterResponseHeaders({
      'set-cookie': ['a=b'], 'set-cookie2': 'x', connection: 'close', 'keep-alive': 'x', 'transfer-encoding': 'chunked', upgrade: 'h2c',
      'content-length': '5', 'content-encoding': 'gzip', 'proxy-authenticate': 'x', 'x-vault-broker': '0',
      location: 'https://other.example/x', 'content-type': 'text/plain', 'x-request-id': 'r1',
    });
    expect(Object.keys(out).sort()).toEqual(['content-type', 'location', 'x-request-id']);
  });
});

describe('injection', () => {
  it('builds the header value for each prefix, encoding Basic', () => {
    expect(injectedHeaderValue({ kind: 'header', name: 'Authorization', prefix: 'Bearer' }, 'k')).toBe('Bearer k');
    expect(injectedHeaderValue({ kind: 'header', name: 'Authorization', prefix: 'Token' }, 'k')).toBe('Token k');
    expect(injectedHeaderValue({ kind: 'header', name: 'Authorization', prefix: 'Bot' }, 'k')).toBe('Bot k');
    expect(injectedHeaderValue({ kind: 'header', name: 'Authorization', prefix: 'ApiKey' }, 'k')).toBe('ApiKey k');
    expect(injectedHeaderValue({ kind: 'header', name: 'X-Api-Key' }, 'k')).toBe('k');
    expect(injectedHeaderValue({ kind: 'header', name: 'X-Api-Key', prefix: '' }, 'k')).toBe('k');
    expect(injectedHeaderValue({ kind: 'header', name: 'Authorization', prefix: 'Basic' }, 'user:pw')).toBe(`Basic ${Buffer.from('user:pw').toString('base64')}`);
  });

  it('sets the header last, replacing any header of that name whatever its case', () => {
    const out = applyInjection({ kind: 'header', name: 'X-Api-Key' }, KEY, { 'x-api-key': 'caller-chose', accept: 'a' }, 'a=1');
    expect(out.headers).toEqual({ accept: 'a', 'x-api-key': KEY });
    expect(out.query).toBe('a=1');
    expect(out.injected).toBe(KEY);
  });

  it('refuses to inject into a forbidden header even if one reached it', () => {
    expect(() => applyInjection({ kind: 'header', name: 'Host' } as never, KEY, {}, '')).toThrow();
  });

  it('adds the query parameter percent-encoded and removes any caller parameter of that name', () => {
    const out = applyInjection({ kind: 'query', name: 'api_key' }, KEY, {}, 'q=1&api_key=caller&API_KEY=keep&%61pi_key=also&z=2');
    expect(out.query).toBe(`q=1&API_KEY=keep&z=2&api_key=${encodeURIComponent(KEY)}`);
    expect(out.injected).toBe(`api_key=${encodeURIComponent(KEY)}`);
    expect(applyInjection({ kind: 'query', name: 'k' }, 'v', {}, '').query).toBe('k=v');
  });
});

describe('echo scan (ADR-0006 decision 9)', () => {
  const needles = echoNeedles(KEY, `Bearer ${KEY}`);
  const body = (text: string) => Buffer.from(text, 'utf8');

  it('finds the key raw, base64 (standard, url-safe, unpadded), percent-encoded in either case and as the injected value', () => {
    const forms = [
      KEY,
      Buffer.from(KEY).toString('base64'),
      Buffer.from(KEY).toString('base64').replace(/=+$/, ''),
      Buffer.from(KEY).toString('base64url'),
      encodeURIComponent(KEY),
      encodeURIComponent(KEY).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
      `Bearer ${KEY}`,
      Buffer.from(`Bearer ${KEY}`).toString('base64'),
    ];
    for (const form of forms) expect(containsKey(needles, {}, body(`{"echo":"${form}"}`))).toBe(true);
  });

  it('finds the key in any header, including Set-Cookie and a header NAME', () => {
    expect(containsKey(needles, { 'x-debug': `got ${KEY}` }, body('ok'))).toBe(true);
    expect(containsKey(needles, { 'set-cookie': [`s=${KEY}`] }, body('ok'))).toBe(true);
    expect(containsKey(needles, { [`x-${KEY.slice(0, 8)}`]: 'v' }, body('ok'))).toBe(false);
  });

  it('finds the Basic credential in its encoded form', () => {
    const basic = injectedHeaderValue({ kind: 'header', name: 'Authorization', prefix: 'Basic' }, 'user:pw');
    const basicNeedles = echoNeedles('user:pw', basic);
    expect(containsKey(basicNeedles, {}, body(`x ${Buffer.from('user:pw').toString('base64')} y`))).toBe(true);
    expect(containsKey(basicNeedles, {}, body(basic))).toBe(true);
  });

  it('does not flag an unrelated response', () => {
    expect(containsKey(needles, { 'content-type': 'application/json', 'x-request-id': 'abc' }, body('{"ok":true,"id":"msg_01"}'))).toBe(false);
  });
});
