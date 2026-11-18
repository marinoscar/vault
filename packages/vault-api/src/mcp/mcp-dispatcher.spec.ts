import { ForbiddenException } from '@nestjs/common';
import { InsufficientScopeException } from '@marinoscar/platform-api/identity';

import {
  MCP_CANARY_PASSWORD,
  MCP_CANARY_TOTP,
  MCP_CANARY_USERNAME,
  buildMcpHarness,
} from '../testing/fake-mcp';
import { MCP_TOOL_CALL_AUDIT_ACTION } from './mcp-dispatcher';
import { requestContext, type RpcMessage } from './protocol/mcp-protocol';
import type { RpcResponse } from './protocol/mcp-rpc';

const ORIGIN = 'https://shop.example.test';

function setup(options?: Parameters<typeof buildMcpHarness>[0]) {
  const h = buildMcpHarness(options);
  const credential = h.caller().credential;
  const send = async (msg: Omit<RpcMessage, 'jsonrpc'>, over: Parameters<typeof h.caller>[0] = {}, headers = {}) => {
    const full = { jsonrpc: '2.0', ...msg } as RpcMessage;
    return h.dispatcher.dispatch(full, requestContext(headers, full, credential), h.caller(over));
  };
  const call = async (name: string, args: unknown, over: Parameters<typeof h.caller>[0] = {}) => {
    const out = await send({ id: 1, method: 'tools/call', params: { name, arguments: args } }, over, { protocolVersion: '2025-06-18' });
    return out!;
  };
  const resultOf = (o: { body: RpcResponse }) => o.body.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
  const open = h.add({ userId: 'user-aaa', type: 'Credential', name: 'Shop', agentAccess: 'fill', values: { username: MCP_CANARY_USERNAME, password: MCP_CANARY_PASSWORD, url: ORIGIN, totp: MCP_CANARY_TOTP, notes: 'a note' } });
  return { h, send, call, resultOf, open };
}

describe('McpDispatcher: methods', () => {
  it('initialize negotiates and tells the model no secret is returned', async () => {
    const { send } = setup();
    const out = await send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Client A' } } });
    const result = out!.body.result as { protocolVersion: string; serverInfo: { name: string }; instructions: string; capabilities: { tools: unknown } };
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.serverInfo.name).toBe('vault');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.instructions).toMatch(/never returns a secret value/);
  });

  it('a notification gets no answer (the transport answers 202)', async () => {
    const { send } = setup();
    expect(await send({ method: 'notifications/initialized' })).toBeNull();
  });

  it('ping works on handshake revisions; an unknown method is -32601', async () => {
    const { send } = setup();
    expect((await send({ id: 2, method: 'ping' }))!.body.result).toEqual({});
    const unknown = await send({ id: 3, method: 'resources/list' });
    expect(unknown!.body.error?.code).toBe(-32601);
    expect(unknown!.status).toBe(200);
  });

  it('2026-07-28: initialize and ping are not methods, an unknown method is HTTP 404, results carry resultType', async () => {
    const { send } = setup();
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    const headers = { protocolVersion: '2026-07-28', method: 'initialize' };
    const init = await send({ id: 1, method: 'initialize', params: { _meta: meta } }, {}, headers);
    expect(init!.status).toBe(404);
    const list = await send({ id: 2, method: 'tools/list', params: { _meta: meta } }, {}, { protocolVersion: '2026-07-28', method: 'tools/list' });
    expect(list!.body.result).toMatchObject({ resultType: 'complete', ttlMs: 300000, cacheScope: 'private' });
  });

  it('tools/call of an unknown tool is -32602', async () => {
    const { call } = setup();
    expect((await call('reveal_secret', {})).body.error?.code).toBe(-32602);
  });
});

