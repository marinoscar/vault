import { randomUUID } from 'node:crypto';

import {
  AGENT_API_BASE_PATH,
  AGENT_ERROR_CODES,
  agentFillResponseSchema,
  agentLookupResponseSchema,
  agentTotpResponseSchema,
  agentWhoamiResponseSchema,
} from '../agent/index.js';
import { findCanaries, type CanarySource } from './canary.js';
import type { AgentConformanceTarget, AgentTokens } from './fake-vault.js';
import { assertNotProduction } from './guard.js';
import { ConformanceLog, startRecorder, type ConformanceEvent, type ConformanceRecorder } from './recorder.js';
import type { ConformanceFixture } from './seed.js';

// =============================================================================
// What a runtime implements
// =============================================================================

/** A field of the simulated sign-in form. @stability beta */
export type ConformanceField = 'username' | 'password' | 'code';

/** A choice offered to the person. @stability beta */
export interface ConformanceChoice {
  /** The credential id the choice stands for. */
  id: string;
  label: string;
}

/**
 * The simulated page a runtime signs in to. It stands for the browser tab: its top-level origin
 * (read it from here, never from model output), the form's fields, and the person behind the screen.
 *
 * @stability beta
 */
export interface ConformancePage {
  /** The page's top-level origin, now. It can change between reads (the page navigated). */
  readonly origin: string;
  /** Whether the site asks for a one-time code after the password. */
  readonly asksForCode: boolean;
  /** Types a value into a field. Pass a `Uint8Array` you zero right after, where you can. */
  type(field: ConformanceField, value: string | Uint8Array): Promise<void>;
  /** Asks the person to pick one of several logins; resolves to the chosen `id`, or `null`. */
  askPerson(question: string, choices: readonly ConformanceChoice[]): Promise<string | null>;
}

/**
 * How a sign-in ended. `stopped` carries the Vault `code` that stopped it (for example
 * `AGENT_ACCESS_DISABLED` or `ORIGIN_MISMATCH`), which is what the runtime reports to the person.
 *
 * @stability beta
 */
export type SignInResult =
  | { status: 'signed_in' }
  | { status: 'no_login'; message?: string }
  | { status: 'stopped'; code?: string; message?: string };

/**
 * What the kit hands the runtime on every call: where the Vault is and how to get tokens.
 *
 * @stability beta
 */
export interface ConformanceVaultAccess {
  /** The Vault's base URL (the kit's recorder in front of it). */
  baseUrl: string;
  /** `baseUrl + AGENT_API_BASE_PATH`. */
  apiBaseUrl: string;
  /**
   * The person connects the runtime (consent): fresh tokens for the login scopes. Call it when you
   * hold no token, and after a `401` (a revoked grant); never in a loop.
   */
  connect(): Promise<AgentTokens>;
  /** The id of the running scenario, for the runtime's own logs. */
  scenario: string;
}

/** The function a runtime gives the kit: "sign in to this page". @stability beta */
export type ConformanceSignIn = (page: ConformancePage, vault: ConformanceVaultAccess) => Promise<SignInResult>;

// =============================================================================
// The scenario list (data)
// =============================================================================

/** One scenario, as data. `server` scenarios check the Vault; `runtime` ones check the sign-in. @stability beta */
export interface AgentConformanceScenario {
  id: string;
  kind: 'server' | 'runtime';
  title: string;
  /** What passing requires, in plain words. */
  expectation: string;
}

/**
 * Every scenario of the kit, in run order. The `server` ones first (they check that the Vault in
 * front of the runtime behaves like Vault), then the `runtime` ones (the guide's rules).
 *
 * @stability beta
 */
