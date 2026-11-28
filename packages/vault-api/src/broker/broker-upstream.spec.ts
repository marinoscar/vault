import { Readable } from 'node:stream';

import { createTestPki, startLocalHttps, type LocalHttps, type TestPki } from '../../test/helpers/local-https';
import { BrokerUpstreamFailure, NodeHttpsBrokerUpstream, SystemBrokerResolver, type BrokerUpstreamRequest } from './broker-upstream';

const HOST = 'upstream.example.test';

describe('NodeHttpsBrokerUpstream (real TLS against a local server, verification ON)', () => {
  let pki: TestPki;
  let server: LocalHttps;
  let upstream: NodeHttpsBrokerUpstream;

  beforeAll(async () => {
    pki = createTestPki();
    upstream = new NodeHttpsBrokerUpstream({ ca: pki.caPem });
    server = await startLocalHttps(pki.issue(HOST), (req, res, body) => {
      if (req.url?.startsWith('/redirect')) {
        res.writeHead(302, { location: 'https://elsewhere.example.test/x' });
        res.end();
      } else if (req.url?.startsWith('/slow')) {
        setTimeout(() => res.end('late'), 2000);
      } else if (req.url?.startsWith('/big')) {
        res.end(Buffer.alloc(5000, 97));
      } else {
        res.writeHead(200, { 'content-type': 'text/plain', 'x-seen-host': String(req.headers.host) });
        res.end(`echo:${body.toString('utf8')}`);
      }
    });
  });
  afterAll(async () => {
    await server.close();
    pki.dispose();
  });

  const request = (over: Partial<BrokerUpstreamRequest> = {}): BrokerUpstreamRequest => ({
    hostname: HOST,
    port: server.port,
    address: '127.0.0.1',
    family: 4,
    method: 'GET',
    path: '/ok',
    headers: {},
    body: null,
    timeoutMs: 5000,
    maxResponseBytes: 1_000_000,
    ...over,
  });

  it('connects to the pinned address (the name resolves nowhere) and verifies the certificate against the host name', async () => {
    const response = await upstream.send(request());
    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('echo:');
    expect(response.headers['x-seen-host']).toBe(`${HOST}:${server.port}`);
  });

  it('streams a request body', async () => {
    const response = await upstream.send(request({ method: 'POST', body: Readable.from([Buffer.from('he'), Buffer.from('llo')]), headers: { 'content-type': 'text/plain' } }));
    expect(response.body.toString()).toBe('echo:hello');
  });

  it('does not follow a redirect: the 3xx and its Location come back as they are', async () => {
    const before = server.seen.length;
    const response = await upstream.send(request({ path: '/redirect' }));
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://elsewhere.example.test/x');
    expect(server.seen.length).toBe(before + 1);
  });

  it('fails closed when the certificate does not match the host name (no verification bypass)', async () => {
    const error = await upstream.send(request({ hostname: 'other.example.test' })).catch((e) => e);
    expect(error).toBeInstanceOf(BrokerUpstreamFailure);
    expect(error.code).toBe('error');
  });

  it('fails closed when the certificate authority is not trusted', async () => {
    const strict = new NodeHttpsBrokerUpstream();
    const error = await strict.send(request()).catch((e) => e);
    expect(error).toBeInstanceOf(BrokerUpstreamFailure);
    expect(error.code).toBe('error');
  });

  it('times out', async () => {
    const error = await upstream.send(request({ path: '/slow', timeoutMs: 200 })).catch((e) => e);
    expect(error).toBeInstanceOf(BrokerUpstreamFailure);
    expect(error.code).toBe('timeout');
  });

  it('refuses a response above the cap', async () => {
    const error = await upstream.send(request({ path: '/big', maxResponseBytes: 1000 })).catch((e) => e);
    expect(error).toBeInstanceOf(BrokerUpstreamFailure);
    expect(error.code).toBe('too_large');
  });

  it('rethrows an error of the request body stream', async () => {
    const body = new Readable({ read() { this.destroy(new Error('client went away')); } });
    const error = await upstream.send(request({ method: 'POST', body })).catch((e) => e);
    expect(error.message).toBe('client went away');
  });
});

describe('SystemBrokerResolver', () => {
  it('returns an IP literal as is, without a lookup', async () => {
    expect(await new SystemBrokerResolver().resolveAll('93.184.216.34')).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(await new SystemBrokerResolver().resolveAll('2001:db8::1')).toEqual([{ address: '2001:db8::1', family: 6 }]);
  });
});
