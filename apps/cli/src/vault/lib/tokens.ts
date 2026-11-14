import { hostname } from 'node:os';

import { UsageError } from '@marinoscar/platform-cli/commands';

import { ApiStatusError, apiRequest, readApiErrorMessage } from './api-client.js';
import { getServerUrl, getStoredTokenMeta, getToken, getTokenSource, saveToken, vaultEnvName } from '../utils/config.js';

// =============================================================================
// Personal access tokens: create, list, revoke, and replace the stored one
// =============================================================================
//
// `vault login` (the platform's device flow) stores a PAT that expires after
// 90 days, which breaks an unattended scheduled backup. These helpers let the
// user mint a longer-lived replacement through `POST /api/pat`, store it the
// way `vault login --token` does (`saveToken`, `~/.vault/config.json`, 0600),
// and revoke the old one. They back `vault auth token ...` and the TUI's
// "Access token" screen.
//
// The raw token exists only in the `POST /api/pat` response. It is never
// logged and never put in an error message; the display helpers mask it.
// =============================================================================

export const TOKEN_DURATION_UNITS = ['minutes', 'days', 'months'] as const;
export type TokenDurationUnit = (typeof TOKEN_DURATION_UNITS)[number];

export const TOKEN_DURATION_MIN = 1;
export const TOKEN_DURATION_MAX = 999;
export const TOKEN_NAME_MAX = 100;

/** Below this many days left, the expiry is shown as a warning. */
export const EXPIRY_WARNING_DAYS = 14;

/** One row of `GET /api/pat` (the raw token is never in it). */
export interface PatListItem {
  id: string;
  name: string;
  tokenPrefix: string;
  durationValue?: number;
  durationUnit?: string;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt?: string | null;
  orgId?: string | null;
}

/** The `POST /api/pat` response: the only place the raw token appears. */
export interface PatCreated {
  token: string;
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string;
  createdAt: string;
  orgId?: string;
}

export interface TokenDuration {
  duration: number;
  unit: TokenDurationUnit;
}

/** The TUI's lifetime choices. */
export const TOKEN_PRESETS: readonly (TokenDuration & { label: string })[] = [
  { label: '90 days', duration: 90, unit: 'days' },
  { label: '6 months', duration: 6, unit: 'months' },
  { label: '1 year', duration: 12, unit: 'months' },
  { label: '2 years', duration: 24, unit: 'months' },
];

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

/** A whole number from 1 to 999, or a UsageError. */
export function parseTokenDuration(value: string | number): number {
  const text = String(value).trim();
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(n) || n < TOKEN_DURATION_MIN || n > TOKEN_DURATION_MAX) {
    throw new UsageError(`--duration must be a whole number from ${TOKEN_DURATION_MIN} to ${TOKEN_DURATION_MAX} (got "${text}").`);
  }
  return n;
}

/** `minutes`, `days` or `months` (singular and short forms accepted), or a UsageError. */
export function parseTokenUnit(value: string): TokenDurationUnit {
  const v = value.trim().toLowerCase();
  const aliases: Record<string, TokenDurationUnit> = {
    minute: 'minutes', minutes: 'minutes', min: 'minutes', mins: 'minutes', m: 'minutes',
    day: 'days', days: 'days', d: 'days',
    month: 'months', months: 'months', mo: 'months',
  };
  const unit = aliases[v];
  if (!unit) throw new UsageError(`--unit must be one of ${TOKEN_DURATION_UNITS.join(', ')} (got "${value}").`);
  return unit;
}

/**
 * A free-form lifetime as typed in the TUI: `18 months`, `45d`, `1 year`, `2y`.
 * Years become months (the API has no year unit). Throws a UsageError.
 */
export function parseDurationText(text: string): TokenDuration {
  const m = /^\s*(\d+)\s*([a-z]+)\s*$/i.exec(text);
  if (!m) throw new UsageError('Enter a number and a unit, for example "18 months" or "45 days".');
  const unitText = m[2]!.toLowerCase();
  if (['y', 'yr', 'yrs', 'year', 'years'].includes(unitText)) {
    return { duration: parseTokenDuration(Number(m[1]) * 12), unit: 'months' };
  }
  return { duration: parseTokenDuration(m[1]!), unit: parseTokenUnit(unitText) };
}

/** A token name: the given one trimmed (1 to 100 characters), else `vault-cli <host> <YYYY-MM-DD>`. */
export function resolveTokenName(name: string | undefined, now: Date = new Date(), host: string = hostname()): string {
  if (name === undefined) return defaultTokenName(now, host);
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > TOKEN_NAME_MAX) {
    throw new UsageError(`--name must be 1 to ${TOKEN_NAME_MAX} characters.`);
  }
  return trimmed;
}