export const AGENT_CONFORMANCE_SCENARIOS: readonly AgentConformanceScenario[] = Object.freeze([
  {
    id: 'server.whoami-contract',
    kind: 'server',
    title: 'whoami reports the contract',
    expectation: '`GET /whoami` answers 200 with userId, scopes, clientId and contract { version 1.x, features with logins }.',
  },
  {
    id: 'server.exact-origin-binding',
    kind: 'server',
    title: 'Only an exact origin is fillable',
    expectation:
      'Lookup on the exact origin lists the opened login as `exact` (never the closed one); on the same site it is `site`; a fill with the site origin is 403 ORIGIN_MISMATCH; a fill with the exact origin returns `{ value }`.',
  },
  {
    id: 'server.identical-404',
    kind: 'server',
    title: 'Missing and closed answer one identical 404',
    expectation: 'A fill of a closed login and of an unknown id both answer 404 with the same status, code and message.',
  },
  {
    id: 'server.no-store',
    kind: 'server',
    title: 'Every answer is no-store',
    expectation: 'Every response of the agent API in the run, errors included, carries `Cache-Control: no-store`.',
  },
  {
    id: 'server.kill-switch',
    kind: 'server',
    title: 'The kill switch closes every route',
    expectation: 'With `agentAccess.enabled` off, `whoami` and lookup answer 403 AGENT_ACCESS_DISABLED.',
  },
  {
    id: 'server.retry-after',
    kind: 'server',
    title: 'A rate limit says when to come back',
    expectation: 'A throttled call answers 429 RATE_LIMITED with a whole-second `Retry-After` header.',
  },
  {
    id: 'server.revoked-grant',
    kind: 'server',
    title: 'A revoked grant is 401',
    expectation: 'After the owner revokes the grant, the next call with its access token answers 401.',
  },
  {
    id: 'runtime.exact-match-fills',
    kind: 'runtime',
    title: 'An exact match fills',
    expectation:
      'On the exact origin the runtime signs in: it types the login\'s username and password, asks for one field per call with the page\'s own origin, fetches no code the page did not ask for, and zeroes any byte buffer it typed.',
  },
  {
    id: 'runtime.site-match-not-filled',
    kind: 'runtime',
    title: 'A site-only match is not filled',
    expectation: 'On another host of the same site the runtime fills nothing and types nothing (no_login, or it asks the person).',
  },
  {
    id: 'runtime.origin-mismatch-stops',
    kind: 'runtime',
    title: 'ORIGIN_MISMATCH stops, without a retry',
    expectation:
      'The page moves to a look-alike site after the lookup. The runtime sends the page\'s current origin, types nothing, makes no call after a 403 ORIGIN_MISMATCH, and ends `stopped` (ORIGIN_MISMATCH) or `no_login`.',
  },
  {
    id: 'runtime.several-matches-ask',
    kind: 'runtime',
    title: 'Several matches ask the person',
    expectation: 'With two exact matches the runtime asks the person before any fill, then types the chosen login.',
  },
  {
    id: 'runtime.code-right-before-typing',
    kind: 'runtime',
    title: 'A code is fetched right before typing',
    expectation:
      'When the page asks for a code, the runtime fetches it after typing the password, types exactly the code Vault returned, with no other Vault call in between, within 5 seconds.',
  },
  {
    id: 'runtime.revoked-grant-reconnects',
    kind: 'runtime',
    title: 'A revoked grant reconnects',
    expectation: 'After a 401 the runtime calls `connect()` (at most twice), does not loop on 401, and signs in.',
  },
  {
    id: 'runtime.retry-after-honoured',
    kind: 'runtime',
    title: '429 waits for Retry-After',
    expectation: 'After a 429 the runtime calls the same route again only once `Retry-After` has passed, and signs in.',
  },
  {
    id: 'runtime.no-cache-across-pages',
    kind: 'runtime',
    title: 'Nothing is cached across pages',
    expectation:
      'Two visits to the same site: the second one looks the login up again; when the owner closed the login in between, nothing is filled or typed.',
  },
  {
    id: 'runtime.kill-switch-reported',
    kind: 'runtime',
    title: 'The kill switch is reported plainly',
    expectation: 'With agent access off the runtime ends `stopped` with code AGENT_ACCESS_DISABLED, types nothing and does not retry.',
  },
  {
    id: 'runtime.no-value-in-artifacts',
    kind: 'runtime',
    title: 'No value reaches the runtime\'s artifacts',
    expectation:
      'No seeded secret, generated password or code seen in the run appears in the logs, traces, transcripts or files the runtime hands the kit (skipped when it hands none).',
  },
]);

/** A scenario id. @stability beta */
export type AgentConformanceScenarioId = string;

// =============================================================================
// Results
// =============================================================================

/** One scenario's outcome. @stability beta */
export interface AgentConformanceResult {
  id: string;
  kind: 'server' | 'runtime';
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  /** Why it failed or was skipped. Never a secret value. */
  problems: string[];
  durationMs: number;
}

/** A whole run. @stability beta */
export interface AgentConformanceReport {
  passed: boolean;
  results: AgentConformanceResult[];
}

/** Thrown by {@link assertAgentConformance} when a scenario failed. @stability beta */
export class AgentConformanceError extends Error {
  constructor(readonly report: AgentConformanceReport) {
    super(
      `Agent conformance failed:\n${report.results
        .filter((r) => r.status === 'failed')
        .map((r) => `- ${r.id}: ${r.problems.join('; ')}`)
        .join('\n')}`,
    );
    this.name = 'AgentConformanceError';
  }
}