describe('McpDispatcher: tools/list metadata', () => {
  it('lists exactly the five tools, each with a title, a scope, an effect hint and an input schema', async () => {
    const { send, h } = setup();
    const out = await send({ id: 1, method: 'tools/list' }, {}, { protocolVersion: '2025-06-18' });
    const tools = (out!.body.result as { tools: Array<any> }).tools;
    expect(tools.map((t) => t.name)).toEqual(['search_secrets', 'get_secret', 'list_secret_types', 'create_secret', 'update_secret']);
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
      expect(t.securitySchemes[0].scopes[0]).toMatch(/^vault:mcp_(read|write)$/);
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
      expect(typeof t.annotations.destructiveHint).toBe('boolean');
      expect(typeof t.annotations.idempotentHint).toBe('boolean');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const read of ['search_secrets', 'get_secret', 'list_secret_types']) {
      expect(byName[read].annotations.readOnlyHint).toBe(true);
      expect(byName[read].securitySchemes[0].scopes).toEqual(['vault:mcp_read']);
    }
    for (const write of ['create_secret', 'update_secret']) {
      expect(byName[write].annotations.readOnlyHint).toBe(false);
      expect(byName[write].securitySchemes[0].scopes).toEqual(['vault:mcp_write']);
    }
    // Registry-level: every tool carries scope, permission, effect and title.
    for (const t of h.registry.all()) {
      expect([t.scope, t.permission, t.effect, t.title].every(Boolean)).toBe(true);
      expect(['read', 'write']).toContain(t.effect);
    }
  });

  it('an older revision gets no title', async () => {
    const { send } = setup();
    const out = await send({ id: 1, method: 'tools/list' }, {}, { protocolVersion: '2024-11-05' });
    expect((out!.body.result as { tools: Array<any> }).tools[0]).not.toHaveProperty('title');
  });

  it('lists the tools even while the kill switch is off', async () => {
    const { send } = setup({ enabled: false });
    expect((await send({ id: 1, method: 'tools/list' }))!.status).toBe(200);
  });
});

