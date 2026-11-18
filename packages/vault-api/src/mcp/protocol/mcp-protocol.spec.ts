import {
  MCP_VERSIONS,
  McpProtocolError,
  SUPPORTED_VERSIONS,
  acceptsJson,
  decodeHeaderValue,
  isAllowedOrigin,
  negotiateInitialize,
  requestContext,
  resolveVersion,
  validateHeaders,
} from './mcp-protocol';
import { RPC } from './mcp-rpc';

const APP = 'https://vault.example.test';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

function refusal(fn: () => unknown): McpProtocolError {
  try {
    fn();
  } catch (e) {
    if (e instanceof McpProtocolError) return e;
    throw e;
  }
  throw new Error('expected a protocol refusal');
}

describe('MCP protocol: version negotiation', () => {
  it('speaks the five revisions, newest first', () => {
    expect([...SUPPORTED_VERSIONS]).toEqual(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
  });

  it('answers initialize with the requested revision when it has a handshake', () => {
    for (const v of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) expect(negotiateInitialize(v)).toBe(v);
  });

  it('answers an unknown (or non-handshake) initialize version with the latest handshake revision, never a refusal', () => {
    expect(negotiateInitialize('1999-01-01')).toBe('2025-11-25');
    expect(negotiateInitialize('2026-07-28')).toBe('2025-11-25');
    expect(negotiateInitialize(undefined)).toBe('2025-11-25');
    expect(resolveVersion({}, { method: 'initialize', params: { protocolVersion: 'nope' } })).toBe('2025-11-25');
  });

  it('takes the header first, then _meta, then the default 2025-03-26', () => {
    expect(resolveVersion({ protocolVersion: '2025-06-18' }, {})).toBe('2025-06-18');
    expect(resolveVersion({}, { params: { _meta: { [META_VERSION]: '2026-07-28' } } })).toBe('2026-07-28');
    expect(resolveVersion({}, { method: 'tools/list' })).toBe('2025-03-26');
  });

  it('refuses an unsupported header or _meta version with 400 and the supported list', () => {
    const e = refusal(() => resolveVersion({ protocolVersion: '1999-01-01' }, {}));
    expect(e.httpStatus).toBe(400);
    expect(e.code).toBe(RPC.UNSUPPORTED_PROTOCOL_VERSION);
    expect((e.data as { supported: string[] }).supported).toEqual([...SUPPORTED_VERSIONS]);
    expect(refusal(() => resolveVersion({}, { params: { _meta: { [META_VERSION]: 'x' } } })).code).toBe(RPC.UNSUPPORTED_PROTOCOL_VERSION);
  });

  it('flags: batches 2025-03-26 only; structured content and titles from 2025-06-18', () => {
    expect(Object.entries(MCP_VERSIONS).filter(([, f]) => f.batching).map(([v]) => v)).toEqual(['2025-03-26']);
    expect(MCP_VERSIONS['2025-03-26'].structuredContent).toBe(false);
    expect(MCP_VERSIONS['2025-06-18'].toolTitle).toBe(true);
    expect(MCP_VERSIONS['2026-07-28'].handshake).toBe(false);
  });
});

describe('MCP protocol: 2026-07-28 header rules', () => {
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_secrets', _meta: { [META_VERSION]: '2026-07-28' } } };

  it('requires version, method and name headers and that they agree with the body', () => {
    expect(() => validateHeaders('2026-07-28', { protocolVersion: '2026-07-28', method: 'tools/call', name: 'search_secrets' }, call)).not.toThrow();
    expect(refusal(() => validateHeaders('2026-07-28', {}, call)).code).toBe(RPC.HEADER_MISMATCH);
    expect(refusal(() => validateHeaders('2026-07-28', { protocolVersion: '2026-07-28', method: 'tools/list', name: 'search_secrets' }, call)).code).toBe(RPC.HEADER_MISMATCH);
    expect(refusal(() => validateHeaders('2026-07-28', { protocolVersion: '2026-07-28', method: 'tools/call', name: 'other' }, call)).code).toBe(RPC.HEADER_MISMATCH);
  });

  it('on an older revision a present header must still agree with the body', () => {
    expect(() => validateHeaders('2025-06-18', {}, { id: 1, method: 'tools/list' })).not.toThrow();
    expect(refusal(() => validateHeaders('2025-06-18', { method: 'tools/list' }, { id: 1, method: 'ping' })).httpStatus).toBe(400);
  });

  it('decodes the base64 sentinel of Mcp-Name', () => {
    expect(decodeHeaderValue(`=?base64?${Buffer.from('café').toString('base64')}?=`)).toBe('café');
    expect(decodeHeaderValue('plain')).toBe('plain');
  });

  it('builds a context with client info from initialize params', () => {
    const rctx = requestContext({}, { method: 'initialize', id: 1, params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Client A', version: '1' } } }, null);
    expect(rctx.version).toBe('2025-06-18');
    expect(rctx.clientInfo).toEqual({ name: 'Client A', version: '1' });
  });
});

describe('MCP protocol: Origin rule', () => {
  it('admits the application origin only', () => {
    expect(isAllowedOrigin(APP, APP)).toBe(true);
    expect(isAllowedOrigin(`${APP}/`, APP)).toBe(true);
    expect(isAllowedOrigin('https://evil.example.test', APP)).toBe(false);
    expect(isAllowedOrigin('http://vault.example.test', APP)).toBe(false);
    expect(isAllowedOrigin('https://vault.example.test:8443', APP)).toBe(false);
  });

  it('has no loopback exception and no default extras', () => {
    expect(isAllowedOrigin('http://localhost:6274', APP)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1', APP)).toBe(false);
  });

  it('admits an extra origin the host lists, and rejects junk and an unknown app url', () => {
    expect(isAllowedOrigin('https://inspector.example.test', APP, ['https://inspector.example.test'])).toBe(true);
    expect(isAllowedOrigin('https://vault.example.test/path', APP)).toBe(false);
    expect(isAllowedOrigin('not a url', APP)).toBe(false);
    expect(isAllowedOrigin(APP, undefined)).toBe(false);
  });

  it('Accept: absent, json or wildcard passes', () => {
    expect(acceptsJson(undefined)).toBe(true);
    expect(acceptsJson('application/json, text/event-stream')).toBe(true);
    expect(acceptsJson('text/html')).toBe(false);
  });
});