export function defaultTokenName(now: Date = new Date(), host: string = hostname()): string {
  return `vault-cli ${host || 'host'} ${now.toISOString().slice(0, 10)}`.slice(0, TOKEN_NAME_MAX);
}

export function formatDuration({ duration, unit }: TokenDuration): string {
  return `${duration} ${duration === 1 ? unit.slice(0, -1) : unit}`;
}

// ---------------------------------------------------------------------------
// Display (pure)
// ---------------------------------------------------------------------------

export type ExpiryLevel = 'ok' | 'warning' | 'expired' | 'unknown';

export interface ExpiryDescription {
  /** `in 87 days`, `in 5 hours`, `expired`, `unknown`. */
  text: string;
  level: ExpiryLevel;
  /** Whole days left (negative once expired); undefined when unknown. */
  daysLeft: number | undefined;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function describeExpiry(expiresAt: string | null | undefined, now: Date = new Date()): ExpiryDescription {
  const at = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(at)) return { text: 'unknown', level: 'unknown', daysLeft: undefined };
  const ms = at - now.getTime();
  const daysLeft = Math.floor(ms / DAY);
  if (ms <= 0) return { text: 'expired', level: 'expired', daysLeft };
  const level: ExpiryLevel = ms < EXPIRY_WARNING_DAYS * DAY ? 'warning' : 'ok';
  const plural = (n: number, word: string): string => `in ${n} ${word}${n === 1 ? '' : 's'}`;
  let text: string;
  if (ms < HOUR) text = plural(Math.max(1, Math.floor(ms / MINUTE)), 'minute');
  else if (ms < 2 * DAY) text = plural(Math.floor(ms / HOUR), 'hour');
  else text = plural(daysLeft, 'day');
  return { text, level, daysLeft };
}

/** `2026-02-11` (the date part of an ISO timestamp), or `-`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '-' : new Date(t).toISOString().slice(0, 10);
}

/**
 * A display-safe hint of a token: its 8-character `pat_xxxx` prefix and an
 * ellipsis. Never returns the token, whatever the input.
 */
export function maskToken(token: string | undefined): string {
  if (!token || token.length < 16) return '********';
  return `${token.slice(0, 8)}…`;
}

// ---------------------------------------------------------------------------
// Which token is the current one (pure)
// ---------------------------------------------------------------------------

export function isActiveToken(item: PatListItem, now: Date = new Date()): boolean {
  if (item.revokedAt) return false;
  const at = Date.parse(item.expiresAt);
  return Number.isNaN(at) || at > now.getTime();
}

/**
 * The list rows that could be the token in use: the stored `tokenId` when it is
 * in the list, otherwise every active row whose prefix the token starts with
 * (the API does not mark the calling token, and a prefix is only 4 hex chars).
 */
export function currentTokenCandidates(
  list: readonly PatListItem[],
  storedToken: string | undefined,
  storedTokenId?: string,
  now: Date = new Date(),
): PatListItem[] {
  if (storedTokenId) {
    const byId = list.find((t) => t.id === storedTokenId);
    if (byId) return [byId];
  }
  if (!storedToken) return [];
  return list.filter((t) => t.tokenPrefix.length > 0 && storedToken.startsWith(t.tokenPrefix) && isActiveToken(t, now));
}

/** The token in use, when it can be identified unambiguously. */
export function findCurrentToken(
  list: readonly PatListItem[],
  storedToken: string | undefined,
  storedTokenId?: string,
  now: Date = new Date(),
): PatListItem | undefined {
  const candidates = currentTokenCandidates(list, storedToken, storedTokenId, now);
  return candidates.length === 1 ? candidates[0] : undefined;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

interface CallOptions {
  /** Use this token instead of the stored one. */
  token?: string;
}

async function patJson<T>(path: string, init: RequestInit & CallOptions = {}): Promise<T> {
  const res = await apiRequest(path, init);
  if (!res.ok) throw new ApiStatusError(res.status, await readApiErrorMessage(res));
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data?: T } | T;
  return (json !== null && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export function createPat(input: TokenDuration & { name: string }, opts: CallOptions = {}): Promise<PatCreated> {
  return patJson<PatCreated>('/pat', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, durationValue: input.duration, durationUnit: input.unit }),
    ...opts,
  });
}