/** Options of {@link runAgentConformance}. @stability beta */
export interface AgentConformanceOptions {
  /** The Vault: a {@link createFakeVault} (started) or a real deployment wrapped in the target interface. */
  target: AgentConformanceTarget;
  /** The runtime's "sign in to this page". Required for `runtime` scenarios; without it they are skipped. */
  signIn?: ConformanceSignIn;
  /** Run only these scenario ids (default: all). */
  only?: readonly string[];
  /** Everything the runtime wrote during the run (logs, traces, transcripts, `{ files }`), for the canary scan. */
  artifacts?: () => CanarySource[] | Promise<CanarySource[]>;
  /** Per scenario (default 20 s). */
  timeoutMs?: number;
}

// =============================================================================
// The runner
// =============================================================================

class SimulatedPage implements ConformancePage {
  readonly typed: Array<{ field: ConformanceField; value: string; buffer: Uint8Array | null }> = [];
  asked = 0;

  constructor(
    private currentOrigin: string,
    readonly asksForCode: boolean,
    private readonly log: ConformanceLog,
    private readonly answer: (choices: readonly ConformanceChoice[]) => string | null = () => null,
  ) {}

  get origin(): string {
    return this.currentOrigin;
  }

  navigate(origin: string): void {
    this.currentOrigin = origin;
  }

  async type(field: ConformanceField, value: string | Uint8Array): Promise<void> {
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
    this.typed.push({ field, value: text, buffer: typeof value === 'string' ? null : value });
    this.log.push({ kind: 'type', field, value: text, pageOrigin: this.currentOrigin });
  }

  async askPerson(_question: string, choices: readonly ConformanceChoice[]): Promise<string | null> {
    this.asked += 1;
    const answer = this.answer(choices);
    this.log.push({ kind: 'ask', choices: choices.length, answer });
    return answer;
  }
}

type RequestEvent = Extract<ConformanceEvent, { kind: 'request' }>;
type ResponseEvent = Extract<ConformanceEvent, { kind: 'response' }>;

interface RunContext {
  target: AgentConformanceTarget;
  fixture: ConformanceFixture;
  log: ConformanceLog;
  recorder: ConformanceRecorder;
  access: (scenario: string) => ConformanceVaultAccess;
  signIn?: ConformanceSignIn;
  connects: { count: number };
  artifacts?: AgentConformanceOptions['artifacts'];
  /** Every value the run saw (seeded canaries, generated passwords, codes). */
  seenValues: Set<string>;
}

const api = (path: string) => `${AGENT_API_BASE_PATH}${path}`;
const isAgentPath = (path: string) => path.startsWith(`${AGENT_API_BASE_PATH}/`);
const requestsOf = (events: ConformanceEvent[]) => events.filter((e): e is RequestEvent => e.kind === 'request' && isAgentPath(e.path));
const responsesOf = (events: ConformanceEvent[]) => events.filter((e): e is ResponseEvent => e.kind === 'response' && isAgentPath(e.path));
const isFill = (path: string) => /\/credentials\/[^/]+\/fill$/.test(path);
const isTotp = (path: string) => /\/credentials\/[^/]+\/totp$/.test(path);
const isLookup = (path: string) => path === api('/credentials');

