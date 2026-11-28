import { normalizeBrokerOrigin, originOfUpstreamHost } from './broker-origin';

describe('normalizeBrokerOrigin (ADR-0006 decision 4)', () => {
  it.each([
    ['https://api.service-x.example', 'https://api.service-x.example'],
    ['https://API.Service-X.example', 'https://api.service-x.example'],
    ['https://api.service-x.example/', 'https://api.service-x.example'],
    ['https://api.service-x.example:443', 'https://api.service-x.example'],
    ['https://api.service-x.example:8443', 'https://api.service-x.example:8443'],
    ['https://93.184.216.34', 'https://93.184.216.34'],
    ['  https://a.example  ', 'https://a.example'],
  ])('accepts %s as %s', (raw, expected) => {
    const result = normalizeBrokerOrigin(raw);
    expect(result.ok && result.origin).toBe(expected);
  });

  it.each([
    ['http://api.service-x.example', 'not https'],
    ['ftp://a.example', 'other scheme'],
    ['api.service-x.example', 'no scheme'],
    ['https://user@api.service-x.example', 'userinfo'],
    ['https://user:pw@api.service-x.example', 'userinfo with password'],
    ['https://api.service-x.example/v1', 'path'],
    ['https://api.service-x.example/v1/', 'path with slash'],
    ['https://api.service-x.example?x=1', 'query'],
    ['https://api.service-x.example#frag', 'fragment'],
    ['https://api.service-x.example\\@evil.example', 'backslash trick'],
    ['https://api.service-x.example@evil.example', 'at trick'],
    ['https://*.service-x.example', 'wildcard'],
    ['https://localhost', 'localhost'],
    ['https://LOCALHOST:8443', 'localhost with port'],
    ['https://app.localhost', '.localhost'],
    ['https://printer.local', '.local'],
    ['https://db.internal', '.internal'],
    ['https://intranet', 'single label'],
    ['https://api.service-x.example.', 'trailing dot'],
    ['https://127.0.0.1', 'loopback literal'],
    ['https://10.0.0.5', 'private literal'],
    ['https://169.254.169.254', 'metadata literal'],
    ['https://192.168.1.1:8443', 'private literal with port'],
    ['https://[::1]', 'IPv6 loopback'],
    ['https://[fe80::1]', 'IPv6 link-local'],
    ['https://[::ffff:10.0.0.1]', 'IPv4-mapped private'],
    ['https://2130706433', 'decimal loopback'],
    ['https://0x7f.0.0.1', 'hex loopback'],
    ['https://a.example:99999', 'port out of range'],
    ['', 'empty'],
    ['https://', 'no host'],
  ])('refuses %s (%s)', (raw) => {
    expect(normalizeBrokerOrigin(raw).ok).toBe(false);
  });
});

describe('originOfUpstreamHost', () => {
  it('normalises a plain host or host:port segment', () => {
    expect(originOfUpstreamHost('api.service-x.example')).toMatchObject({ ok: true, origin: 'https://api.service-x.example', port: 443 });
    expect(originOfUpstreamHost('API.service-x.example:8443')).toMatchObject({ ok: true, origin: 'https://api.service-x.example:8443', port: 8443 });
    expect(originOfUpstreamHost('api.service-x.example:443')).toMatchObject({ ok: true, origin: 'https://api.service-x.example' });
  });

  it.each(['evil.example%2F@good.example', 'a.example@b.example', 'a.example/b', 'a.example?x', 'a.example#x', 'a b.example', 'a.example\\b', '', '@', 'a.example:80:80', '%61.example'])(
    'refuses the segment %j (it cannot be a bare host)',
    (segment) => {
      expect(originOfUpstreamHost(segment)).toBeNull();
    },
  );
});
