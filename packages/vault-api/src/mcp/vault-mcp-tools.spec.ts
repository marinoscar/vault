import type { SecretTypeField } from '@marinoscar/vault-contract/secret-types';

import { MCP_CANARY_PASSWORD, MCP_CANARY_TOTP, MCP_CANARY_USERNAME, buildMcpHarness } from '../testing/fake-mcp';
import { requestContext, type RpcMessage } from './protocol/mcp-protocol';
import type { RpcResponse } from './protocol/mcp-rpc';

const ORIGIN = 'https://shop.example.test';
const SENT_PASSWORD = 'ModelSentPw-3Hx8-do-not-echo';
const SENT_KEY = 'sk-model-sent-key-5Rt2-do-not-echo';
const SENT_TOTP = 'KRSXG5CTMVRXEZLU';

function setup() {
  const h = buildMcpHarness();
  const credential = h.caller().credential;
  /** Every raw response body, for the egress scan. */
  const bodies: string[] = [];
  const call = async (name: string, args: unknown) => {
    const full = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as RpcMessage;
    const out = await h.dispatcher.dispatch(full, requestContext({ protocolVersion: '2025-06-18' }, full, credential), h.caller());
    bodies.push(JSON.stringify(out));
    const body = out!.body as RpcResponse;
    const result = body.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean } | undefined;
    return { out: out!, result, data: result?.structuredContent };
  };
  const open = h.add({
    userId: 'user-aaa', type: 'Credential', name: 'Shop', agentAccess: 'fill',
    values: { username: MCP_CANARY_USERNAME, password: MCP_CANARY_PASSWORD, url: ORIGIN, totp: MCP_CANARY_TOTP, notes: 'Shop login' },
  });
  const closed = h.add({
    userId: 'user-aaa', type: 'Credential', name: 'Closed login', agentAccess: 'none',
    values: { username: 'closed@example.test', password: 'ClosedPw-1-do-not-leak', url: 'https://closed.example.test' },
  });
  const foreign = h.add({
    userId: 'user-bbb', type: 'Credential', name: 'Foreign login', agentAccess: 'fill',
    values: { username: 'foreign@example.test', password: 'ForeignPw-1-do-not-leak', url: 'https://foreign.example.test' },
  });
  const card = h.add({
    userId: 'user-aaa', type: 'Card', name: 'Card A', agentAccess: 'none',
    values: { cardholder_name: 'Person A', number: '4111111111111111', exp_month: '12', exp_year: '2031', cvv: '737' },
  });
  return { h, call, bodies, open, closed, foreign, card };
}

describe('search_secrets', () => {
  it('returns only the caller\'s open logins, with non-sensitive fields only', async () => {
    const { call, open } = setup();
    const { data } = await call('search_secrets', {});
    expect(data.count).toBe(1);
    expect(data.items[0]).toMatchObject({ id: open.id, name: 'Shop', type: 'Credential', origins: [ORIGIN], agentAccess: 'fill' });
    expect(data.items[0].fields).toEqual({ username: MCP_CANARY_USERNAME, url: ORIGIN, notes: 'Shop login' });
    expect(data.items[0].fields).not.toHaveProperty('password');
    expect(data.items[0].fields).not.toHaveProperty('totp');
  });

  it('filters by query, origin and type, and bounds the limit', async () => {
    const { call } = setup();
    expect((await call('search_secrets', { query: 'sho' })).data.count).toBe(1);
    expect((await call('search_secrets', { query: 'nothing' })).data.count).toBe(0);
    expect((await call('search_secrets', { origin: ORIGIN })).data.count).toBe(1);
    expect((await call('search_secrets', { origin: 'https://other.example.test' })).data.count).toBe(0);
    expect((await call('search_secrets', { type: 'credential' })).data.count).toBe(1);
    expect((await call('search_secrets', { type: 'API Key' })).data.count).toBe(0);
    const tooMany = await call('search_secrets', { limit: 500 });
    expect(tooMany.result!.isError).toBe(true);
    expect((await call('search_secrets', { origin: 'ftp://x' })).result!.isError).toBe(true);
  });

  it('never lists a closed, foreign or card secret', async () => {
    const { call } = setup();
    const names = (await call('search_secrets', { limit: 50 })).data.items.map((i: { name: string }) => i.name);
    expect(names).toEqual(['Shop']);
  });
});

