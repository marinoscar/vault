// =============================================================================
// The conformance kit (`./agent-testing`, issue #196): the fake Vault, the canaries, the scenarios
// =============================================================================
//
// The whole scenario list runs against the fake with the reference runtime (all pass), and with a
// careless runtime that breaks the guide's rules (the matching scenarios fail): the kit catches
// what it claims to. Vault's API tests run the same list against the real `/api/agent/v1`
// (apps/api/test/agent/agent-conformance-kit.db.spec.ts), so the fake cannot drift from Vault.
// =============================================================================

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AGENT_API_BASE_PATH,
  AGENT_CONTRACT_VERSION,
  agentCardsLookupResponseSchema,
  agentIdentityLookupResponseSchema,
  agentLookupResponseSchema,
  agentWhoamiResponseSchema,
} from '../src/agent/index.js';
import {
  AGENT_CONFORMANCE_SCENARIOS,
  AgentConformanceError,
  CONFORMANCE_ORIGINS,
  CanaryLeakError,
  ConformanceKitInProductionError,
  assertAgentConformance,
  assertNoCanary,
  conformanceTotp,
  createCanary,
  createConformanceSeed,
  createFakeVault,
  createReferenceSignIn,
  findCanaries,
  runAgentConformance,
  seedCanaries,
  type AgentTokens,
  type ConformanceSignIn,
  type FakeVault,
} from '../src/agent-testing/index.js';

const json = async (res: Response) => ({ status: res.status, headers: res.headers, body: (await res.json()) as any });

