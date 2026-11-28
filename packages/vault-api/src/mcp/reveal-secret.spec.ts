import { MCP_CANARY_PASSWORD, MCP_CANARY_TOTP, MCP_CANARY_USERNAME, buildMcpHarness } from '../testing/fake-mcp';
import { McpRedactionError, assertNoSensitiveValues } from './protocol/mcp-tool';
import { requestContext, type RpcMessage } from './protocol/mcp-protocol';
import type { RpcResponse } from './protocol/mcp-rpc';

const WIFI_PASSWORD = 'WifiPw-4Kd2-reveal-me';

function setup(options?: Parameters<typeof buildMcpHarness>[0]) {
  const h = buildMcpHarness(options);
  const credential = h.caller().credential;
  const call = async (name: string, args: unknown, over: Parameters<typeof h.caller>[0] = {}) => {
    const full = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as RpcMessage;
    const out = await h.dispatcher.dispatch(full, requestContext({ protocolVersion: '2025-06-18' }, full, credential), h.caller(over));
    const result = (out!.body as RpcResponse).result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean } | undefined;
    return { out: out!, result, data: result?.structuredContent };
  };
  const revealed = h.add({
    userId: 'user-aaa', type: 'Credential', name: 'Wifi', agentAccess: 'none', assistantReveal: true,
    values: { username: MCP_CANARY_USERNAME, password: WIFI_PASSWORD, totp: MCP_CANARY_TOTP, url: 'https://wifi.example.test' },
  });
  const closed = h.add({
    userId: 'user-aaa', type: 'Credential', name: 'Closed', agentAccess: 'fill', assistantReveal: false,
    values: { username: 'closed@example.test', password: MCP_CANARY_PASSWORD, url: 'https://closed.example.test' },
  });
  const foreign = h.add({
    userId: 'user-bbb', type: 'Credential', name: 'Foreign', agentAccess: 'fill', assistantReveal: true,
    values: { username: 'foreign@example.test', password: 'ForeignPw-1-do-not-leak', url: 'https://foreign.example.test' },
  });
  const card = h.add({
    userId: 'user-aaa', type: 'Card', name: 'Card A', agentAccess: 'none', assistantReveal: true,
    values: { cardholder_name: 'Person A', number: '4111111111111111', exp_month: '12', exp_year: '2031', cvv: '737' },
  });
  return { h, call, revealed, closed, foreign, card };
}

describe('reveal_secret (#244)', () => {
  it('returns exactly one field of an opted-in secret and nothing else', async () => {
    const { call, revealed } = setup();
    const { data, result } = await call('reveal_secret', { id: revealed.id, field: 'password' });
    expect(result!.isError).toBeUndefined();
    expect(data).toEqual({ id: revealed.id, name: 'Wifi', type: 'Credential', field: 'password', value: WIFI_PASSWORD });
    const text = JSON.stringify(result);
    expect(text).not.toContain(MCP_CANARY_TOTP);
    expect(text).not.toContain(MCP_CANARY_USERNAME);
  });

  it('works for a secret that is not opened for filling (the opt-in is the only gate)', async () => {
    const { call, revealed } = setup();
    expect(revealed.agentAccess).toBe('none');
    expect((await call('reveal_secret', { id: revealed.id, field: 'username' })).data.value).toBe(MCP_CANARY_USERNAME);
  });

  it.each(['closed', 'foreign', 'card'] as const)('answers one identical not-found for a %s secret and for a missing one (no oracle)', async (which) => {
    const ctx = setup();
    const missing = await ctx.call('reveal_secret', { id: '00000000-0000-4000-8000-0000000000ff', field: 'password' });
    const got = await ctx.call('reveal_secret', { id: ctx[which].id, field: 'password' });
    expect(got.result!.isError).toBe(true);
    expect(got.data.code).toBe('NOT_FOUND');
    expect(got.result).toEqual(missing.result);
    const all = JSON.stringify(ctx.h.audit.events);
    expect(all).not.toContain(MCP_CANARY_PASSWORD);
    expect(JSON.stringify(got.result)).not.toContain('ForeignPw');
  });

  it('an unknown field is a clear error that lists field names only, and a defined empty field has no value', async () => {
    const { call, revealed } = setup();
    const unknown = await call('reveal_secret', { id: revealed.id, field: 'nope' });
    expect(unknown.data.code).toBe('FIELD_NOT_FOUND');
    expect(unknown.result!.content[0]!.text).toMatch(/Its fields: .*password/);
    expect(JSON.stringify(unknown.result)).not.toContain(WIFI_PASSWORD);
    const empty = await call('reveal_secret', { id: revealed.id, field: 'notes' });
    expect(empty.data.code).toBe('FIELD_EMPTY');
  });

  it('audits the secret id and the field NAME, never the value', async () => {
    const { call, h, revealed } = setup();
    await call('reveal_secret', { id: revealed.id, field: 'password' });
    const row = h.audit.events.at(-1)!;
    expect(row).toMatchObject({ action: 'mcp.tool.call', targetType: 'secret', targetId: revealed.id });
    expect(row.meta).toMatchObject({ tool: 'reveal_secret', result: 'ok', secretId: revealed.id, field: 'password', clientId: 'client-1' });
    const trail = JSON.stringify(h.audit.events);
    expect(trail).not.toContain(WIFI_PASSWORD);
    expect(trail).not.toContain('Wifi');
  });

  it('is behind the kill switch (agentAccess.enabled off: 403, nothing revealed)', async () => {
    const { call, revealed } = setup({ enabled: false });
    const { out } = await call('reveal_secret', { id: revealed.id, field: 'password' });
    expect(out.status).toBe(403);
    expect(JSON.stringify(out.body)).not.toContain(WIFI_PASSWORD);
  });

  it('has its own rate limit (agentAccess.revealPerMinute), counted before the lookup, 429 RATE_LIMITED', async () => {
    const { call, revealed, h } = setup({ revealPerMinute: 2 });
    for (let i = 0; i < 2; i += 1) expect((await call('reveal_secret', { id: revealed.id, field: 'password' })).out.status).toBe(200);
    const limited = await call('reveal_secret', { id: revealed.id, field: 'password' });
    expect(limited.out.status).toBe(429);
    expect(limited.out.body.error?.data).toMatchObject({ code: 'RATE_LIMITED' });
    expect(JSON.stringify(limited.out.body)).not.toContain(WIFI_PASSWORD);
    // The other tools keep their own bucket.
    expect((await call('list_secret_types', {})).out.status).toBe(200);
    expect(h.audit.events.some((e) => e.meta?.result === 'denied:rate_limited')).toBe(true);
  });

  it('defaults to 10 reveals per minute', async () => {
    const { call, revealed } = setup();
    for (let i = 0; i < 10; i += 1) expect((await call('reveal_secret', { id: revealed.id, field: 'password' })).out.status).toBe(200);
    expect((await call('reveal_secret', { id: revealed.id, field: 'password' })).out.status).toBe(429);
  });

  it('is declared with the vault:mcp_reveal scope, secrets:read and a read effect, and the scope is required (step-up)', async () => {
    const { h, call, revealed } = setup();
    const tool = h.registry.get('reveal_secret')!;
    expect([tool.scope, tool.permission, tool.effect, tool.revealsField]).toEqual(['vault:mcp_reveal', 'secrets:read', 'read', true]);
    const authorize = (t: { scope: string }) => {
      if (t.scope === 'vault:mcp_reveal') throw new Error('insufficient_scope');
    };
    await expect(call('reveal_secret', { id: revealed.id, field: 'password' }, { authorize })).rejects.toThrow('insufficient_scope');
    expect(h.audit.events).toHaveLength(0);
  });

  it('only reveal_secret declares revealsField', () => {
    const { h } = setup();
    expect(h.registry.all().filter((t) => t.revealsField).map((t) => t.name)).toEqual(['reveal_secret']);
  });
});

