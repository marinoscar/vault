import { parse } from 'tldts';

/**
 * Website origins of a Credential: normalization, extraction and matching. Pure functions, no
 * I/O. Only `scheme://host[:port]` is ever derived, never a path, query or userinfo, because the
 * result is stored as plaintext metadata in `secrets.origins`.
 *
 * @packageDocumentation
 */

/** Maximum origins kept per credential. @stability experimental */
export const MAX_ORIGINS_PER_CREDENTIAL = 20;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalize a URL or bare host to an origin (`scheme://host[:port]`), or `null` when invalid or
 * refused. Bare hosts assume `https://`. Only `https:` is allowed, plus `http:` for loopback hosts.
 *
 * @stability experimental
 */
export function normalizeOrigin(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const scheme = url.protocol;
  if (scheme !== 'https:' && scheme !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  if (scheme === 'http:' && !LOOPBACK_HOSTS.has(host)) return null;
  // `url.host` already omits the scheme's default port.
  return `${scheme}//${host}${url.port ? `:${url.port}` : ''}`;
}

/**
 * The origins of a Credential: `url` plus each entry of `additional_urls` (split on whitespace, commas and semicolons), normalized,
 * deduplicated and sorted, invalid entries dropped, capped at {@link MAX_ORIGINS_PER_CREDENTIAL}.
 *
 * @stability experimental
 */
export function originsFromCredential(fields: {
  url?: unknown;
  additional_urls?: unknown;
}): string[] {
  const raw: string[] = [];
  if (typeof fields?.url === 'string') raw.push(fields.url);
  if (typeof fields?.additional_urls === 'string') raw.push(...fields.additional_urls.split(/[\s,;]+/));
  const out = new Set<string>();
  for (const entry of raw) {
    const origin = normalizeOrigin(entry);
    if (origin) out.add(origin);
  }
  return [...out].sort().slice(0, MAX_ORIGINS_PER_CREDENTIAL);
}

/** How a requested origin matched a stored origin. @stability experimental */
export type OriginMatchKind = 'exact' | 'site';

/**
 * The registrable domain (eTLD+1, Public Suffix List) of an origin's host, or `null` for IPs,
 * `localhost`, hosts that are themselves a public suffix and invalid input.
 *
 * @stability experimental
 */
export function registrableDomainOfOrigin(origin: string): string | null {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  const info = parse(normalized, { allowPrivateDomains: true });
  if (info.isIp || !info.domain) return null;
  return info.domain;
}

/**
 * Match a requested origin against stored origins: `exact` when one equals it, else `site` when
 * one shares its registrable domain, else `null`. Exact wins over site.
 *
 * @stability experimental
 */
export function matchOrigin(
  requested: string,
  origins: readonly string[],
): { matchKind: OriginMatchKind } | null {
  const want = normalizeOrigin(requested);
  if (!want) return null;
  if (origins.some((o) => normalizeOrigin(o) === want)) return { matchKind: 'exact' };
  const site = registrableDomainOfOrigin(want);
  if (!site) return null;
  if (origins.some((o) => registrableDomainOfOrigin(o) === site)) return { matchKind: 'site' };
  return null;
}