describe('get_secret', () => {
  it('returns metadata and non-sensitive fields; sensitive fields are "[hidden]"', async () => {
    const { call, open } = setup();
    const { data } = await call('get_secret', { id: open.id });
    expect(data.secret.fields).toEqual({ username: MCP_CANARY_USERNAME, password: '[hidden]', url: ORIGIN, totp: '[hidden]', notes: 'Shop login' });
    expect(data.secret.version).toBe(1);
  });

  it('answers not found for a closed, foreign, card or missing secret (no difference between them)', async () => {
    const { call, closed, foreign, card } = setup();
    const messages = new Set<string>();
    for (const id of [closed.id, foreign.id, card.id, '99999999-9999-4999-8999-999999999999']) {
      const { result } = await call('get_secret', { id });
      expect(result!.isError).toBe(true);
      expect(result!.structuredContent.code).toBe('NOT_FOUND');
      messages.add(result!.content[0]!.text);
    }
    expect(messages.size).toBe(1);
  });
});

describe('list_secret_types', () => {
  it('lists names and field definitions, never a card type', async () => {
    const { call } = setup();
    const { data } = await call('list_secret_types', {});
    const names = data.types.map((t: { name: string }) => t.name);
    expect(names).toContain('Credential');
    expect(names).toContain('API Key');
    expect(names).not.toContain('Card');
    const credential = data.types.find((t: { name: string }) => t.name === 'Credential');
    expect(credential.canOpenToAgents).toBe(true);
    expect(credential.fields.find((f: { name: string }) => f.name === 'password')).toMatchObject({ required: true, sensitive: true });
    expect(credential.fields.find((f: { name: string }) => f.name === 'username')).toMatchObject({ sensitive: false });
    expect(JSON.stringify(data)).not.toContain('cvv');
  });
});

describe('create_secret', () => {
  it('generatePassword stores a policy-conforming password and returns none', async () => {
    const { call, h } = setup();
    const { data, result } = await call('create_secret', { type: 'Credential', name: 'Generated', fields: { username: 'u@example.test', url: 'https://gen.example.test' }, generatePassword: { length: 30 }, allowAgents: true });
    expect(result!.isError).toBeUndefined();
    expect(data).toMatchObject({ name: 'Generated', type: 'Credential', agentAccess: 'fill', version: 1, passwordGenerated: true, passwordReturned: false });
    const stored = h.rows.find((r) => r.id === data.id)!;
    const password = stored.values.password as string;
    expect(password).toHaveLength(30);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
    expect(JSON.stringify(data)).not.toContain(password);
    // Visible to search afterwards because it was opened to agents.
    expect((await call('search_secrets', { query: 'Generated' })).data.count).toBe(1);
  });

  it('symbols: false yields no symbols', async () => {
    const { call, h } = setup();
    const { data } = await call('create_secret', { type: 'Credential', name: 'NoSym', fields: { username: 'u' }, generatePassword: { symbols: false } });
    const password = h.rows.find((r) => r.id === data.id)!.values.password as string;
    expect(password).toMatch(/^[A-Za-z0-9]{24}$/);
  });

  it('allowAgents defaults to false: created closed, invisible to MCP afterwards', async () => {
    const { call } = setup();
    const { data } = await call('create_secret', { type: 'Credential', name: 'Private', fields: { username: 'u', password: SENT_PASSWORD } });
    expect(data.agentAccess).toBe('none');
    expect(data.note).toMatch(/will not appear/);
    expect((await call('search_secrets', { query: 'Private' })).data.count).toBe(0);
    expect((await call('get_secret', { id: data.id })).result!.isError).toBe(true);
    expect((await call('update_secret', { id: data.id, fields: { notes: 'x' } })).result!.isError).toBe(true);
  });

  it('does not echo what the model sent', async () => {
    const { call, bodies } = setup();
    await call('create_secret', { type: 'Credential', name: 'Sent', fields: { username: 'u', password: SENT_PASSWORD, totp: SENT_TOTP }, allowAgents: true });
    await call('create_secret', { type: 'API Key', name: 'Key A', fields: { key: SENT_KEY, provider: 'Provider A' } });
    const all = bodies.join('\n');
    for (const v of [SENT_PASSWORD, SENT_TOTP, SENT_KEY]) expect(all).not.toContain(v);
  });

  it('refuses a card type, an unknown type, allowAgents on a non-Credential, a double password and a bad length', async () => {
    const { call } = setup();
    expect((await call('create_secret', { type: 'Card', name: 'C', fields: { number: '4111111111111111' } })).result!.structuredContent.code).toBe('TYPE_NOT_SUPPORTED');
    expect((await call('create_secret', { type: 'Nope', name: 'C', fields: {} })).result!.structuredContent.code).toBe('TYPE_NOT_FOUND');
    expect((await call('create_secret', { type: 'API Key', name: 'K', fields: { key: 'k' }, allowAgents: true })).result!.isError).toBe(true);
    expect((await call('create_secret', { type: 'Credential', name: 'D', fields: { username: 'u', password: SENT_PASSWORD }, generatePassword: {} })).result!.isError).toBe(true);
    expect((await call('create_secret', { type: 'API Key', name: 'G', fields: { key: 'k' }, generatePassword: {} })).result!.isError).toBe(true);
    expect((await call('create_secret', { type: 'Credential', name: 'L', fields: { username: 'u' }, generatePassword: { length: 3 } })).result!.isError).toBe(true);
  });
});

