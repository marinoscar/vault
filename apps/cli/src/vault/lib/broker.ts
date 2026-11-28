import { apiRequest } from './api-client.js';
import { config } from '../utils/config.js';
import type { Secret } from '../utils/types.js';

// =============================================================================
// The credential broker client (issue #246): per-secret opt-in and broker tokens.
// =============================================================================

export const BROKER_HEADER_PREFIXES = ['Bearer', 'Token', 'Basic', 'Bot', 'ApiKey', 'none'] as const;
export const BROKER_TOKEN_DEFAULT_EXPIRES_DAYS = 90;
export const BROKER_TOKEN_MAX_EXPIRES_DAYS = 3650;

export type BrokerInjection =
  | { kind: 'header'; name: string; prefix?: string }
  | { kind: 'query'; name: string };

export interface BrokerAccessBody {
  enabled: boolean;
  origins?: string[];
  injection?: BrokerInjection;
  field?: string;
}

export interface BrokerToken {
  id: string;
  name: string;
  tokenPrefix: string;
  secretIds: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedBrokerToken extends BrokerToken {
  token: string;
}

/** Messages for the broker's 4xx error codes. */
export const BROKER_ERROR_MESSAGES: Record<string, string> = {
  BROKER_UNSUPPORTED_TYPE:
    'This secret type cannot be used through the broker (cards and identity documents are excluded).',
  BROKER_ORIGINS_REQUIRED: 'Turning the broker on needs at least one origin. Pass --origin https://host.',
  BROKER_ORIGIN_INVALID:
    'An origin is not valid. Use an exact, public HTTPS origin such as https://api.service-x.example (no path, no credentials).',
  BROKER_FIELD_INVALID: "--field is not a sensitive field of this secret's type.",
  BROKER_INJECTION_INVALID:
    'The stored injection setting is invalid; pass --header/--prefix or --query again.',
  BROKER_TOKEN_SECRET_INVALID:
    'A --secret is not one of your own secrets with the broker on. Enable it first: vault secrets broker <secret> on --origin <origin>.',
  BROKER_DISABLED: 'The credential broker is turned off on this server.',
};

/** Map a failed broker call to the message the CLI prints. */
export function brokerErrorMessage(status: number, code: string | undefined, fallback: string): string {
  if (code && BROKER_ERROR_MESSAGES[code]) return BROKER_ERROR_MESSAGES[code]!;
  if (status === 404) return 'Not found (404). Check the id and that you own it.';
  if (status === 403) return `Not allowed (403). ${fallback}`;
  return fallback;
}

async function failure(res: Response, what: string): Promise<Error> {
  let code: string | undefined;
  let message: string | undefined;
  let raw = '';
  try {
    raw = await res.text();
    const body = JSON.parse(raw) as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string') code = body.code;
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // not JSON
  }
  const fallback = `Failed to ${what}: ${res.status}${message ? ' ' + message : raw ? ' ' + raw : ''}`;
  return new Error(brokerErrorMessage(res.status, code, fallback));
}

/** PATCH /secrets/:id/broker-access (owner only). */
export async function setBrokerAccess(id: string, body: BrokerAccessBody): Promise<Secret> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}/broker-access`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, 'update broker access');
  return ((await res.json()) as { data: Secret }).data;
}

export async function createBrokerToken(body: {
  name: string;
  expiresInDays: number;
  secretIds?: string[];
}): Promise<CreatedBrokerToken> {
  const res = await apiRequest('/broker/tokens', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw await failure(res, 'create broker token');
  return ((await res.json()) as { data: CreatedBrokerToken }).data;
}

export async function listBrokerTokens(): Promise<BrokerToken[]> {
  const res = await apiRequest('/broker/tokens');
  if (!res.ok) throw await failure(res, 'list broker tokens');
  return ((await res.json()) as { data: BrokerToken[] }).data;
}

export async function revokeBrokerToken(id: string): Promise<void> {
  const res = await apiRequest(`/broker/tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
  if (!res.ok) throw await failure(res, 'revoke broker token');
}

/** `<apiBase>/broker/v1/<secretId>/<host[:port]>` (the base URL an SDK points at). */
export function brokerBaseUrl(secretId: string, origin: string, apiBase: string = config.apiUrl): string {
  const host = origin.replace(/^https:\/\//i, '').replace(/\/+$/, '');
  return `${apiBase.replace(/\/+$/, '')}/broker/v1/${secretId}/${host}`;
}

/** Normalise an origin for comparison: lower case, no trailing slash. */
export function normaliseOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/** `--prefix none` means an empty prefix; undefined stays undefined. */
export function toApiPrefix(prefix: string | undefined): string | undefined {
  if (prefix === undefined) return undefined;
  return prefix.toLowerCase() === 'none' ? '' : canonicalPrefix(prefix);
}

function canonicalPrefix(prefix: string): string {
  return BROKER_HEADER_PREFIXES.find((p) => p.toLowerCase() === prefix.toLowerCase()) ?? prefix;
}

/** Build the injection from the flags; undefined when neither is given. Throws on a bad combination. */
export function buildInjection(opts: { header?: string; prefix?: string; query?: string }): BrokerInjection | undefined {
  if (opts.header !== undefined && opts.query !== undefined) {
    throw new Error('Use either --header or --query, not both.');
  }
  if (opts.query !== undefined) {
    if (opts.prefix !== undefined) throw new Error('--prefix only applies to --header.');
    return { kind: 'query', name: opts.query };
  }
  if (opts.prefix !== undefined) {
    const known = BROKER_HEADER_PREFIXES.some((p) => p.toLowerCase() === opts.prefix!.toLowerCase());
    if (!known) throw new Error(`Invalid --prefix. Use one of: ${BROKER_HEADER_PREFIXES.join(', ')}.`);
  }
  if (opts.header === undefined && opts.prefix === undefined) return undefined;
  const prefix = toApiPrefix(opts.prefix ?? 'Bearer');
  return { kind: 'header', name: opts.header ?? 'Authorization', ...(prefix !== undefined ? { prefix } : {}) };
}

/** One-line summary of an injection (the default when unset). */
export function describeInjection(injection: BrokerInjection | null | undefined): string {
  if (!injection) return 'header Authorization (Bearer)';
  if (injection.kind === 'query') return `query ?${injection.name}=`;
  return `header ${injection.name}${injection.prefix ? ` (${injection.prefix})` : ' (no prefix)'}`;
}

/** `--expires 90` or `90d` to days. */
export function parseExpiresDays(value: string): number {
  const m = /^(\d+)d?$/i.exec(value.trim());
  const days = m ? parseInt(m[1]!, 10) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > BROKER_TOKEN_MAX_EXPIRES_DAYS) {
    throw new Error(`Invalid --expires. Use a number of days from 1 to ${BROKER_TOKEN_MAX_EXPIRES_DAYS} (for example 90).`);
  }
  return days;
}