describe('visibility of opted-in secrets (#244)', () => {
  it('search_secrets and get_secret return an opted-in secret, sensitive values hidden, assistantReveal flagged', async () => {
    const { call, revealed } = setup();
    const search = await call('search_secrets', { query: 'wifi' });
    expect(search.data.items).toHaveLength(1);
    expect(search.data.items[0]).toMatchObject({ id: revealed.id, assistantReveal: true, agentAccess: 'none' });
    expect(search.data.items[0].fields).not.toHaveProperty('password');
    const get = await call('get_secret', { id: revealed.id });
    expect(get.data.secret.fields.password).toBe('[hidden]');
    expect(JSON.stringify(get.result)).not.toContain(WIFI_PASSWORD);
  });

  it('never lists a card even when flagged, nor another user\'s secret', async () => {
    const { call } = setup();
    const names = (await call('search_secrets', {})).data.items.map((i: { name: string }) => i.name).sort();
    expect(names).toEqual(['Closed', 'Wifi']);
  });

  it('update_secret stays Credential + fill only: an opted-in, not-open secret is not found', async () => {
    const { call, revealed, h } = setup();
    const out = await call('update_secret', { id: revealed.id, fields: { username: 'x' } });
    expect(out.data.code).toBe('NOT_FOUND');
    expect(h.state.updates).toBe(0);
  });
});

describe('the redaction guard stays fail-closed for every other tool (#244)', () => {
  it('still withholds a value another tool leaks, even for a field reveal_secret could return', async () => {
    const { h, call } = setup();
    h.registry.register({
      name: 'leaky',
      title: 'Leaky',
      description: 'A tool that leaks.',
      input: (h.registry.get('list_secret_types') as any).input,
      scope: 'vault:mcp_read',
      permission: 'secrets:read',
      effect: 'read',
      handler: async () => ({ data: { value: WIFI_PASSWORD }, sensitive: [WIFI_PASSWORD] }),
    });
    const { result, out } = await call('leaky', {});
    expect(result!.isError).toBe(true);
    expect(JSON.stringify(out.body)).not.toContain(WIFI_PASSWORD);
  });

  it('the reveal exemption covers the top-level `value` key only', () => {
    expect(() => assertNoSensitiveValues({ id: 'a', value: 'SeCrEt-value-1' }, ['SeCrEt-value-1'], { key: 'value' })).not.toThrow();
    expect(() => assertNoSensitiveValues({ id: 'a', value: 'x', name: 'SeCrEt-value-1' }, ['SeCrEt-value-1'], { key: 'value' })).toThrow(McpRedactionError);
    expect(() => assertNoSensitiveValues({ nested: { value: 'SeCrEt-value-1' } }, ['SeCrEt-value-1'], { key: 'value' })).toThrow(McpRedactionError);
    expect(() => assertNoSensitiveValues({ value: 'SeCrEt-value-1' }, ['SeCrEt-value-1'])).toThrow(McpRedactionError);
  });

  it('a revealed secret whose name equals another of its values is withheld whole (fail closed)', async () => {
    const { h, call } = setup();
    const odd = h.add({ userId: 'user-aaa', type: 'Credential', name: 'Shared-Value-123', agentAccess: 'none', assistantReveal: true, values: { username: 'u', password: 'Shared-Value-123' } });
    const { result, out } = await call('reveal_secret', { id: odd.id, field: 'password' });
    expect(result!.structuredContent.code).toBe('REDACTION_BLOCKED');
    expect(JSON.stringify(out.body)).not.toMatch(/Shared-Value-123.*Shared-Value-123/s);
  });
});