describe('update_secret', () => {
  it('changes only the given fields (merged server-side) and returns the new version number', async () => {
    const { call, h, open } = setup();
    const { data } = await call('update_secret', { id: open.id, fields: { notes: 'changed' } });
    expect(data).toEqual({ id: open.id, version: 2, changed: true, updatedFields: ['notes'] });
    expect(h.rows.find((r) => r.id === open.id)!.values).toMatchObject({ username: MCP_CANARY_USERNAME, password: MCP_CANARY_PASSWORD, totp: MCP_CANARY_TOTP, notes: 'changed' });
  });

  it('can set a new password without echoing it, and clears a field with an empty string', async () => {
    const { call, h, open, bodies } = setup();
    await call('update_secret', { id: open.id, fields: { password: SENT_PASSWORD, notes: '' } });
    const stored = h.rows.find((r) => r.id === open.id)!.values;
    expect(stored.password).toBe(SENT_PASSWORD);
    expect(stored).not.toHaveProperty('notes');
    expect(bodies.join('\n')).not.toContain(SENT_PASSWORD);
    expect(bodies.join('\n')).not.toContain(MCP_CANARY_PASSWORD);
  });

  it('a no-op change saves no version', async () => {
    const { call, h, open } = setup();
    const { data } = await call('update_secret', { id: open.id, fields: { notes: 'Shop login' } });
    expect(data).toMatchObject({ changed: false, version: 1 });
    expect(h.state.updates).toBe(0);
  });

  it('refuses to change the website fields, an empty change, and a closed or foreign secret', async () => {
    const { call, open, closed, foreign, h } = setup();
    expect((await call('update_secret', { id: open.id, fields: { url: 'https://evil.example.test' } })).result!.structuredContent.code).toBe('FIELD_NOT_UPDATABLE');
    expect((await call('update_secret', { id: open.id, fields: { additional_urls: 'https://evil.example.test' } })).result!.structuredContent.code).toBe('FIELD_NOT_UPDATABLE');
    expect((await call('update_secret', { id: open.id, fields: {} })).result!.isError).toBe(true);
    expect((await call('update_secret', { id: closed.id, fields: { notes: 'x' } })).result!.structuredContent.code).toBe('NOT_FOUND');
    expect((await call('update_secret', { id: foreign.id, fields: { notes: 'x' } })).result!.structuredContent.code).toBe('NOT_FOUND');
    expect(h.state.updates).toBe(0);
  });
});