/** A small client the server scenarios use, through the recorder. */
async function call(
  ctx: RunContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${ctx.recorder.baseUrl}${api(path)}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

function check(problems: string[], ok: boolean, problem: string): void {
  if (!ok) problems.push(problem);
}

/** Runs one sign-in on a fresh simulated page; collects the events of that page only. */
async function visit(
  ctx: RunContext,
  scenario: string,
  page: SimulatedPage,
  hook?: (event: ResponseEvent, page: SimulatedPage) => void,
): Promise<{ result: SignInResult | null; error: unknown; events: ConformanceEvent[] }> {
  const start = ctx.log.events.length;
  ctx.recorder.pageOrigin = () => page.origin;
  ctx.recorder.onResponse = hook ? (event) => hook(event, page) : null;
  let result: SignInResult | null = null;
  let error: unknown = null;
  try {
    result = await ctx.signIn!(page, ctx.access(scenario));
  } catch (e) {
    error = e;
  } finally {
    ctx.recorder.onResponse = null;
    ctx.recorder.pageOrigin = () => null;
  }
  const events = ctx.log.events.slice(start);
  for (const e of events) {
    if (e.kind === 'response' && e.body && typeof e.body === 'object') {
      const data = (e.body as { data?: Record<string, unknown> }).data;
      for (const key of ['value', 'code', 'generatedPassword']) {
        const v = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
        if (typeof v === 'string' && v.length >= 12) ctx.seenValues.add(v);
      }
    }
  }
  return { result, error, events };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}` : 'a non-Error value';
}

/** Problems common to every runtime visit: nothing typed must contain a secret where it should not. */
function noTyping(problems: string[], page: SimulatedPage, what: string): void {
  check(problems, page.typed.length === 0, `${what}: the runtime typed ${page.typed.length} value(s) into the page`);
}

const scenarioImpl: Record<string, (ctx: RunContext, problems: string[]) => Promise<void | 'skipped'>> = {
  // ---------------------------------------------------------------------------
  // Server
  // ---------------------------------------------------------------------------
  'server.whoami-contract': async (ctx, problems) => {
    const { accessToken } = await ctx.target.connect();
    const res = await call(ctx, accessToken, 'GET', '/whoami');
    check(problems, res.status === 200, `whoami answered ${res.status}, expected 200`);
    const parsed = agentWhoamiResponseSchema.safeParse(res.body);
    check(problems, parsed.success, 'whoami does not match agentWhoamiResponseSchema');
    const contract = parsed.success ? parsed.data.data.contract : undefined;
    check(problems, Boolean(contract && /^1\.\d+$/.test(contract.version)), 'whoami.contract.version is not 1.x');
    check(problems, Boolean(contract?.features.includes('logins')), 'whoami.contract.features does not list logins');
  },
  'server.exact-origin-binding': async (ctx, problems) => {
    const { origins, ids, logins } = ctx.fixture;
    const { accessToken } = await ctx.target.connect();
    const exact = await call(ctx, accessToken, 'GET', `/credentials?origin=${encodeURIComponent(origins.exact)}`);
    const parsed = agentLookupResponseSchema.safeParse(exact.body);
    check(problems, exact.status === 200 && parsed.success, `lookup on the exact origin answered ${exact.status} or an invalid shape`);
    const rows = parsed.success ? parsed.data.data : [];
    check(problems, rows.some((r) => r.id === ids.primary && r.matchKind === 'exact'), 'lookup does not list the opened login as exact');
    check(problems, !rows.some((r) => r.id === ids.closed), 'lookup lists a login its owner did not open');
    check(problems, rows.every((r) => !JSON.stringify(r).includes(logins.primary.password)), 'lookup carries a password');
    const site = await call(ctx, accessToken, 'GET', `/credentials?origin=${encodeURIComponent(origins.siteOnly)}`);
    const siteRows = agentLookupResponseSchema.safeParse(site.body);
    check(
      problems,
      siteRows.success && siteRows.data.data.length > 0 && siteRows.data.data.every((r) => r.matchKind === 'site'),
      'lookup on another host of the same site does not list only site matches',
    );
    const wrong = await call(ctx, accessToken, 'POST', `/credentials/${ids.primary}/fill`, { field: 'password', origin: origins.siteOnly, purpose: 'login' });
    check(problems, wrong.status === 403 && wrong.body?.code === AGENT_ERROR_CODES.ORIGIN_MISMATCH, `a fill with a site-only origin answered ${wrong.status} ${wrong.body?.code ?? ''}, expected 403 ORIGIN_MISMATCH`);
    const right = await call(ctx, accessToken, 'POST', `/credentials/${ids.primary}/fill`, { field: 'password', origin: origins.exact, purpose: 'login' });
    const value = agentFillResponseSchema.safeParse(right.body);
    check(problems, right.status === 200 && value.success && value.data.data.value === logins.primary.password, `a fill with the exact origin answered ${right.status} or the wrong value`);
    check(problems, value.success && Object.keys(value.data.data).length === 1, 'a fill response carries more than one field');
  },
  'server.identical-404': async (ctx, problems) => {
    const { origins, ids } = ctx.fixture;
    const { accessToken } = await ctx.target.connect();
    const body = { field: 'password', origin: origins.exact, purpose: 'login' };
    const closed = await call(ctx, accessToken, 'POST', `/credentials/${ids.closed}/fill`, body);
    const missing = await call(ctx, accessToken, 'POST', `/credentials/${randomUUID()}/fill`, body);
    const shape = (r: { status: number; body: any }) => JSON.stringify({ s: r.status, c: r.body?.code, m: r.body?.message });
    check(problems, closed.status === 404, `a fill of a closed login answered ${closed.status}, expected 404`);
    check(problems, shape(closed) === shape(missing), 'a closed login and an unknown id do not answer the same 404');
  },
  'server.no-store': async (ctx, problems) => {
    const { accessToken } = await ctx.target.connect();
    await call(ctx, accessToken, 'GET', `/credentials?origin=${encodeURIComponent(ctx.fixture.origins.exact)}`);
    await call(ctx, accessToken, 'POST', `/credentials/${randomUUID()}/fill`, { field: 'password', origin: ctx.fixture.origins.exact, purpose: 'login' });
    const responses = responsesOf(ctx.log.events);
    check(problems, responses.length >= 2, 'no agent API response was recorded');
    const missing = responses.filter((r) => !/no-store/i.test(r.headers['cache-control'] ?? ''));
    check(problems, missing.length === 0, `${missing.length} agent API response(s) lack Cache-Control: no-store (${[...new Set(missing.map((m) => `${m.method} ${m.status}`))].join(', ')})`);
  },
  'server.kill-switch': async (ctx, problems) => {
    const { accessToken } = await ctx.target.connect();
    await ctx.target.setAgentAccess(false);
    try {
      for (const path of ['/whoami', `/credentials?origin=${encodeURIComponent(ctx.fixture.origins.exact)}`]) {
        const res = await call(ctx, accessToken, 'GET', path);
        check(problems, res.status === 403 && res.body?.code === AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED, `GET ${path.split('?')[0]} answered ${res.status} ${res.body?.code ?? ''} with the switch off`);
      }
    } finally {
      await ctx.target.setAgentAccess(true);
    }
  },
  'server.retry-after': async (ctx, problems) => {
    const { accessToken } = await ctx.target.connect();
    await ctx.target.throttleNext('lookup', 2);
    const res = await call(ctx, accessToken, 'GET', `/credentials?origin=${encodeURIComponent(ctx.fixture.origins.exact)}`);
    check(problems, res.status === 429 && res.body?.code === AGENT_ERROR_CODES.RATE_LIMITED, `a throttled call answered ${res.status} ${res.body?.code ?? ''}, expected 429 RATE_LIMITED`);
    const retryAfter = res.headers.get('retry-after') ?? '';
    check(problems, /^\d+$/.test(retryAfter) && Number(retryAfter) >= 1, `Retry-After is '${retryAfter}', expected whole seconds`);
  },
  'server.revoked-grant': async (ctx, problems) => {
    const { accessToken } = await ctx.target.connect();
    const before = await call(ctx, accessToken, 'GET', '/whoami');
    check(problems, before.status === 200, `whoami answered ${before.status} before the revocation`);
    await ctx.target.revokeGrants();
    const after = await call(ctx, accessToken, 'GET', '/whoami');
    check(problems, after.status === 401, `whoami answered ${after.status} after the revocation, expected 401`);
  },

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------
  'runtime.exact-match-fills': async (ctx, problems) => {
    const { origins, logins, ids } = ctx.fixture;
    const page = new SimulatedPage(origins.exact, false, ctx.log);
    const { result, error, events } = await visit(ctx, 'runtime.exact-match-fills', page);
    check(problems, !error, `signIn threw (${describeError(error)})`);
    check(problems, result?.status === 'signed_in', `signIn ended '${result?.status ?? 'with an error'}', expected 'signed_in'`);
    const typed = Object.fromEntries(page.typed.map((t) => [t.field, t.value]));
    check(problems, typed.username === logins.primary.username, 'the username typed is not the login\'s');
    check(problems, typed.password === logins.primary.password, 'the password typed is not the login\'s');
    const fills = requestsOf(events).filter((r) => isFill(r.path));
    check(problems, fills.length > 0, 'no fill call was made');
    check(problems, fills.every((f) => f.path === api(`/credentials/${ids.primary}/fill`)), 'a fill call went to another login');
    check(problems, fills.every((f) => (f.body as { origin?: string })?.origin === f.pageOrigin), 'a fill call did not send the page\'s own origin');
    check(problems, !requestsOf(events).some((r) => isTotp(r.path)), 'a code was fetched although the page did not ask for one');
    const unzeroed = page.typed.filter((t) => t.buffer && t.buffer.some((b) => b !== 0));
    check(problems, unzeroed.length === 0, `${unzeroed.length} typed byte buffer(s) were not zeroed after typing`);
  },
  'runtime.site-match-not-filled': async (ctx, problems) => {
    const page = new SimulatedPage(ctx.fixture.origins.siteOnly, false, ctx.log);
    const { result, error, events } = await visit(ctx, 'runtime.site-match-not-filled', page);
    check(problems, !error, `signIn threw (${describeError(error)})`);
    check(problems, result?.status === 'no_login' || result?.status === 'stopped', `signIn ended '${result?.status ?? 'with an error'}', expected 'no_login'`);
    check(problems, !requestsOf(events).some((r) => isFill(r.path) || isTotp(r.path)), 'the runtime asked for a value on a site-only match');
    noTyping(problems, page, 'site-only match');
  },
  'runtime.origin-mismatch-stops': async (ctx, problems) => {
    const { origins } = ctx.fixture;
    const page = new SimulatedPage(origins.exact, false, ctx.log);
    const { result, error, events } = await visit(ctx, 'runtime.origin-mismatch-stops', page, (event, p) => {
      if (event.method === 'GET' && isLookup(event.path) && event.status === 200) p.navigate(origins.lookAlike);
    });
    check(problems, !error, `signIn threw (${describeError(error)})`);
    noTyping(problems, page, 'look-alike page');
    const reqs = requestsOf(events);
    check(problems, reqs.every((r) => !isFill(r.path) || (r.body as { origin?: string })?.origin === r.pageOrigin), 'a fill call did not send the page\'s current origin');
    const mismatches = responsesOf(events).filter((r) => r.status === 403 && r.code === AGENT_ERROR_CODES.ORIGIN_MISMATCH);
    if (mismatches.length > 0) {
      const after = reqs.filter((r) => r.seq > mismatches[0]!.seq);
      check(problems, after.length === 0, `the runtime made ${after.length} more call(s) after ORIGIN_MISMATCH`);
      check(
        problems,
        result?.status === 'stopped' && result.code === AGENT_ERROR_CODES.ORIGIN_MISMATCH,
        `signIn ended '${result?.status ?? 'with an error'}' after ORIGIN_MISMATCH, expected 'stopped' with code ORIGIN_MISMATCH`,
      );
    } else {
      check(problems, result?.status === 'no_login' || result?.status === 'stopped', `signIn ended '${result?.status ?? 'with an error'}' on a look-alike page`);
    }
  },
  'runtime.several-matches-ask': async (ctx, problems) => {
    const { origins, logins, ids } = ctx.fixture;
    const page = new SimulatedPage(origins.shared, false, ctx.log, (choices) => {
      const pick = choices.find((c) => c.id === ids.sharedSecond || c.label.includes(logins.sharedSecond.name) || c.label.includes(logins.sharedSecond.username));
      return pick?.id ?? null;
    });
    const { result, error, events } = await visit(ctx, 'runtime.several-matches-ask', page);
    check(problems, !error, `signIn threw (${describeError(error)})`);
    const ask = events.find((e) => e.kind === 'ask') as Extract<ConformanceEvent, { kind: 'ask' }> | undefined;
    check(problems, Boolean(ask), 'the runtime did not ask the person');
    check(problems, !ask || ask.choices >= 2, 'the person was offered fewer than two logins');
    check(problems, !ask || ask.answer !== null, 'the choices did not identify the logins (by id, name or username)');
    const firstFill = requestsOf(events).find((r) => isFill(r.path));
    check(problems, !firstFill || (ask !== undefined && firstFill.seq > ask.seq), 'a value was asked for before the person chose');
    check(problems, result?.status === 'signed_in', `signIn ended '${result?.status ?? 'with an error'}', expected 'signed_in'`);
    const typed = Object.fromEntries(page.typed.map((t) => [t.field, t.value]));
    check(problems, typed.username === logins.sharedSecond.username && typed.password === logins.sharedSecond.password, 'the values typed are not the chosen login\'s');
  },
  'runtime.code-right-before-typing': async (ctx, problems) => {
    const page = new SimulatedPage(ctx.fixture.origins.exact, true, ctx.log);
    const { result, error, events } = await visit(ctx, 'runtime.code-right-before-typing', page);
    check(problems, !error, `signIn threw (${describeError(error)})`);
    check(problems, result?.status === 'signed_in', `signIn ended '${result?.status ?? 'with an error'}', expected 'signed_in'`);
    const passwordTyped = events.find((e) => e.kind === 'type' && e.field === 'password');
    const totpResponses = responsesOf(events).filter((r) => isTotp(r.path) && r.status === 200);
    const codeTyped = events.find((e) => e.kind === 'type' && e.field === 'code') as Extract<ConformanceEvent, { kind: 'type' }> | undefined;
    check(problems, totpResponses.length > 0, 'no code was fetched');
    check(problems, Boolean(codeTyped), 'no code was typed');
    const last = totpResponses[totpResponses.length - 1];
    if (last && codeTyped && passwordTyped) {
      const code = agentTotpResponseSchema.safeParse(last.body);
      check(problems, code.success && code.data.data.code === codeTyped.value, 'the code typed is not the one Vault returned last');
      const totpRequest = events.find((e) => e.seq === last.requestSeq)!;
      check(problems, totpRequest.seq > passwordTyped.seq, 'the code was fetched before the password was typed');
      const between = requestsOf(events).filter((r) => r.seq > last.seq && r.seq < codeTyped.seq);
      check(problems, between.length === 0, `${between.length} other Vault call(s) between fetching and typing the code`);
      check(problems, codeTyped.at - last.at <= 5_000, 'the code was typed more than 5 seconds after it was fetched');
    }
  },
  'runtime.revoked-grant-reconnects': async (ctx, problems) => {
    const warm = await visit(ctx, 'runtime.revoked-grant-reconnects', new SimulatedPage(ctx.fixture.origins.exact, false, ctx.log));
    check(problems, warm.result?.status === 'signed_in', 'the warm-up sign-in before the revocation failed');
    await ctx.target.revokeGrants();
    const before = ctx.connects.count;
    const page = new SimulatedPage(ctx.fixture.origins.exact, false, ctx.log);
    const { result, error, events } = await visit(ctx, 'runtime.revoked-grant-reconnects', page);
    check(problems, !error, `signIn threw (${describeError(error)})`);
    const unauthorized = responsesOf(events).filter((r) => r.status === 401);
    const reconnects = ctx.connects.count - before;
    check(problems, unauthorized.length >= 1, 'the runtime never met the 401 (did it skip Vault?)');
    check(problems, reconnects >= 1 && reconnects <= 2, `the runtime called connect() ${reconnects} time(s) after the revocation, expected 1 or 2`);
    check(problems, unauthorized.length <= 2, `the runtime got ${unauthorized.length} 401 answers: it retried a dead token`);
    check(problems, result?.status === 'signed_in', `signIn ended '${result?.status ?? 'with an error'}' after reconnecting, expected 'signed_in'`);
  },
  'runtime.retry-after-honoured': async (ctx, problems) => {
    await ctx.target.throttleNext('fill', 1);
    const page = new SimulatedPage(ctx.fixture.origins.exact, false, ctx.log);
    const { result, error, events } = await visit(ctx, 'runtime.retry-after-honoured', page);
    check(problems, !error, `signIn threw (${describeError(error)})`);
    const limited = responsesOf(events).find((r) => r.status === 429);
    check(problems, Boolean(limited), 'the throttled call never happened');
    if (limited) {
      const wait = Number(limited.headers['retry-after'] ?? '0') * 1000;
      const next = requestsOf(events).find((r) => r.seq > limited.seq && isFill(r.path));
      check(problems, Boolean(next), 'the runtime did not call fill again after the 429');
      check(problems, !next || next.at - limited.at >= wait - 50, `the runtime called again ${next ? next.at - limited.at : 0} ms after a 429 with Retry-After ${wait / 1000}`);
    }
    check(problems, result?.status === 'signed_in', `signIn ended '${result?.status ?? 'with an error'}', expected 'signed_in'`);
  },
  'runtime.no-cache-across-pages': async (ctx, problems) => {
    const first = await visit(ctx, 'runtime.no-cache-across-pages', new SimulatedPage(ctx.fixture.origins.exact, false, ctx.log));
    check(problems, first.result?.status === 'signed_in', 'the first visit did not sign in');
    await ctx.target.setLoginOpen('primary', false);
    try {
      const page = new SimulatedPage(ctx.fixture.origins.exact, false, ctx.log);
      const second = await visit(ctx, 'runtime.no-cache-across-pages', page);
      check(problems, !second.error, `signIn threw on the second visit (${describeError(second.error)})`);
      check(problems, requestsOf(second.events).some((r) => isLookup(r.path)), 'the second visit did not look the login up again');
      check(problems, !requestsOf(second.events).some((r) => isFill(r.path)), 'the second visit asked for a value of a login looked up on the first one');
      noTyping(problems, page, 'second visit after the owner closed the login');
      check(problems, second.result?.status !== 'signed_in', 'the second visit reported signed_in with a closed login');
    } finally {
      await ctx.target.setLoginOpen('primary', true);
    }
  },
  'runtime.kill-switch-reported': async (ctx, problems) => {
    await ctx.target.setAgentAccess(false);
    try {
      const page = new SimulatedPage(ctx.fixture.origins.exact, false, ctx.log);
      const { result, error, events } = await visit(ctx, 'runtime.kill-switch-reported', page);
      check(problems, !error, `signIn threw (${describeError(error)}); report the switch as a result instead`);
      check(
        problems,
        result?.status === 'stopped' && result.code === AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED,
        `signIn ended '${result?.status ?? 'with an error'}${result && 'code' in result && result.code ? ` ${result.code}` : ''}', expected 'stopped' with code AGENT_ACCESS_DISABLED`,
      );
      noTyping(problems, page, 'kill switch off');
      const first = responsesOf(events).find((r) => r.code === AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED);
      const after = first ? requestsOf(events).filter((r) => r.seq > first.seq) : [];
      check(problems, after.length === 0, `the runtime made ${after.length} more call(s) after AGENT_ACCESS_DISABLED`);
    } finally {
      await ctx.target.setAgentAccess(true);
    }
  },
  'runtime.no-value-in-artifacts': async (ctx, problems) => {
    if (!ctx.artifacts) return 'skipped';
    const sources = await ctx.artifacts();
    const needles = [...new Set([...ctx.fixture.canaries, ...ctx.seenValues])].filter((v) => v.length >= 12);
    const hits = findCanaries(needles, ...sources);
    check(problems, hits.length === 0, `${hits.length} secret value(s) found in the runtime's artifacts: ${hits.slice(0, 5).map((h) => `${h.where} (${h.encoding})`).join(', ')}`);
  },
};

