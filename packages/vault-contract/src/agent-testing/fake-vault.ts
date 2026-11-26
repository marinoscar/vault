import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ZodType } from 'zod';

import {
  AGENT_API_BASE_PATH,
  AGENT_ERROR_CODES,
  AGENT_SCOPES,
  agentCardFillRequestSchema,
  agentCardGrantRequestCreateSchema,
  agentCardsLookupQuerySchema,
  agentContractInfoFor,
  agentCreateCredentialRequestSchema,
  agentFillRequestSchema,
  agentIdentityFillRequestSchema,
  agentIdentityLookupQuerySchema,
  agentLookupQuerySchema,
  agentRotatePasswordRequestSchema,
  agentServiceKeyParamsSchema,
  agentTotpRequestSchema,
  AGENT_IDENTITY_FIELDS,
  AGENT_SERVICE_KEY_PER_MINUTE,
  AGENT_CARD_FIELD_MAP,
  type AgentCardFillRequest,
  type AgentCreateCredentialRequest,
  type AgentFillRequest,
  type AgentIdentityFillRequest,
  type AgentRotatePasswordRequest,
  type AgentTotpRequest,
} from '../agent/index.js';
import { SYSTEM_SECRET_TYPES } from '../secret-types/index.js';
import { matchOrigin, normalizeOrigin, registrableDomainOfOrigin } from '../secrets/origins.js';
import { assertNotProduction } from './guard.js';
import {
  createConformanceSeed,
  type ConformanceFixture,
  type ConformanceLoginKey,
  type ConformanceSeed,
} from './seed.js';
import { conformanceTotp } from './totp.js';

/** The rate-limit buckets of the agent API (the fake has the same ones as Vault). @stability beta */
export type AgentConformanceBucket = 'lookup' | 'fill' | 'totp' | 'write' | 'card_fill' | 'identity_fill' | 'service_key';

/** Tokens a connected client holds. @stability beta */
export interface AgentTokens {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
}

/**
 * What a conformance run needs from a Vault: where it is, what it seeded, and the owner's and
 * administrator's levers. {@link createFakeVault} implements it; Vault's own tests implement it over
 * a real deployment so the fake and the real API run the same scenarios.
 *
 * @stability beta
 */
export interface AgentConformanceTarget {
  /** Where the Vault answers (`http://127.0.0.1:<port>`); the agent API is at `baseUrl + AGENT_API_BASE_PATH`. */
  readonly baseUrl: string;
  /** The seeded data and its ids. */
  readonly fixture: ConformanceFixture;
  /** A new OAuth grant for the login scopes (`vault:items_read`, `vault:items_fill`, `offline_access`): the person consents. */
  connect(): Promise<AgentTokens>;
  /** The owner revokes every grant `connect` issued: the next call with their tokens is `401`. */
  revokeGrants(): Promise<void>;
  /** The administrator's kill switch `agentAccess.enabled`. */
  setAgentAccess(enabled: boolean): Promise<void>;
  /** The owner opens or closes a seeded login. */
  setLoginOpen(key: ConformanceLoginKey, open: boolean): Promise<void>;
  /** The NEXT call counted in `bucket` answers `429 RATE_LIMITED` with `Retry-After: <retryAfterSeconds>`. */
  throttleNext(bucket: AgentConformanceBucket, retryAfterSeconds: number): Promise<void>;
}

/** Options of {@link createFakeVault}. @stability beta */
export interface FakeVaultOptions {
  /** The data to serve; a fresh {@link createConformanceSeed} by default. Use invented values only. */
  seed?: ConformanceSeed;
  /** Interface to listen on (default `127.0.0.1`) and port (default `0`, any free one). */
  host?: string;
  port?: number;
  /** Switches at start. Unlike a real Vault (all off by default), the fake starts with all three on. */
  agentAccess?: boolean;
  cardAccess?: boolean;
  identityAccess?: boolean;
  /** Per-minute limits per bucket and grant (Vault's defaults otherwise). */
  limits?: Partial<Record<AgentConformanceBucket, number>>;
  /** Releases (`number` fills) per card per UTC day (default 5). */
  releasesPerCardPerDay?: number;
  /** Lifetime of an access token in seconds (default 3600). */
  accessTokenTtlSeconds?: number;
  /** The clock (milliseconds); tests replace it. */
  now?: () => number;
  /** The environment the production guard reads (default: the process environment). */
  env?: Record<string, string | undefined>;
}