export async function listPats(opts: CallOptions = {}): Promise<PatListItem[]> {
  const data = await patJson<PatListItem[] | { items: PatListItem[] }>('/pat', opts);
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export async function revokePat(id: string, opts: CallOptions = {}): Promise<void> {
  await patJson<void>(`/pat/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });
}

// ---------------------------------------------------------------------------
// The current token, and replacing it
// ---------------------------------------------------------------------------

export type TokenSource = ReturnType<typeof getTokenSource>;

/** What the CLI knows locally about the token it would send. Never the token itself. */
export interface LocalTokenState {
  serverUrl: string;
  source: TokenSource;
  hint: string;
  tokenId: string | undefined;
  tokenName: string | undefined;
  expiresAt: string | undefined;
}

export function localTokenState(): LocalTokenState {
  const meta = getStoredTokenMeta();
  return {
    serverUrl: getServerUrl(),
    source: getTokenSource(),
    hint: maskToken(getToken()),
    tokenId: meta.tokenId,
    tokenName: meta.tokenName,
    expiresAt: meta.expiresAt,
  };
}

/** The current token's row on the server, when it can be identified. */
export async function fetchCurrentToken(now: Date = new Date()): Promise<{ current: PatListItem | undefined; list: PatListItem[] }> {
  const list = await listPats();
  const current = findCurrentToken(list, getToken(), getStoredTokenMeta().tokenId, now);
  return { current, list };
}

/** The warning `--store` prints when `VAULT_TOKEN` will keep winning over the file. */
export function envOverrideWarning(): string {
  return `${vaultEnvName('TOKEN')} is set in the environment and still takes precedence over the stored token; unset it (or update it) to use the new one.`;
}

export interface ReplaceTokenDeps {
  create: typeof createPat;
  list: typeof listPats;
  revoke: typeof revokePat;
  store: (created: PatCreated, serverUrl: string) => string;
  storedToken: () => string | undefined;
  storedTokenId: () => string | undefined;
  serverUrl: () => string;
  now: () => Date;
}

export const defaultReplaceTokenDeps: ReplaceTokenDeps = {
  create: createPat,
  list: listPats,
  revoke: revokePat,
  store: (created, serverUrl) =>
    saveToken(created.token, serverUrl, { expiresAt: created.expiresAt, tokenId: created.id, tokenName: created.name }),
  storedToken: getToken,
  storedTokenId: () => getStoredTokenMeta().tokenId,
  serverUrl: getServerUrl,
  now: () => new Date(),
};

export interface ReplaceTokenResult {
  /** The new token's row (no raw token). */
  created: Omit<PatCreated, 'token'>;
  /** The config file it was written to. */
  file: string;
  /** The token that was in use before, when it could be identified. */
  previous: PatListItem | undefined;
  /** True when `previous` was revoked. */
  revokedPrevious: boolean;
}

/**
 * Creates a token with the current credentials, stores it, verifies it by
 * listing tokens WITH THE NEW TOKEN, and only then (when asked) revokes the old
 * one, also with the new token. A failure before the store leaves the old
 * token in place; a failed verification never revokes anything.
 */
export async function replaceStoredToken(
  input: TokenDuration & { name: string; revokePrevious: boolean },
  deps: ReplaceTokenDeps = defaultReplaceTokenDeps,
): Promise<ReplaceTokenResult> {
  const now = deps.now();
  const before = await deps.list();
  const candidates = currentTokenCandidates(before, deps.storedToken(), deps.storedTokenId(), now);
  const previous = candidates.length === 1 ? candidates[0] : undefined;
  if (input.revokePrevious && previous === undefined) {
    throw new Error(
      candidates.length > 1
        ? 'Cannot tell which token is the current one (several share its prefix); nothing was created. Run without --revoke-current and revoke the old one with: vault auth token revoke <id>'
        : 'The current token was not found among your tokens; nothing was created. Run without --revoke-current.',
    );
  }

  const created = await deps.create({ name: input.name, duration: input.duration, unit: input.unit });
  const file = deps.store(created, deps.serverUrl());

  let after: PatListItem[];
  try {
    after = await deps.list({ token: created.token });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`The new token was stored in ${file} but could not be verified (${why}); the previous token was not revoked.`);
  }
  if (!after.some((t) => t.id === created.id)) {
    throw new Error(`The new token was stored in ${file} but is not in the server's token list; the previous token was not revoked.`);
  }

  let revokedPrevious = false;
  if (input.revokePrevious && previous && previous.id !== created.id) {
    await deps.revoke(previous.id, { token: created.token });
    revokedPrevious = true;
  }

  const { token: _token, ...row } = created;
  void _token;
  return { created: row, file, previous, revokedPrevious };
}
