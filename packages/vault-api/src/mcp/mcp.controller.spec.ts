import 'reflect-metadata';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InsufficientScopeException } from '@marinoscar/platform-api/identity';

import { buildMcpHarness } from '../testing/fake-mcp';
import { McpController, McpOriginGuard } from './mcp.controller';

const decision = jest.fn();
jest.mock('@marinoscar/platform-api/identity', () => ({
  ...jest.requireActual('@marinoscar/platform-api/identity'),
  oauthAccessDecision: (...args: unknown[]) => decision(...args),
}));

const APP = 'https://vault.example.test';

function fakeReply() {
  const reply = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    code(status: number) {
      reply.statusCode = status;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name] = value;
      return reply;
    },
  };
  return reply;
}

function fakeReq(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return {
    headers,
    principal: { userId: 'user-aaa', permissions: ['secrets:read', 'secrets:write'] },
    user: { id: 'user-aaa' },
    authCredential: { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'mcp', scopes: ['vault:mcp_read'] },
    ...extra,
  } as never;
}

function setup() {
  const h = buildMcpHarness();
  const controller = new McpController(h.dispatcher);
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const reply = fakeReply();
    const out = await controller.post(fakeReq(headers), body, reply as never);
    return { reply, out };
  };
  return { h, controller, post };
}

beforeEach(() => decision.mockReset().mockReturnValue('granted'));

describe('McpController: transport', () => {
  it('declares the controller path and exempts every route from the response envelope', () => {
    expect(Reflect.getMetadata('path', McpController)).toBe('mcp');
    expect(Reflect.getMetadata('platform:rawResponse', McpController.prototype.post)).toBe(true);
    expect(Reflect.getMetadata('platform:rawResponse', McpController.prototype.get)).toBe(true);
    expect(Reflect.getMetadata('platform:rawResponse', McpController.prototype.end)).toBe(true);
  });

  it('GET and DELETE answer 405 with Allow: POST', () => {
    const { controller } = setup();
    for (const method of ['get', 'end'] as const) {
      const reply = fakeReply();
      const body = (controller[method] as (r: unknown) => { error: { code: number } })(reply);
      expect(reply.statusCode).toBe(405);
      expect(reply.headers.allow).toBe('POST');
      expect(body.error.code).toBe(-32600);
    }
  });

  it('initialize answers 200 with the negotiated revision', async () => {
    const { post } = setup();
    const { reply, out } = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'Client A' } } });
    expect(reply.statusCode).toBe(200);
    expect((out!.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
  });

  it('notifications/initialized answers 202 with no body', async () => {
    const { post } = setup();
    const { reply, out } = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(reply.statusCode).toBe(202);
    expect(out).toBeUndefined();
  });

  it('refuses a batch on every revision with 400 -32600', async () => {
    const { post } = setup();
    for (const version of [undefined, '2025-03-26', '2025-06-18', '2026-07-28']) {
      const { reply, out } = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }], version ? { 'mcp-protocol-version': version } : {});
      expect(reply.statusCode).toBe(400);
      expect(out!.error?.code).toBe(-32600);
      expect(out!.error?.message).toMatch(/batch/i);
    }
  });

  it('refuses an unsupported protocol version with 400 -32022 and the supported list', async () => {
    const { post } = setup();
    const { reply, out } = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' });
    expect(reply.statusCode).toBe(400);
    expect(out!.error?.code).toBe(-32022);
    expect((out!.error?.data as { supported: string[] }).supported).toContain('2025-11-25');
  });

  it('refuses a header that disagrees with the body (-32020)', async () => {
    const { post } = setup();
    const { reply, out } = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-method': 'ping' });
    expect(reply.statusCode).toBe(400);
    expect(out!.error?.code).toBe(-32020);
  });

  it.each([
    ['a non-object', 'text'],
    ['a wrong jsonrpc', { jsonrpc: '1.0', id: 1, method: 'ping' }],
    ['no method', { jsonrpc: '2.0', id: 1 }],
    ['array params', { jsonrpc: '2.0', id: 1, method: 'ping', params: [] }],
    ['an object id', { jsonrpc: '2.0', id: {}, method: 'ping' }],
  ])('refuses %s as an invalid request (400, -32600)', async (_label, body) => {
    const { post } = setup();
    const { reply, out } = await post(body);
    expect(reply.statusCode).toBe(400);
    expect(out!.error?.code).toBe(-32600);
  });

  it('an unknown method is -32601 inside a 200', async () => {
    const { post } = setup();
    const { reply, out } = await post({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'x' } });
    expect(reply.statusCode).toBe(200);
    expect(out!.error?.code).toBe(-32601);
  });

  it('kill switch off: tools/call is HTTP 403, tools/list still works', async () => {
    const { h, post } = setup();
    h.settings.getNamespace = async () => ({ enabled: false }) as never;
    const call = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_secret_types', arguments: {} } });
    expect(call.reply.statusCode).toBe(403);
    expect(call.out!.error?.data).toEqual({ code: 'AGENT_ACCESS_DISABLED' });
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).reply.statusCode).toBe(200);
  });

  it('rate limit: HTTP 429 with a Retry-After header', async () => {
    const h = buildMcpHarness({ ratePerMinute: 1 });
    const controller = new McpController(h.dispatcher);
    const run = async () => {
      const reply = fakeReply();
      await controller.post(fakeReq(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_secret_types', arguments: {} } }, reply as never);
      return reply;
    };
    expect((await run()).statusCode).toBe(200);
    const limited = await run();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});

describe('McpController: scope step-up', () => {
  const callWrite = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_secret', arguments: { type: 'Credential', name: 'X', fields: { username: 'u' } } } };

  it('a token without the write scope whose user holds the permission gets InsufficientScopeException naming vault:mcp_write', async () => {
    const { h, post } = setup();
    decision.mockReturnValue('step_up');
    await expect(post(callWrite)).rejects.toMatchObject({ requiredScopes: ['vault:mcp_write'], resourceId: 'mcp' });
    await expect(post(callWrite)).rejects.toBeInstanceOf(InsufficientScopeException);
    expect(h.rows).toHaveLength(0);
    expect(decision).toHaveBeenCalledWith(expect.anything(), 'secrets:write');
  });

  it('a user who lacks the permission gets a plain 403 (no step-up can help)', async () => {
    const { post } = setup();
    decision.mockReturnValue('forbidden');
    await expect(post(callWrite)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(post(callWrite)).rejects.not.toBeInstanceOf(InsufficientScopeException);
  });

  it('read tools ask for secrets:read; list and initialize ask nothing', async () => {
    const { post } = setup();
    await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_secrets', arguments: {} } });
    expect(decision).toHaveBeenCalledWith(expect.anything(), 'secrets:read');
    decision.mockClear();
    await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await post({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} });
    expect(decision).not.toHaveBeenCalled();
  });
});

describe('McpOriginGuard', () => {
  const ctx = (origin?: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers: origin === undefined ? {} : { origin } }) }) }) as unknown as ExecutionContext;

  it('passes a request without an Origin and the application origin', () => {
    const guard = new McpOriginGuard({ appUrl: APP });
    expect(guard.canActivate(ctx())).toBe(true);
    expect(guard.canActivate(ctx(APP))).toBe(true);
  });

  it('refuses any other origin with 403', () => {
    const guard = new McpOriginGuard({ appUrl: APP });
    expect(() => guard.canActivate(ctx('https://evil.example.test'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('http://localhost:6274'))).toThrow(ForbiddenException);
    expect(() => new McpOriginGuard().canActivate(ctx(APP))).toThrow(ForbiddenException);
  });
});