describe('canary: no response ever carries a secret value', () => {
  it('across every tool and every argument shape, success and error', async () => {
    const { call, bodies, open, closed, foreign, card, h } = setup();
    const shapes: Array<[string, unknown]> = [
      ['search_secrets', {}], ['search_secrets', { query: 'Shop' }], ['search_secrets', { query: 'Closed' }], ['search_secrets', { origin: ORIGIN }],
      ['search_secrets', { type: 'Credential', limit: 1 }], ['search_secrets', { type: 'Card' }], ['search_secrets', { limit: 0 }], ['search_secrets', { bogus: true }],
      ['get_secret', { id: open.id }], ['get_secret', { id: closed.id }], ['get_secret', { id: foreign.id }], ['get_secret', { id: card.id }], ['get_secret', {}], ['get_secret', { id: 'x' }],
      ['list_secret_types', {}], ['list_secret_types', { extra: 1 }],
      ['create_secret', { type: 'Credential', name: 'N1', fields: { username: 'u', password: SENT_PASSWORD }, allowAgents: true }],
      ['create_secret', { type: 'Credential', name: 'N2', fields: { username: 'u' }, generatePassword: {} }],
      ['create_secret', { type: 'Credential', name: 'N3', fields: { username: 'u' }, generatePassword: { length: 64, symbols: false }, allowAgents: true }],
      ['create_secret', { type: 'API Key', name: 'N4', fields: { key: SENT_KEY } }],
      ['create_secret', { type: 'Card', name: 'N5', fields: { number: '4111111111111111', cvv: '737' } }],
      ['create_secret', { type: 'Credential', name: 'Shop', fields: { username: 'u', password: SENT_PASSWORD } }],
      ['create_secret', { type: 'Credential', name: 'N6', fields: { username: 'u', password: SENT_PASSWORD, bogus: 'x' } }],
      ['update_secret', { id: open.id, fields: { password: SENT_PASSWORD } }],
      ['update_secret', { id: open.id, fields: { totp: SENT_TOTP } }],
      ['update_secret', { id: open.id, fields: { notes: `see ${MCP_CANARY_USERNAME}` } }],
      ['update_secret', { id: open.id, fields: { url: 'https://evil.example.test' } }],
      ['update_secret', { id: closed.id, fields: { password: SENT_PASSWORD } }],
      ['update_secret', { id: open.id, fields: { nope: 'x' } }],
      ['unknown_tool', {}],
    ];
    for (const [name, args] of shapes) await call(name, args);
    // A second pass after the writes, so the new values are in play too.
    for (const [name, args] of shapes.filter(([n]) => n === 'search_secrets' || n === 'get_secret')) await call(name, args);

    const generated = h.rows.flatMap((r) => (typeof r.values.password === 'string' ? [r.values.password] : []));
    const secrets = [MCP_CANARY_PASSWORD, MCP_CANARY_TOTP, SENT_PASSWORD, SENT_KEY, SENT_TOTP, 'ClosedPw-1-do-not-leak', 'ForeignPw-1-do-not-leak', '4111111111111111', ...generated];
    expect(generated.length).toBeGreaterThan(3);
    const all = bodies.join('\n');
    for (const s of secrets) expect(all).not.toContain(s);
    // The audit trail too.
    const trail = JSON.stringify(h.audit.events);
    for (const s of secrets) expect(trail).not.toContain(s);
  });
});

describe('keyvalue fields (issue #206): a sensitive entry\'s value never leaves', () => {
  const KV_SECRET = 'KvEntrySecret-8Wm4-do-not-leak';
  const KV_SENSITIVE_FIELD_VALUE = 'KvFieldSecret-2Lp6-do-not-leak';

  function setupKeyValue() {
    const s = setup();
    // A test-only definition: the Credential type gains a non-sensitive and a sensitive keyvalue field.
    const credential = s.h.types.find((t) => t.name === 'Credential')!;
    const extraFields: SecretTypeField[] = [
      { name: 'extras', label: 'Extras', type: 'keyvalue', required: false, sensitive: false },
      { name: 'private_extras', label: 'Private extras', type: 'keyvalue', required: false, sensitive: true },
    ];
    credential.fields = [...credential.fields, ...extraFields];
    const kv = s.h.add({
      userId: 'user-aaa', type: 'Credential', name: 'With extras', agentAccess: 'fill',
      values: {
        username: 'person-b@example.test', password: 'KvPw-1-do-not-leak', url: 'https://kv.example.test',
        extras: [
          { key: 'member_number', label: 'Member number', value: 'M-0001', sensitive: false },
          { key: 'recovery_code', label: 'Recovery code', value: KV_SECRET, sensitive: true },
        ],
        private_extras: [{ key: 'plan_code', label: 'Plan code', value: KV_SENSITIVE_FIELD_VALUE, sensitive: false }],
      },
    });
    return { ...s, kv };
  }

  it('renders label: value lines, a sensitive entry as [withheld], a sensitive field as [hidden]', async () => {
    const { call, kv } = setupKeyValue();
    const { data } = await call('get_secret', { id: kv.id });
    expect(data.secret.fields.extras).toBe('Member number: M-0001\nRecovery code: [withheld]');
    expect(data.secret.fields.private_extras).toBe('[hidden]');
    const found = (await call('search_secrets', { query: 'With extras' })).data.items[0];
    expect(found.fields.extras).toBe('Member number: M-0001\nRecovery code: [withheld]');
    expect(found.fields).not.toHaveProperty('private_extras');
  });

  it('keeps every sensitive entry value out of every tool result and the audit trail', async () => {
    const { call, bodies, kv, h } = setupKeyValue();
    await call('search_secrets', {});
    await call('search_secrets', { query: 'With extras' });
    await call('get_secret', { id: kv.id });
    await call('list_secret_types', {});
    await call('update_secret', { id: kv.id, fields: { notes: 'kv notes' } });
    await call('get_secret', { id: kv.id });
    const all = bodies.join('\n');
    expect(all).toContain('M-0001');
    for (const s of [KV_SECRET, KV_SENSITIVE_FIELD_VALUE]) {
      expect(all).not.toContain(s);
      expect(JSON.stringify(h.audit.events)).not.toContain(s);
    }
  });
});