/**
 * Runs the scenario list against a Vault (the fake or a real one) with the runtime's `signIn`, and
 * returns one result per scenario. Never throws for a failed scenario (see
 * {@link assertAgentConformance}); refuses to run with `NODE_ENV=production`. Uses no test
 * framework: call it from any.
 *
 * @stability beta
 */
export async function runAgentConformance(options: AgentConformanceOptions): Promise<AgentConformanceReport> {
  assertNotProduction('The agent conformance runner');
  const log = new ConformanceLog();
  const recorder = await startRecorder(options.target.baseUrl, log);
  const connects = { count: 0 };
  const ctx: RunContext = {
    target: options.target,
    fixture: options.target.fixture,
    log,
    recorder,
    signIn: options.signIn,
    connects,
    artifacts: options.artifacts,
    seenValues: new Set(),
    access: (scenario) => ({
      baseUrl: recorder.baseUrl,
      apiBaseUrl: `${recorder.baseUrl}${AGENT_API_BASE_PATH}`,
      scenario,
      connect: async () => {
        connects.count += 1;
        log.push({ kind: 'connect' });
        return options.target.connect();
      },
    }),
  };
  const selected = AGENT_CONFORMANCE_SCENARIOS.filter((s) => !options.only || options.only.includes(s.id));
  const results: AgentConformanceResult[] = [];
  try {
    for (const scenario of selected) {
      const started = Date.now();
      const problems: string[] = [];
      let status: AgentConformanceResult['status'] = 'passed';
      if (scenario.kind === 'runtime' && !options.signIn) {
        status = 'skipped';
        problems.push('no signIn function was given');
      } else {
        log.clear();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            scenarioImpl[scenario.id]!(ctx, problems),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`timed out after ${options.timeoutMs ?? 20_000} ms`)), options.timeoutMs ?? 20_000);
            }),
          ]);
          if (outcome === 'skipped') {
            status = 'skipped';
            problems.push('no artifacts were given');
          } else if (problems.length > 0) status = 'failed';
        } catch (error) {
          status = 'failed';
          problems.push(`the scenario could not run: ${error instanceof Error ? error.message : 'unknown error'}`);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      results.push({ id: scenario.id, kind: scenario.kind, title: scenario.title, status, problems, durationMs: Date.now() - started });
    }
  } finally {
    log.clear();
    ctx.seenValues.clear();
    await recorder.stop();
  }
  return { passed: results.every((r) => r.status !== 'failed'), results };
}

/**
 * {@link runAgentConformance}, then throws {@link AgentConformanceError} when a scenario failed.
 * Returns the report otherwise (skipped scenarios are listed in it).
 *
 * @stability beta
 */
export async function assertAgentConformance(options: AgentConformanceOptions): Promise<AgentConformanceReport> {
  const report = await runAgentConformance(options);
  if (!report.passed) throw new AgentConformanceError(report);
  return report;
}

