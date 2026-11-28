import { isIP } from 'node:net';

import { isBlockedAddress } from '@marinoscar/platform-api/core';

/**
 * Origin handling of the credential broker (ADR-0006 decision 4).
 *
 * An allowed origin is `https://host[:port]`: lowercase host, no userinfo, no path, query or
 * fragment, no wildcard. The same normalisation parses the `:upstreamHost` segment of a forward, so
 * "the origin equals one of the secret's origins" is a string comparison of two normalised values.
 */

/** The result of {@link normalizeBrokerOrigin}. */
export type BrokerOriginResult = { ok: true; origin: string; hostname: string; port: number } | { ok: false; reason: string };

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Normalises `raw` to an exact public HTTPS origin, or says why not. Refused: another scheme,
 * userinfo, a path other than `/`, a query or fragment, `localhost` and every `*.localhost`,
 * `*.local` and `*.internal` name, a trailing dot, a single-label host, an IP literal in a private,
 * loopback, link-local, metadata or otherwise blocked range. The default port is dropped
 * (`https://a.example:443` is `https://a.example`).
 */
export function normalizeBrokerOrigin(raw: string): BrokerOriginResult {
  const text = raw.trim();
  if (text.length === 0 || text.length > 2048) return { ok: false, reason: 'empty or too long' };
  if (!/^https:\/\//i.test(text)) return { ok: false, reason: 'must start with https://' };
  // The text after the authority must be empty or a single slash: parse the raw text, not URL's view.
  const authority = text.slice('https://'.length);
  if (/[\\\s?#@]/.test(authority) || authority.replace(/\/$/, '').includes('/')) {
    return { ok: false, reason: 'no userinfo, path, query or fragment' };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { ok: false, reason: 'no userinfo, path, query or fragment' };
  }
  const hostname = url.hostname.toLowerCase();
  const bare = stripBrackets(hostname);
  const ipVersion = isIP(bare);
  if (ipVersion !== 0) {
    if (isBlockedAddress(bare)) return { ok: false, reason: 'a private or reserved IP address' };
  } else {
    if (hostname.endsWith('.')) return { ok: false, reason: 'no trailing dot' };
    const labels = hostname.split('.');
    if (labels.length < 2) return { ok: false, reason: 'a host name with a dot' };
    if (!labels.every((l) => HOST_LABEL.test(l) || l.startsWith('xn--'))) return { ok: false, reason: 'not a valid host name' };
    const last = labels[labels.length - 1]!;
    if (last === 'localhost' || last === 'local' || last === 'internal') {
      return { ok: false, reason: 'not a public host name' };
    }
    if (/^\d+$/.test(last)) return { ok: false, reason: 'not a valid host name' };
  }
  const port = url.port === '' ? 443 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'invalid port' };
  const origin = `https://${hostname}${port === 443 ? '' : `:${port}`}`;
  return { ok: true, origin, hostname: bare, port };
}

/** `host`, `host:port` or `[ipv6]:port`, the only shapes an `:upstreamHost` segment may take. */
const UPSTREAM_HOST_SHAPE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/;

/**
 * The normalised origin an `:upstreamHost` path segment names, or `null` when the segment is not a
 * plain `host[:port]` (a `@`, slash, percent escape or space can never be part of one).
 */
export function originOfUpstreamHost(upstreamHost: string): BrokerOriginResult | null {
  if (!UPSTREAM_HOST_SHAPE.test(upstreamHost)) return null;
  return normalizeBrokerOrigin(`https://${upstreamHost}`);
}