describe('agent-testing: the production guard and the seed', () => {
  it('the fake refuses to be created or started with NODE_ENV=production', async () => {
    expect(() => createFakeVault({ env: { NODE_ENV: 'production' } })).toThrow(ConformanceKitInProductionError);
    const env: Record<string, string | undefined> = { NODE_ENV: 'test' };
    const fake = createFakeVault({ env });
    env.NODE_ENV = 'production';
    await expect(fake.start()).rejects.toThrow(/NODE_ENV=production/);
  });

  it('the runner refuses to run with NODE_ENV=production', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(runAgentConformance({ target: {} as never })).rejects.toThrow(ConformanceKitInProductionError);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('seeds only invented data: Person A, .test hosts, the published test card number, random canaries', () => {
    const seed = createConformanceSeed();
    const text = JSON.stringify(seed);
    for (const origin of Object.values(CONFORMANCE_ORIGINS)) expect(new URL(origin).hostname).toMatch(/\.test$/);
    for (const login of Object.values(seed.logins)) {
      expect(login.username).toMatch(/@example\.test$/);
      for (const origin of login.origins) expect(origin).toMatch(/\.example\.test$/);
    }
    expect(seed.card.number).toBe('4242424242424242');
    expect(seed.card.holderName).toBe('Person A');
    expect(seed.identity.values.full_name).toBe('Person A');
    expect(seed.canaries.length).toBeGreaterThanOrEqual(6);
    expect(seed.canaries.every((c) => c.length >= 12)).toBe(true);
    // Fresh canaries every time: a leaked value from one run cannot match another.
    expect(createConformanceSeed().logins.primary.password).not.toBe(seed.logins.primary.password);
    expect(text).not.toMatch(/@(?!example\.test)[a-z0-9.-]+\.(com|org|net)\b/);
  });
});

describe('agent-testing: canaries', () => {
  const [a, b] = seedCanaries(['password', 'code']);

  it('creates distinct, labelled canaries', () => {
    expect(a).toMatch(/^cnry-password-[0-9a-f]{20}$/);
    expect(seedCanaries(3)).toHaveLength(3);
    expect(new Set(seedCanaries(5)).size).toBe(5);
    expect(createCanary('x y!')).toMatch(/^cnry-xy-/);
  });

  it('finds a canary raw, JSON-escaped, URL-encoded, as hex, UTF-16LE, base64 at any alignment and base64url', () => {
    const tricky = 'cnry-pw-"quoted"/slash+plus';
    const variants: Array<[string, string | Uint8Array]> = [
      ['raw', `log line ${a} end`],
      ['json', JSON.stringify({ body: tricky })],
      ['url', `GET /x?v=${encodeURIComponent(tricky)}`],
      ['hex', Buffer.from(`xx${a}yy`).toString('hex').toUpperCase()],
      ['utf16le', Buffer.from(`trace ${a}`, 'utf16le')],
      ['base64', Buffer.from(`z${a}`).toString('base64')],
      ['base64', Buffer.from(`zz${a}`).toString('base64')],
      ['base64', Buffer.from(`zzz${a}`).toString('base64')],
      ['base64url', Buffer.from(`?>${tricky}`).toString('base64url')],
    ];
    for (const [encoding, source] of variants) {
      const hits = findCanaries([a!, tricky], source).map((h) => h.encoding);
      // base64url text without '-' or '_' is also plain base64; either name is a find.
      if (encoding === 'base64url') expect(hits.some((h) => h.startsWith('base64'))).toBe(true);
      else expect(hits).toContain(encoding);
    }
    expect(findCanaries([a!, b!], 'nothing to see', new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it('scans files and folders, and the error names where, never the value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-'));
    try {
      mkdirSync(join(dir, 'nested'));
      writeFileSync(join(dir, 'clean.log'), 'all good');
      writeFileSync(join(dir, 'nested', 'trace.json'), JSON.stringify({ attr: b }));
      expect(() => assertNoCanary([a!], { files: [dir] })).not.toThrow();
      let error: unknown;
      try {
        assertNoCanary([a!, b!], { file: dir }, { label: 'transcript', content: `the model saw ${a}` });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(CanaryLeakError);
      const message = (error as Error).message;
      expect(message).toContain('trace.json');
      expect(message).toContain('transcript');
      expect(message).not.toContain(a!);
      expect(message).not.toContain(b!);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a canary short enough to match by chance', () => {
    expect(() => findCanaries(['short'], 'short')).toThrow(RangeError);
  });
});

describe('agent-testing: the fake Vault', () => {
  let fake: FakeVault;
  let api: string;
  let tokens: AgentTokens;
  const get = (path: string, token = tokens.accessToken) => fetch(`${api}${path}`, { headers: { authorization: `Bearer ${token}` } }).then(json);
  const post = (path: string, body: unknown, token = tokens.accessToken) =>
    fetch(`${api}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(json);

  beforeAll(async () => {
    fake = createFakeVault();
    api = `${await fake.start()}${AGENT_API_BASE_PATH}`;
    tokens = await fake.connect();
  });
  afterAll(() => fake.stop());

  it('whoami answers with the contract block; every answer is no-store', async () => {
    const res = await get('/whoami');
    expect(res.status).toBe(200);
    const data = agentWhoamiResponseSchema.parse(res.body).data;
    expect(data.contract).toEqual({ version: AGENT_CONTRACT_VERSION, features: ['logins', 'totp', 'cards', 'identity'] });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await get('/credentials?origin=')).headers.get('cache-control')).toBe('no-store');
  });

  it('binds origins exactly and answers one identical 404', async () => {
    const { ids, logins, origins } = fake.fixture;
    const exact = agentLookupResponseSchema.parse((await get(`/credentials?origin=${encodeURIComponent(origins.exact)}`)).body).data;
    expect(exact[0]).toMatchObject({ id: ids.primary, matchKind: 'exact', username: logins.primary.username, hasTotp: true });
    expect(exact.map((r) => r.id)).not.toContain(ids.closed);
    expect(JSON.stringify(exact)).not.toContain(logins.primary.password);
    const wrong = await post(`/credentials/${ids.primary}/fill`, { field: 'password', origin: origins.siteOnly, purpose: 'login' });
    expect([wrong.status, wrong.body.code]).toEqual([403, 'ORIGIN_MISMATCH']);
    const right = await post(`/credentials/${ids.primary}/fill`, { field: 'password', origin: origins.exact, purpose: 'login' });
    expect(right.body).toEqual({ data: { value: logins.primary.password } });
    const closed = await post(`/credentials/${ids.closed}/fill`, { field: 'password', origin: origins.exact, purpose: 'login' });
    const missing = await post('/credentials/00000000-0000-4000-8000-0000000fffff/fill', { field: 'password', origin: origins.exact, purpose: 'login' });
    expect(closed.status).toBe(404);
    expect({ ...closed.body, timestamp: 0, path: 0 }).toEqual({ ...missing.body, timestamp: 0, path: 0 });
    expect((await post('/credentials/not-a-uuid/fill', {})).status).toBe(400);
    expect((await post(`/credentials/${ids.primary}/fill`, { field: 'notes', origin: origins.exact, purpose: 'login' })).status).toBe(400);
  });

  it('returns the code Vault would compute', async () => {
    const { ids, logins, origins } = fake.fixture;
    const res = await post(`/credentials/${ids.primary}/totp`, { origin: origins.exact, purpose: 'mfa' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe(conformanceTotp(logins.primary.totpSeed!)!.code);
  });

  it('creates and rotates with a generated password returned once', async () => {
    const created = await post('/credentials', {
      name: 'New login', username: 'person-b@example.test', origin: 'https://new.example.test', purpose: 'signup', generate: { length: 20, symbols: false },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.generatedPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    const rotated = await post(`/credentials/${created.body.data.id}/password`, { origin: 'https://new.example.test', purpose: 'password_change', password: createCanary('rotated') });
    expect(rotated.body.data).toEqual({ id: created.body.data.id, version: 2 });
    expect((await post('/credentials', { name: 'New login', username: 'x', origin: 'https://new.example.test', purpose: 'signup', password: 'p' })).status).toBe(409);
  });

  it('enforces scopes with insufficient_scope, and a revoked or unknown token is 401', async () => {
    const readOnly = await fake.connect(['vault:items_read']);
    const res = await post(`/credentials/${fake.fixture.ids.primary}/fill`, { field: 'username', origin: fake.fixture.origins.exact, purpose: 'login' }, readOnly.accessToken);
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toMatch(/insufficient_scope/);
    expect((await get('/whoami', 'oat_unknown')).status).toBe(401);
  });

  it('rotates refresh tokens, and a replayed refresh token revokes the whole grant', async () => {
    const mine = await fake.connect();
    const refresh = (token: string) =>
      fetch(`${fake.baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: 'client-a' }),
      }).then(json);
    const first = await refresh(mine.refreshToken!);
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).not.toBe(mine.refreshToken);
    expect((await get('/whoami', first.body.access_token)).status).toBe(200);
    const replay = await refresh(mine.refreshToken!);
    expect([replay.status, replay.body.error]).toEqual([400, 'invalid_grant']);
    expect((await get('/whoami', first.body.access_token)).status).toBe(401);
    expect((await refresh(first.body.refresh_token)).status).toBe(400);
  });

  it('counts per-minute limits and answers 429 with Retry-After', async () => {
    const limited = createFakeVault({ limits: { lookup: 2 } });
    const base = `${await limited.start()}${AGENT_API_BASE_PATH}`;
    try {
      const { accessToken } = await limited.connect();
      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let i = 0; i < 3; i += 1) {
        const res = await fetch(`${base}/credentials?origin=app.example.test`, { headers: { authorization: `Bearer ${accessToken}` } });
        statuses.push(res.status);
        if (res.status === 429) retryAfter = res.headers.get('retry-after');
      }
      expect(statuses).toEqual([200, 200, 429]);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
      expect(limited.requests.at(-1)).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    } finally {
      await limited.stop();
    }
  });

  it('serves cards under merchant grants and identity with sensitive fields on allowed origins only', async () => {
    const { ids, card, identity, origins } = fake.fixture;
    const cards = agentCardsLookupResponseSchema.parse((await get(`/cards?origin=${encodeURIComponent('https://checkout.shop.example.test')}`)).body).data;
    expect(cards).toEqual([expect.objectContaining({ id: ids.card, last4: '4242' })]);
    expect(JSON.stringify(cards)).not.toContain(card.number);
    const fill = (body: object) => post(`/cards/${ids.card}/fill`, { field: 'number', origin: origins.shop, amount: 20, currency: 'USD', purpose: 'purchase', ...body });
    expect((await fill({})).body.data.value).toBe(card.number);
    expect((await fill({ amount: 1000 })).body.code).toBe('CARD_AMOUNT_EXCEEDED');
    expect((await fill({ currency: 'EUR' })).body.code).toBe('CARD_CURRENCY_MISMATCH');
    expect((await fill({ frameOrigin: 'https://other-pay.example.test' })).body.code).toBe('ORIGIN_MISMATCH');
    expect((await fill({ origin: 'https://another-shop.test' })).body.code).toBe('ORIGIN_MISMATCH');
    const asked = await post(`/cards/${ids.card}/grant-requests`, { origin: 'https://another-shop.test', amount: 15, currency: 'USD', reason: 'Order 1' });
    expect(asked.body.data.status).toBe('pending');
    fake.decideGrantRequest(asked.body.data.id, 'approved');
    expect((await fill({ origin: 'https://another-shop.test', amount: 15 })).status).toBe(200);

    const items = agentIdentityLookupResponseSchema.parse((await get(`/identity?origin=${encodeURIComponent(origins.exact)}`)).body).data;
    expect(items[0]!.fields.find((f) => f.field === 'id_number')).toMatchObject({ sensitive: true, fillable: false });
    const idFill = (origin: string) => post(`/identity/${ids.identity}/fill`, { field: 'id_number', origin, purpose: 'form' });
    expect((await idFill(origins.exact)).body.code).toBe('ORIGIN_MISMATCH');
    expect((await idFill(origins.forms)).body.data.value).toBe(identity.values.id_number);

    await fake.setCardAccess(false);
    expect((await get(`/cards?origin=${encodeURIComponent(origins.shop)}`)).body.code).toBe('CARD_ACCESS_DISABLED');
    await fake.setCardAccess(true);
  });

  it('records method, path and status of every call, never a body or a token', () => {
    const text = JSON.stringify(fake.requests);
    expect(fake.requests.length).toBeGreaterThan(10);
    for (const canary of fake.fixture.canaries) expect(text).not.toContain(canary);
    expect(text).not.toContain(tokens.accessToken);
  });
});