/** One call the fake answered: never a body, a header value or a token. @stability beta */
export interface FakeVaultRequest {
  method: string;
  path: string;
  status: number;
  code?: string;
  at: number;
}

/** A grant request an agent made (pending until the test decides it). @stability beta */
export interface FakeVaultGrantRequest {
  id: string;
  cardId: string;
  origin: string;
  merchantSite: string;
  amount: number;
  currency: string;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
}

/**
 * The in-memory fake Vault (see {@link createFakeVault}).
 *
 * @stability beta
 */
export interface FakeVault extends AgentConformanceTarget {
  /** Starts listening; returns `baseUrl`. Refuses with `NODE_ENV=production`. */
  start(): Promise<string>;
  /** Stops listening and forgets nothing (a test may read `requests` afterwards). */
  stop(): Promise<void>;
  /** A new grant with exactly these scopes (default: every agent scope plus `offline_access`). */
  connect(scopes?: readonly string[]): Promise<AgentTokens>;
  setCardAccess(enabled: boolean): Promise<void>;
  setIdentityAccess(enabled: boolean): Promise<void>;
  /** Changes a bucket's per-minute limit (and starts its windows over). */
  setLimit(bucket: AgentConformanceBucket, perMinute: number): void;
  /** Every call answered so far: method, path (no query), status and code. */
  readonly requests: readonly FakeVaultRequest[];
  /** Grant requests the agent made. */
  readonly grantRequests: readonly FakeVaultGrantRequest[];
  /** Decides a pending grant request as the owner would (approval creates the grant it asked for). */
  decideGrantRequest(id: string, decision: 'approved' | 'declined'): void;
}

const DEFAULT_LIMITS: Record<AgentConformanceBucket, number> = {
  lookup: 60,
  fill: 30,
  totp: 10,
  write: 10,
  card_fill: 10,
  identity_fill: 20,
  service_key: AGENT_SERVICE_KEY_PER_MINUTE,
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID_ROUTE = new RegExp(`^/(credentials|cards|identity)/([^/]+)/(fill|totp|password|grant-requests)$`);
const SERVICE_KEY_ROUTE = /^\/service-keys\/([^/]+)\/([^/]+)$/;
const IS_UUID = new RegExp(`^${UUID}$`, 'i');

const IDENTITY_TYPE = SYSTEM_SECRET_TYPES.find((t) => t.name === 'Identity');
const IDENTITY_FIELD_DEFS = AGENT_IDENTITY_FIELDS.map((name) => {
  const def = IDENTITY_TYPE?.fields.find((f) => f.name === name) as { label?: string; sensitive?: boolean } | undefined;
  return { name, label: def?.label ?? name, sensitive: def?.sensitive === true || name === 'date_of_birth' || name === 'id_number' };
});

/** An error the router turns into Vault's error envelope. */
class FakeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};
const fail = (status: number, message: string, code?: string, headers?: Record<string, string>) =>
  new FakeHttpError(status, code ?? DEFAULT_CODES[status] ?? 'ERROR', message, headers);

interface LoginRow {
  id: string;
  key?: ConformanceLoginKey;
  name: string;
  values: Record<string, string>;
  origins: string[];
  open: boolean;
  version: number;
  updatedAt: string;
}

interface Grant {
  id: string;
  clientId: string;
  scopes: string[];
  revoked: boolean;
}

/** Deterministic, recognisable ids for the seeded items. */
const SEED_IDS = {
  primary: '00000000-0000-4000-8000-00000000c001',
  sharedFirst: '00000000-0000-4000-8000-00000000c002',
  sharedSecond: '00000000-0000-4000-8000-00000000c003',
  closed: '00000000-0000-4000-8000-00000000c004',
  card: '00000000-0000-4000-8000-00000000ca01',
  identity: '00000000-0000-4000-8000-000000001d01',
  serviceKey: '00000000-0000-4000-8000-000000005e01',
} as const;