describe('McpDispatcher: gates', () => {
  it('the kill switch off refuses every tool with HTTP 403 AGENT_ACCESS_DISABLED and audits the denial', async () => {
    const { call, h, open } = setup({ enabled: false });
    for (const [name, args] of [
      ['search_secrets', {}],
      ['get_secret', { id: open.id }],
      ['list_secret_types', {}],
      ['create_secret', { type: 'Credential', name: 'X', fields: { username: 'u' } }],
      ['update_secret', { id: open.id, fields: { notes: 'n' } }],
    ] as const) {
      const out = await call(name, args);
      expect(out.status).toBe(403);
      expect(out.body.error?.data).toEqual({ code: 'AGENT_ACCESS_DISABLED' });
    }
    expect(h.audit.events.map((e) => e.meta?.result)).toEqual(Array(5).fill('denied:disabled'));
    expect(h.state.updates).toBe(0);
  });

  it('a step-up from authorize propagates (the controller answers HTTP 403), nothing runs and nothing is audited as ok', async () => {
    const { call, h, open } = setup();
    const authorize = () => {
      throw new InsufficientScopeException({ resourceId: 'mcp', requiredScopes: ['vault:mcp_write'] });
    };
    await expect(call('update_secret', { id: open.id, fields: { notes: 'n' } }, { authorize })).rejects.toBeInstanceOf(InsufficientScopeException);
    expect(h.state.updates).toBe(0);
    expect(h.audit.events).toHaveLength(0);
  });

  it('a forbidden permission propagates as a 403 exception', async () => {
    const { call } = setup();
    const authorize = () => {
      throw new ForbiddenException('no');
    };
    await expect(call('search_secrets', {}, { authorize })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorize receives the tool, with its scope, permission and effect', async () => {
    const { call } = setup();
    const seen: Array<{ name: string; scope: string; permission: string; effect: string }> = [];
    const authorize = (t: { name: string; scope: string; permission: string; effect: string }) => void seen.push(t);
    await call('search_secrets', {}, { authorize });
    await call('create_secret', { type: 'Credential', name: 'N', fields: { username: 'u', password: 'pw-value-1' } }, { authorize });
    expect(seen.map((t) => [t.name, t.scope, t.permission, t.effect])).toEqual([
      ['search_secrets', 'vault:mcp_read', 'secrets:read', 'read'],
      ['create_secret', 'vault:mcp_write', 'secrets:write', 'write'],
    ]);
  });

  it('rate limits tools/call per grant and user (HTTP 429 with Retry-After), not initialize or list', async () => {
    const { call, send, h } = setup({ ratePerMinute: 2 });
    expect((await call('list_secret_types', {})).status).toBe(200);
    expect((await call('list_secret_types', {})).status).toBe(200);
    const limited = await call('list_secret_types', {});
    expect(limited.status).toBe(429);
    expect(Number(limited.headers?.['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(limited.body.error?.data).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await send({ id: 9, method: 'tools/list' }))!.status).toBe(200);
    // Another grant has its own bucket.
    const other = await call('list_secret_types', {}, { credential: { kind: 'oauth', tokenId: 't2', grantId: 'grant-2', clientId: 'c', resourceId: 'mcp', scopes: [] } as never });
    expect(other.status).toBe(200);
    expect(h.audit.events.some((e) => e.meta?.result === 'denied:rate_limited')).toBe(true);
  });

  it('invalid arguments are a tool error, not an HTTP error', async () => {
    const { call, resultOf } = setup();
    const out = await call('get_secret', { id: 'not-a-uuid' });
    expect(out.status).toBe(200);
    expect(resultOf(out).isError).toBe(true);
    expect(resultOf(out).content[0]!.text).toMatch(/Invalid arguments/);
  });
});

describe('McpDispatcher: audit', () => {
  it('writes one mcp.tool.call row per call with tool, client and secret id, and never a value', async () => {
    const { call, h, open } = setup();
    await call('get_secret', { id: open.id });
    await call('search_secrets', { query: 'Shop' });
    const created = await call('create_secret', { type: 'Credential', name: 'New', fields: { username: 'u' }, generatePassword: { length: 20 } });
    const [get, search, create] = h.audit.events;
    expect(get).toMatchObject({ action: MCP_TOOL_CALL_AUDIT_ACTION, actorUserId: 'user-aaa', targetType: 'secret', targetId: open.id });
    expect(get!.meta).toMatchObject({ tool: 'get_secret', result: 'ok', credential: 'oauth', clientId: 'client-1', grantId: 'grant-1', secretId: open.id });
    expect(search!.meta).toMatchObject({ tool: 'search_secrets', secretId: null });
    expect(create!.meta).toMatchObject({ tool: 'create_secret', result: 'ok' });
    expect(created.body.error).toBeUndefined();
    const trail = JSON.stringify(h.audit.events);
    expect(trail).not.toContain(MCP_CANARY_PASSWORD);
    expect(trail).not.toContain(MCP_CANARY_USERNAME);
    expect(trail).not.toContain('Shop');
  });

  it('records a pat by token id', async () => {
    const { call, h } = setup();
    await call('list_secret_types', {}, { credential: { kind: 'pat', tokenId: 'pat-1' } as never });
    expect(h.audit.events[0]!.meta).toMatchObject({ credential: 'pat', patId: 'pat-1' });
  });

  it('fails a successful call closed when the trail cannot be written', async () => {
    const { call, h, resultOf } = setup();
    h.audit.record = async () => {
      throw new Error('db down');
    };
    const out = await call('list_secret_types', {});
    expect(resultOf(out).isError).toBe(true);
    expect(resultOf(out).structuredContent.code).toBe('AUDIT_UNAVAILABLE');
    expect(resultOf(out).content[0]!.text).not.toContain('Credential');
  });
});

describe('McpDispatcher: fail-closed redaction', () => {
  it('withholds a result that carries a sensitive value the tool reported', async () => {
    const { h, call, resultOf } = setup();
    // A (buggy) tool that returns what it must not.
    h.registry.register({
      name: 'leaky',
      title: 'Leaky',
      description: 'A tool that leaks.',
      input: (h.registry.get('list_secret_types') as any).input,
      scope: 'vault:mcp_read',
      permission: 'secrets:read',
      effect: 'read',
      handler: async () => ({ data: { oops: `value is ${MCP_CANARY_PASSWORD}` }, sensitive: [MCP_CANARY_PASSWORD] }),
    });
    const out = await call('leaky', {});
    expect(resultOf(out).isError).toBe(true);
    expect(resultOf(out).structuredContent.code).toBe('REDACTION_BLOCKED');
    expect(JSON.stringify(out.body)).not.toContain(MCP_CANARY_PASSWORD);
    expect(h.audit.events.at(-1)!.meta?.result).toBe('error:redaction');
  });
});
