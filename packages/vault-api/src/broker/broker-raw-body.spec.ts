import fastify, { type FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';

import { BROKER_RAW_CONTENT_TYPE, installBrokerRawBody, type BrokerRawRequest } from './broker-raw-body';

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('installBrokerRawBody', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = fastify();
    installBrokerRawBody(app);
    app.all('/api/broker/v1/*', async (req) => {
      const body = req.body;
      const raw = body instanceof Readable ? (await drain(body)).toString('latin1') : null;
      return { isStream: body instanceof Readable, raw, originalType: (req as unknown as BrokerRawRequest).brokerContentType ?? null, type: req.headers['content-type'] ?? null };
    });
    app.post('/api/other', async (req) => ({ body: req.body }));
    await app.ready();
  });
  afterAll(async () => app.close());

  it('hands the broker path the unparsed stream for JSON, binary and unknown content types', async () => {
    for (const [type, payload] of [['application/json', '{"a": 1}'], ['application/octet-stream', '\u0000\u0001ÿ'], ['image/png', 'PNG'], ['text/x-weird', 'hello']] as const) {
      const res = await app.inject({ method: 'POST', url: '/api/broker/v1/id/host.example/x?y=1', headers: { 'content-type': type }, payload: Buffer.from(payload, 'latin1') });
      const body = res.json();
      expect(res.statusCode).toBe(200);
      expect(body).toMatchObject({ isStream: true, originalType: type, type: BROKER_RAW_CONTENT_TYPE });
      expect(body.raw).toBe(payload);
    }
  });

  it('accepts a body with no content type on the broker path', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/broker/v1/id/host.example/x', payload: 'abc' });
    expect(res.json()).toMatchObject({ isStream: true, raw: 'abc', originalType: null });
  });

  it('leaves a bodiless request alone', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/broker/v1/id/host.example/x' });
    expect(res.json()).toMatchObject({ isStream: false, originalType: null });
  });

  it('does not touch JSON parsing anywhere else', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/other', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });
    expect(res.json()).toEqual({ body: { a: 1 } });
    const other = await app.inject({ method: 'POST', url: '/api/other', headers: { 'content-type': 'image/png' }, payload: 'x' });
    expect(other.statusCode).toBe(415);
  });

  it('a lookalike path is not the broker path', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/broker/v1x/a', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(res.statusCode).toBe(404);
  });
});