/**
 * A small in-memory Vault for a runtime's own tests: `/api/agent/v1` (logins, codes, create,
 * rotate, cards, identity, `whoami`) plus the refresh-token grant of `/api/oauth/token` and
 * `/api/oauth/revoke`, built from the contract's schemas. It follows Vault's rules: exact origin
 * binding (a site match is never fillable), one identical `404` for missing, foreign and closed
 * items, scopes (`403` with `WWW-Authenticate: Bearer error="insufficient_scope"`), the kill
 * switches, per-minute limits with `Retry-After`, refresh-token rotation and revocation of the whole
 * grant on a replayed refresh token, `Cache-Control: no-store` on every answer.
 *
 * It is NOT a secrets store: it holds only the invented seed, keeps everything in memory, has no
 * encryption and no audit trail, and refuses to start when `NODE_ENV` is `production`.
 *
 * @stability beta
 */
export function createFakeVault(options: FakeVaultOptions = {}): FakeVault {
  const env = options.env;
  assertNotProduction('The fake Vault', env);
  const now = options.now ?? (() => Date.now());
  const seed = options.seed ?? createConformanceSeed();
  const limits: Record<AgentConformanceBucket, number> = { ...DEFAULT_LIMITS, ...options.limits };
  const releasesPerCardPerDay = options.releasesPerCardPerDay ?? 5;
  const ttlMs = (options.accessTokenTtlSeconds ?? 3600) * 1000;
  const userId = '00000000-0000-4000-8000-0000000000a1';
  const clientId = '00000000-0000-4000-8000-0000000000b1';

  const switches = {
    enabled: options.agentAccess ?? true,
    cards: { enabled: options.cardAccess ?? true },
    identity: { enabled: options.identityAccess ?? true },
  };

  // ---- data -------------------------------------------------------------------------------
  const logins = new Map<string, LoginRow>();
  const stamp = new Date(now()).toISOString();
  for (const login of Object.values(seed.logins)) {
    logins.set(SEED_IDS[login.key], {
      id: SEED_IDS[login.key],
      key: login.key,
      name: login.name,
      values: { username: login.username, password: login.password, ...(login.totpSeed ? { totp: login.totpSeed } : {}) },
      origins: login.origins.map((o) => normalizeOrigin(o)!).sort(),
      open: login.open,
      version: 1,
      updatedAt: stamp,
    });
  }
  const card = {
    id: SEED_IDS.card,
    name: seed.card.name,
    open: true,
    values: {
      card_network: 'Visa',
      number: seed.card.number,
      exp_month: seed.card.expMonth,
      exp_year: seed.card.expYear,
      cardholder_name: seed.card.holderName,
      cvv: seed.card.securityCode,
      billing_postal_code: seed.card.postalCode,
    } as Record<string, string>,
  };
  const cardGrants: Array<{
    id: string;
    merchantSite: string;
    frameOrigins: string[];
    maxAmount: number;
    currency: string;
    includeSecurityCode: boolean;
    expiresAt: number | null;
  }> = [
    {
      id: randomUUID(),
      merchantSite: registrableDomainOfOrigin(seed.card.grant.merchantOrigin)!,
      frameOrigins: seed.card.grant.frameOrigins.map((o) => normalizeOrigin(o)!),
      maxAmount: seed.card.grant.maxAmount,
      currency: seed.card.grant.currency,
      includeSecurityCode: seed.card.grant.includeSecurityCode,
      expiresAt: null,
    },
  ];
  const releases: number[] = [];
  const grantRequests: FakeVaultGrantRequest[] = [];
  const identity = {
    id: SEED_IDS.identity,
    name: seed.identity.name,
    open: true,
    values: { ...seed.identity.values },
    allowedOrigins: seed.identity.allowedOrigins.map((o) => normalizeOrigin(o)!),
  };
  const serviceKey = seed.serviceKey
    ? { id: SEED_IDS.serviceKey, service: seed.serviceKey.service, keyName: seed.serviceKey.keyName, value: seed.serviceKey.value, open: true }
    : null;
  const fixture: ConformanceFixture = { ...seed, ids: { ...SEED_IDS } };

  // ---- tokens -----------------------------------------------------------------------------
  const grants = new Map<string, Grant>();
  const accessTokens = new Map<string, { grantId: string; expiresAt: number }>();
  const refreshTokens = new Map<string, { grantId: string; used: boolean }>();
  const token = (prefix: string) => `${prefix}${randomBytes(24).toString('base64url')}`;

  const issue = (grantId: string): AgentTokens & { expiresIn: number } => {
    const grant = grants.get(grantId)!;
    const accessToken = token('oat_');
    accessTokens.set(accessToken, { grantId, expiresAt: now() + ttlMs });
    const refreshToken = grant.scopes.includes('offline_access') ? token('ort_') : undefined;
    if (refreshToken) refreshTokens.set(refreshToken, { grantId, used: false });
    return { accessToken, refreshToken, scopes: [...grant.scopes], expiresIn: Math.floor(ttlMs / 1000) };
  };
  const revokeGrant = (grantId: string) => {
    const grant = grants.get(grantId);
    if (grant) grant.revoked = true;
  };

  // ---- rate limits ------------------------------------------------------------------------
  const windows = new Map<string, { count: number; resetAt: number }>();
  const forced = new Map<AgentConformanceBucket, number>();
  const consume = (bucket: AgentConformanceBucket, grantId: string) => {
    const pending = forced.get(bucket);
    if (pending !== undefined) {
      forced.delete(bucket);
      return pending;
    }
    const key = `${bucket}:${grantId}`;
    const t = now();
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + 60_000 };
      windows.set(key, entry);
    }
    if (entry.count >= limits[bucket]) return Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    entry.count += 1;
    return 0;
  };

  // ---- helpers ----------------------------------------------------------------------------
  const requests: FakeVaultRequest[] = [];
  const parse = <T>(schema: ZodType<T>, input: unknown): T => {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new FakeHttpError(400, 'VALIDATION_ERROR', 'Validation failed', {}, {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  };
  const requireOrigin = (input: string) => {
    const origin = normalizeOrigin(input);
    if (!origin) throw fail(400, 'origin is not a valid https origin');
    return origin;
  };
  const forbidden = (code: string, message: string) => fail(403, message, code);
  const secretNotFound = () => fail(404, 'Secret not found');

  /** Kill switch, the route's own switch, then the bucket: Vault's pipeline order. */
  const pipeline = (grantId: string, bucket: AgentConformanceBucket, gate?: 'cards' | 'identity') => {
    if (!switches.enabled) throw forbidden(AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED, 'Agent access is switched off');
    if (gate === 'cards' && !switches.cards.enabled) {
      throw forbidden(AGENT_ERROR_CODES.CARD_ACCESS_DISABLED, 'Card release to agents is switched off');
    }
    if (gate === 'identity' && !switches.identity.enabled) {
      throw forbidden(AGENT_ERROR_CODES.IDENTITY_ACCESS_DISABLED, 'Identity release to agents is switched off');
    }
    const retryAfter = consume(bucket, grantId);
    if (retryAfter > 0) {
      throw fail(429, 'Too many agent requests; retry later', AGENT_ERROR_CODES.RATE_LIMITED, { 'Retry-After': String(retryAfter) });
    }
  };

  const openLogin = (id: string) => {
    const row = logins.get(id);
    if (!row || !row.open) throw secretNotFound();
    return row;
  };
  const exactLogin = (id: string, rawOrigin: string) => {
    const row = openLogin(id);
    const origin = requireOrigin(rawOrigin);
    if (matchOrigin(origin, row.origins)?.matchKind !== 'exact') {
      throw forbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'The origin does not match this credential');
    }
    return row;
  };
  const generate = (length: number, symbols: boolean) => {
    const classes = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', ...(symbols ? ['!@#$%^&*()-_=+'] : [])];
    const all = classes.join('');
    const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)]!;
    const chars = classes.map(pick);
    while (chars.length < length) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
  };
  const summary = (row: LoginRow, matchKind: 'exact' | 'site') => ({
    id: row.id,
    name: row.name,
    username: row.values.username ?? null,
    origins: [...row.origins],
    matchKind,
    hasTotp: Boolean(row.values.totp && conformanceTotp(row.values.totp)),
    updatedAt: row.updatedAt,
  });

  // ---- routes -----------------------------------------------------------------------------
  type Handler = (ctx: {
    grant: Grant;
    query: URLSearchParams;
    body: unknown;
    id?: string;
    params?: Record<string, string>;
  }) => { status?: number; data: unknown };
  interface Route {
    scope: string;
    handler: Handler;
  }
  const routes: Record<string, Route> = {
    'GET /whoami': {
      scope: AGENT_SCOPES.ITEMS_READ,
      handler: ({ grant }) => {
        if (!switches.enabled) throw forbidden(AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED, 'Agent access is switched off');
        return { data: { userId, scopes: [...grant.scopes], clientId: grant.clientId, contract: agentContractInfoFor(switches) } };
      },
    },
    'GET /credentials': {
      scope: AGENT_SCOPES.ITEMS_READ,
      handler: ({ grant, query }) => {
        const q = parse(agentLookupQuerySchema, Object.fromEntries(query));
        pipeline(grant.id, 'lookup');
        const origin = requireOrigin(q.origin);
        const found = [...logins.values()]
          .filter((row) => row.open)
          .flatMap((row) => {
            const match = matchOrigin(origin, row.origins);
            return match ? [summary(row, match.matchKind)] : [];
          })
          .sort((a, b) => (a.matchKind === b.matchKind ? a.name.localeCompare(b.name) : a.matchKind === 'exact' ? -1 : 1));
        return { data: found.slice(0, 25) };
      },
    },
    'POST /credentials/:id/fill': {
      scope: AGENT_SCOPES.ITEMS_FILL,
      handler: ({ grant, body, id }) => {
        const b: AgentFillRequest = parse(agentFillRequestSchema, body);
        pipeline(grant.id, 'fill');
        const row = exactLogin(id!, b.origin);
        const value = row.values[b.field];
        if (typeof value !== 'string') throw secretNotFound();
        return { data: { value } };
      },
    },
    'POST /credentials/:id/totp': {
      scope: AGENT_SCOPES.ITEMS_FILL,
      handler: ({ grant, body, id }) => {
        const b: AgentTotpRequest = parse(agentTotpRequestSchema, body);
        pipeline(grant.id, 'totp');
        const row = exactLogin(id!, b.origin);
        const code = row.values.totp ? conformanceTotp(row.values.totp, now()) : null;
        if (!code) throw secretNotFound();
        return { data: code };
      },
    },
    'POST /credentials': {
      scope: AGENT_SCOPES.ITEMS_WRITE,
      handler: ({ grant, body }) => {
        const b: AgentCreateCredentialRequest = parse(agentCreateCredentialRequestSchema, body);
        pipeline(grant.id, 'write');
        const origin = requireOrigin(b.origin);
        const extra = (b.additionalUrls ?? []).map((u) => {
          const o = normalizeOrigin(u);
          if (!o) throw fail(400, 'additionalUrls holds an invalid https origin');
          return o;
        });
        if ([...logins.values()].some((row) => row.name === b.name)) throw fail(409, 'A secret with that name already exists');
        const generated = b.generate ? generate(b.generate.length, b.generate.symbols) : undefined;
        const row: LoginRow = {
          id: randomUUID(),
          name: b.name,
          values: { username: b.username, password: generated ?? b.password! },
          origins: [...new Set([origin, ...extra])].sort(),
          open: true,
          version: 1,
          updatedAt: new Date(now()).toISOString(),
        };
        logins.set(row.id, row);
        return {
          status: 201,
          data: { id: row.id, name: row.name, username: b.username, origins: row.origins, ...(generated ? { generatedPassword: generated } : {}) },
        };
      },
    },
    'POST /credentials/:id/password': {
      scope: AGENT_SCOPES.ITEMS_WRITE,
      handler: ({ grant, body, id }) => {
        const b: AgentRotatePasswordRequest = parse(agentRotatePasswordRequestSchema, body);
        pipeline(grant.id, 'write');
        const row = exactLogin(id!, b.origin);
        const generated = b.generate ? generate(b.generate.length, b.generate.symbols) : undefined;
        row.values = { ...row.values, password: generated ?? b.password! };
        row.version += 1;
        row.updatedAt = new Date(now()).toISOString();
        return { data: { id: row.id, version: row.version, ...(generated ? { generatedPassword: generated } : {}) } };
      },
    },
    'GET /cards': {
      scope: AGENT_SCOPES.CARDS_READ,
      handler: ({ grant, query }) => {
        const q = parse(agentCardsLookupQuerySchema, Object.fromEntries(query));
        pipeline(grant.id, 'lookup', 'cards');
        const site = registrableDomainOfOrigin(requireOrigin(q.origin));
        const live = cardGrants.find((g) => g.merchantSite === site && (g.expiresAt === null || g.expiresAt > now()));
        if (!card.open || !live) return { data: [] };
        return {
          data: [
            {
              id: card.id,
              name: card.name,
              brand: card.values.card_network ?? null,
              last4: card.values.number!.slice(-4),
              expMonth: card.values.exp_month ?? null,
              expYear: card.values.exp_year ?? null,
              grant: {
                maxAmount: live.maxAmount,
                currency: live.currency,
                includesSecurityCode: live.includeSecurityCode,
                expiresAt: live.expiresAt === null ? null : new Date(live.expiresAt).toISOString(),
              },
            },
          ],
        };
      },
    },
    'POST /cards/:id/fill': {
      scope: AGENT_SCOPES.CARDS_FILL,
      handler: ({ grant, body, id }) => {
        const b: AgentCardFillRequest = parse(agentCardFillRequestSchema, body);
        pipeline(grant.id, 'card_fill', 'cards');
        if (id !== card.id || !card.open || cardGrants.length === 0) throw fail(404, 'Card not found');
        const origin = requireOrigin(b.origin);
        const site = registrableDomainOfOrigin(origin);
        const forSite = cardGrants.find((g) => g.merchantSite === site);
        if (forSite && forSite.expiresAt !== null && forSite.expiresAt <= now()) {
          throw forbidden(AGENT_ERROR_CODES.CARD_GRANT_EXPIRED, "The card's grant for this merchant has expired");
        }
        if (!forSite) throw forbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'This card has no grant for this merchant');
        if (b.frameOrigin !== undefined) {
          const frame = requireOrigin(b.frameOrigin);
          if (!forSite.frameOrigins.includes(frame)) {
            throw forbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'The payment frame is not on this grant');
          }
        }
        if (b.currency !== forSite.currency) throw forbidden(AGENT_ERROR_CODES.CARD_CURRENCY_MISMATCH, "The currency is not the grant's");
        if (b.amount > forSite.maxAmount) throw forbidden(AGENT_ERROR_CODES.CARD_AMOUNT_EXCEEDED, "The amount is above the grant's maximum");
        if (b.field === 'securityCode' && !forSite.includeSecurityCode) {
          throw forbidden(AGENT_ERROR_CODES.SECURITY_CODE_NOT_GRANTED, 'The security code is not part of this grant');
        }
        if (b.field === 'number') {
          const dayStart = Math.floor(now() / 86_400_000) * 86_400_000;
          if (releases.filter((t) => t >= dayStart).length >= releasesPerCardPerDay) {
            throw forbidden(AGENT_ERROR_CODES.CARD_DAILY_CAP_REACHED, "The card's daily cap of releases was reached");
          }
          releases.push(now());
        }
        const value = card.values[AGENT_CARD_FIELD_MAP[b.field]];
        if (typeof value !== 'string' || value === '') throw fail(404, 'Card not found');
        return { data: { value } };
      },
    },
    'POST /cards/:id/grant-requests': {
      scope: AGENT_SCOPES.CARDS_FILL,
      handler: ({ grant, body, id }) => {
        const b = parse(agentCardGrantRequestCreateSchema, body);
        pipeline(grant.id, 'write', 'cards');
        if (id !== card.id || !card.open) throw fail(404, 'Card not found');
        const origin = requireOrigin(b.origin);
        const merchantSite = registrableDomainOfOrigin(origin) ?? origin;
        const pending = grantRequests.find((r) => r.cardId === id && r.merchantSite === merchantSite && r.status === 'pending');
        if (pending) return { status: 201, data: { id: pending.id, status: pending.status } };
        const request: FakeVaultGrantRequest = {
          id: randomUUID(), cardId: id, origin, merchantSite, amount: b.amount, currency: b.currency, reason: b.reason, status: 'pending',
        };
        grantRequests.push(request);
        return { status: 201, data: { id: request.id, status: request.status } };
      },
    },
    'GET /identity': {
      scope: AGENT_SCOPES.IDENTITY_READ,
      handler: ({ grant, query }) => {
        const q = parse(agentIdentityLookupQuerySchema, Object.fromEntries(query));
        pipeline(grant.id, 'lookup', 'identity');
        const origin = requireOrigin(q.origin);
        if (!identity.open) return { data: [] };
        const allowed = identity.allowedOrigins.includes(origin);
        return {
          data: [
            {
              id: identity.id,
              name: identity.name,
              originAllowed: allowed,
              fields: IDENTITY_FIELD_DEFS.map((f) => ({ field: f.name, label: f.label, sensitive: f.sensitive, fillable: !f.sensitive || allowed })),
            },
          ],
        };
      },
    },
    'GET /service-keys/:service/:name': {
      scope: AGENT_SCOPES.SERVICE_KEYS_READ,
      handler: ({ grant, params }) => {
        pipeline(grant.id, 'service_key');
        const p = parse(agentServiceKeyParamsSchema, params ?? {});
        if (!serviceKey || !serviceKey.open || serviceKey.service !== p.service || serviceKey.keyName !== p.name) {
          throw fail(404, 'Service key not found');
        }
        return { data: { value: serviceKey.value } };
      },
    },
    'POST /identity/:id/fill': {
      scope: AGENT_SCOPES.IDENTITY_FILL,
      handler: ({ grant, body, id }) => {
        const b: AgentIdentityFillRequest = parse(agentIdentityFillRequestSchema, body);
        pipeline(grant.id, 'identity_fill', 'identity');
        if (id !== identity.id || !identity.open) throw fail(404, 'Identity not found');
        const origin = requireOrigin(b.origin);
        const def = IDENTITY_FIELD_DEFS.find((f) => f.name === b.field)!;
        if (def.sensitive && !identity.allowedOrigins.includes(origin)) {
          throw forbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'This field is released only on an origin allowed for this item');
        }
        const value = identity.values[b.field];
        if (typeof value !== 'string' || value === '') throw fail(404, 'Identity not found');
        return { data: { value } };
      },
    },
  };

  // ---- HTTP -------------------------------------------------------------------------------
  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(fail(413, 'Body too large', 'PAYLOAD_TOO_LARGE'));
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...headers,
    });
    res.end(JSON.stringify(body));
  };

  const authenticate = (req: IncomingMessage): Grant => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const record = match ? accessTokens.get(match[1]!) : undefined;
    const grant = record ? grants.get(record.grantId) : undefined;
    if (!record || !grant || grant.revoked || record.expiresAt <= now()) {
      throw fail(401, 'Unauthorized', undefined, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    }
    return grant;
  };

  const handleOAuth = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const raw = await readBody(req);
    const type = String(req.headers['content-type'] ?? '');
    const params: Record<string, string> = type.includes('application/json')
      ? (() => {
          try {
            return JSON.parse(raw || '{}') as Record<string, string>;
          } catch {
            return {};
          }
        })()
      : Object.fromEntries(new URLSearchParams(raw));
    const oauthError = (status: number, error: string) => {
      send(res, status, { error }, {});
      return status;
    };
    if (path === '/api/oauth/revoke') {
      const t = params.token ?? '';
      const grantId = accessTokens.get(t)?.grantId ?? refreshTokens.get(t)?.grantId;
      if (grantId) revokeGrant(grantId);
      send(res, 200, {});
      return 200;
    }
    if (params.grant_type !== 'refresh_token') return oauthError(400, 'unsupported_grant_type');
    const record = refreshTokens.get(params.refresh_token ?? '');
    const grant = record ? grants.get(record.grantId) : undefined;
    if (!record || !grant || grant.revoked) return oauthError(400, 'invalid_grant');
    if (record.used) {
      // Replay of a rotated refresh token: the whole grant is revoked.
      revokeGrant(record.grantId);
      return oauthError(400, 'invalid_grant');
    }
    record.used = true;
    const issued = issue(grant.id);
    send(res, 200, {
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: issued.scopes.join(' '),
    });
    return 200;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://fake.invalid');
    const method = (req.method ?? 'GET').toUpperCase();
    const entry: FakeVaultRequest = { method, path: url.pathname, status: 500, at: now() };
    requests.push(entry);
    try {
      if (method === 'POST' && (url.pathname === '/api/oauth/token' || url.pathname === '/api/oauth/revoke')) {
        entry.status = await handleOAuth(req, res, url.pathname);
        return;
      }
      if (!url.pathname.startsWith(`${AGENT_API_BASE_PATH}/`)) throw fail(404, `Cannot ${method} ${url.pathname}`);
      const sub = url.pathname.slice(AGENT_API_BASE_PATH.length);
      let key = `${method} ${sub}`;
      let id: string | undefined;
      let params: Record<string, string> | undefined;
      const idMatch = ID_ROUTE.exec(sub);
      const serviceKeyMatch = SERVICE_KEY_ROUTE.exec(sub);
      if (idMatch) {
        key = `${method} /${idMatch[1]}/:id/${idMatch[3]}`;
        id = idMatch[2];
      } else if (serviceKeyMatch) {
        key = `${method} /service-keys/:service/:name`;
        try {
          params = { service: decodeURIComponent(serviceKeyMatch[1]!), name: decodeURIComponent(serviceKeyMatch[2]!) };
        } catch {
          throw fail(400, 'Validation failed');
        }
      }
      const route = routes[key];
      if (!route) throw fail(404, `Cannot ${method} ${url.pathname}`);
      const grant = authenticate(req);
      if (!grant.scopes.includes(route.scope)) {
        throw fail(403, 'Insufficient scope', 'INSUFFICIENT_SCOPE', {
          'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${route.scope}"`,
        });
      }
      if (id !== undefined && !IS_UUID.test(id)) throw fail(400, 'Validation failed (uuid is expected)');
      let body: unknown = {};
      if (method === 'POST') {
        const raw = await readBody(req);
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw fail(400, 'Body is not JSON');
        }
      }
      const out = route.handler({ grant, query: url.searchParams, body, id, params });
      entry.status = out.status ?? 200;
      send(res, entry.status, { data: out.data });
    } catch (error) {
      const e = error instanceof FakeHttpError ? error : fail(500, 'An unexpected error occurred', 'INTERNAL_ERROR');
      entry.status = e.status;
      entry.code = e.code;
      send(
        res,
        e.status,
        {
          statusCode: e.status,
          code: e.code,
          message: e.message,
          ...(e.details ? { details: e.details } : {}),
          timestamp: new Date(now()).toISOString(),
          path: url.pathname,
        },
        e.headers,
      );
    }
  };

  // ---- lifecycle --------------------------------------------------------------------------
  let server: Server | null = null;
  let baseUrl = '';

  const fake: FakeVault = {
    get baseUrl() {
      if (!baseUrl) throw new Error('The fake Vault is not started; call start() first');
      return baseUrl;
    },
    fixture,
    get requests() {
      return requests;
    },
    get grantRequests() {
      return grantRequests;
    },
    async start() {
      assertNotProduction('The fake Vault', env);
      if (server) return baseUrl;
      server = createServer((req, res) => void handle(req, res));
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
      });
      const address = server.address() as AddressInfo;
      const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      baseUrl = `http://${host}:${address.port}`;
      return baseUrl;
    },
    async stop() {
      const s = server;
      server = null;
      if (s) {
        s.closeAllConnections?.();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    },
    async connect(scopes) {
      const grant: Grant = {
        id: randomUUID(),
        clientId,
        scopes: [...(scopes ?? [...Object.values(AGENT_SCOPES), 'offline_access'])],
        revoked: false,
      };
      grants.set(grant.id, grant);
      const { expiresIn: _expiresIn, ...tokens } = issue(grant.id);
      return tokens;
    },
    async revokeGrants() {
      for (const grant of grants.values()) grant.revoked = true;
    },
    async setAgentAccess(enabled) {
      switches.enabled = enabled;
    },
    async setCardAccess(enabled) {
      switches.cards.enabled = enabled;
    },
    async setIdentityAccess(enabled) {
      switches.identity.enabled = enabled;
    },
    async setLoginOpen(key, open) {
      const row = logins.get(SEED_IDS[key]);
      if (row) row.open = open;
    },
    async throttleNext(bucket, retryAfterSeconds) {
      forced.set(bucket, Math.max(1, Math.ceil(retryAfterSeconds)));
    },
    setLimit(bucket, perMinute) {
      limits[bucket] = perMinute;
      for (const key of [...windows.keys()]) if (key.startsWith(`${bucket}:`)) windows.delete(key);
    },
    decideGrantRequest(id, decision) {
      const request = grantRequests.find((r) => r.id === id);
      if (!request || request.status !== 'pending') throw new Error('No pending grant request with that id');
      request.status = decision;
      if (decision === 'approved') {
        cardGrants.push({
          id: randomUUID(),
          merchantSite: request.merchantSite,
          frameOrigins: [],
          maxAmount: request.amount,
          currency: request.currency,
          includeSecurityCode: false,
          expiresAt: null,
        });
      }
    },
  };
  return fake;
}