describe('agent-testing: the scenario suite', () => {
  it('lists every scenario the issue names, as data', () => {
    const ids = AGENT_CONFORMANCE_SCENARIOS.map((s) => s.id);
    for (const id of [
      'runtime.exact-match-fills',
      'runtime.site-match-not-filled',
      'runtime.origin-mismatch-stops',
      'runtime.several-matches-ask',
      'runtime.code-right-before-typing',
      'runtime.revoked-grant-reconnects',
      'runtime.retry-after-honoured',
      'runtime.no-cache-across-pages',
      'runtime.kill-switch-reported',
    ]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of AGENT_CONFORMANCE_SCENARIOS) expect(s.expectation.length).toBeGreaterThan(20);
  });

  it('the reference runtime passes every scenario against the fake', async () => {
    const fake = createFakeVault();
    await fake.start();
    const logs: string[] = [];
    try {
      const report = await assertAgentConformance({ target: fake, signIn: createReferenceSignIn(), artifacts: () => [logs.join('\n')] });
      expect(report.results.filter((r) => r.status !== 'passed')).toEqual([]);
      expect(report.results).toHaveLength(AGENT_CONFORMANCE_SCENARIOS.length);
    } finally {
      await fake.stop();
    }
  }, 30_000);

  it('without a signIn only the server scenarios run; the runtime ones are skipped, not passed', async () => {
    const fake = createFakeVault();
    await fake.start();
    try {
      const report = await runAgentConformance({ target: fake });
      expect(report.passed).toBe(true);
      expect(report.results.filter((r) => r.kind === 'server').every((r) => r.status === 'passed')).toBe(true);
      expect(report.results.filter((r) => r.kind === 'runtime').every((r) => r.status === 'skipped')).toBe(true);
    } finally {
      await fake.stop();
    }
  });

  it('a careless runtime fails the scenarios for each rule it breaks', async () => {
    const leaked: string[] = [];
    let token: string | null = null;
    let cached: Array<{ id: string }> | null = null;
    // Breaks the guide on purpose: takes any match, caches the lookup, retries refusals at once,
    // fetches the code first, keeps values as strings, logs them, and throws on the kill switch.
    const careless: ConformanceSignIn = async (page, vault) => {
      const call = async (method: string, path: string, body?: unknown): Promise<any> => {
        for (let i = 0; i < 3; i += 1) {
          if (!token) token = (await vault.connect()).accessToken;
          const res = await fetch(`${vault.apiBaseUrl}${path}`, {
            method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
          });
          const out = (await res.json()) as any;
          if (res.ok) return out.data;
          if (out.code === 'AGENT_ACCESS_DISABLED') throw new Error('vault is off');
        }
        throw new Error('gave up');
      };
      try {
        cached ??= await call('GET', `/credentials?origin=${encodeURIComponent(page.origin)}`);
        const login = cached![0];
        if (!login) return { status: 'no_login' };
        const origin = page.origin;
        if (page.asksForCode) var code = (await call('POST', `/credentials/${login.id}/totp`, { origin, purpose: 'mfa' })).code as string;
        for (const field of ['username', 'password'] as const) {
          const { value } = await call('POST', `/credentials/${login.id}/fill`, { field, origin, purpose: 'login' });
          leaked.push(`typing ${field}=${value}`);
          await page.type(field, value);
        }
        if (page.asksForCode) await page.type('code', code!);
        return { status: 'signed_in' };
      } catch (error) {
        if ((error as Error).message === 'vault is off') throw error;
        return { status: 'stopped' };
      }
    };

    const fake = createFakeVault();
    await fake.start();
    try {
      const report = await runAgentConformance({ target: fake, signIn: careless, artifacts: () => [leaked.join('\n')] });
      const failed = report.results.filter((r) => r.status === 'failed').map((r) => r.id);
      expect(report.passed).toBe(false);
      expect(failed).toEqual(
        expect.arrayContaining([
          'runtime.site-match-not-filled',
          'runtime.code-right-before-typing',
          'runtime.no-cache-across-pages',
          'runtime.kill-switch-reported',
          'runtime.no-value-in-artifacts',
        ]),
      );
      expect(report.results.filter((r) => r.kind === 'server').every((r) => r.status === 'passed')).toBe(true);
      await expect(assertAgentConformance({ target: fake, signIn: careless, only: ['runtime.kill-switch-reported'] })).rejects.toBeInstanceOf(
        AgentConformanceError,
      );
      // The report never repeats a value it found.
      const text = JSON.stringify(report);
      for (const canary of fake.fixture.canaries) expect(text).not.toContain(canary);
    } finally {
      await fake.stop();
    }
  }, 30_000);
});
