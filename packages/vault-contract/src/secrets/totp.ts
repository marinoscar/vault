/**
 * TOTP (RFC 6238) seed parsing, validation and canonical form for the `totp` field of a
 * Credential. Pure and platform-neutral (no `node:` imports) so the browser can validate too.
 * Code generation (HMAC) lives in `@marinoscar/vault-api`.
 *
 * @packageDocumentation
 */

/** HMAC algorithms a TOTP seed may name. @stability experimental */
export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

/** A validated TOTP seed and its parameters. @stability experimental */
export interface ParsedTotp {
  /** Base32 (RFC 4648), upper case, no padding. */
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 7 | 8;
  /** Seconds, 15 to 120. */
  period: number;
  issuer?: string;
  account?: string;
}

const MAX_INPUT_LENGTH = 1024;
const MAX_SECRET_LENGTH = 256;
const MIN_SECRET_LENGTH = 8;
const ALGORITHMS: readonly string[] = ['SHA1', 'SHA256', 'SHA512'];

/** Normalize a base32 string (spaces, hyphens, case, padding); `null` when invalid. */
function normalizeBase32(input: string): string | null {
  const s = input.replace(/[\s-]+/g, '').toUpperCase().replace(/=+$/, '');
  if (s.length < MIN_SECRET_LENGTH || s.length > MAX_SECRET_LENGTH) return null;
  if (!/^[A-Z2-7]+$/.test(s)) return null;
  // 1, 3 and 6 leftover characters cannot encode whole bytes.
  if ([1, 3, 6].includes(s.length % 8)) return null;
  return s;
}

function parseIntStrict(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Parse an `otpauth://totp/...` URI or a bare base32 secret. Returns `null` for anything invalid:
 * `hotp`, bad base32, an unknown algorithm, digits outside 6 to 8, a period outside 15 to 120.
 *
 * @stability experimental
 */
export function parseTotpSecret(input: string): ParsedTotp | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return null;

  if (!/^otpauth:/i.test(trimmed)) {
    const secret = normalizeBase32(trimmed);
    return secret ? { secret, algorithm: 'SHA1', digits: 6, period: 30 } : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol.toLowerCase() !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp') return null;

  const params = url.searchParams;
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) return null;
  }
  const rawSecret = params.get('secret');
  if (!rawSecret) return null;
  const secret = normalizeBase32(rawSecret);
  if (!secret) return null;

  const algorithm = (params.get('algorithm') ?? 'SHA1').toUpperCase();
  if (!ALGORITHMS.includes(algorithm)) return null;

  let digits = 6;
  if (params.has('digits')) {
    const d = parseIntStrict(params.get('digits')!);
    if (d === null || d < 6 || d > 8) return null;
    digits = d;
  }
  let period = 30;
  if (params.has('period')) {
    const p = parseIntStrict(params.get('period')!);
    if (p === null || p < 15 || p > 120) return null;
    period = p;
  }

  let label: string;
  try {
    label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
  let issuer: string | undefined;
  let account: string | undefined;
  const colon = label.indexOf(':');
  if (colon >= 0) {
    issuer = label.slice(0, colon).trim() || undefined;
    account = label.slice(colon + 1).trim() || undefined;
  } else {
    account = label.trim() || undefined;
  }
  const issuerParam = params.get('issuer')?.trim();
  if (issuerParam) issuer = issuerParam;

  return {
    secret,
    algorithm: algorithm as TotpAlgorithm,
    digits: digits as 6 | 7 | 8,
    period,
    ...(issuer ? { issuer } : {}),
    ...(account ? { account } : {}),
  };
}

/**
 * The canonical `otpauth://totp/...` URI of a parsed seed: label `issuer:account`, query
 * `secret`, `issuer`, `algorithm`, `digits`, `period` in that order. Stable, so
 * `parseTotpSecret(toCanonicalOtpauthUri(p))` equals `p`.
 *
 * @stability experimental
 */
export function toCanonicalOtpauthUri(parsed: ParsedTotp): string {
  const label = parsed.issuer
    ? `${parsed.issuer}:${parsed.account ?? ''}`
    : (parsed.account ?? '');
  const query = [`secret=${parsed.secret}`];
  if (parsed.issuer) query.push(`issuer=${encodeURIComponent(parsed.issuer)}`);
  query.push(`algorithm=${parsed.algorithm}`, `digits=${parsed.digits}`, `period=${parsed.period}`);
  return `otpauth://totp/${encodeURIComponent(label)}?${query.join('&')}`;
}

/**
 * Normalize a user-supplied `totp` field value to the canonical URI, or `null` when invalid.
 *
 * @stability experimental
 */
export function normalizeTotpSecret(input: string): string | null {
  const parsed = parseTotpSecret(input);
  return parsed ? toCanonicalOtpauthUri(parsed) : null;
}
