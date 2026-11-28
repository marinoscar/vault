import type { IncomingHttpHeaders } from 'node:http';

import { isForbiddenInjectionHeader, type BrokerInjection } from '@marinoscar/vault-contract/broker';

/**
 * Header and key handling of the credential broker (ADR-0006 decisions 8 and 9): what is stripped
 * from the caller's request, what is stripped from the upstream's response, how the key is injected
 * and how a response is scanned for it. Pure functions, no I/O.
 */

/** Request headers that never reach the upstream (compared in lower case). */
const DROP_REQUEST_EXACT = new Set([
  'authorization',
  'cookie',
  'host',
  'forwarded',
  'x-real-ip',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'accept-encoding',
]);
const DROP_REQUEST_PREFIX = ['proxy-', 'x-forwarded-', 'x-vault-'];

/** Response headers that never reach the caller (compared in lower case). */
const DROP_RESPONSE_EXACT = new Set([
  'set-cookie',
  'set-cookie2',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
]);
const DROP_RESPONSE_PREFIX = ['proxy-', 'x-vault-'];

/** A header map with lower-case names, one string per name (repeated values joined for a request). */
export type BrokerHeaders = Record<string, string | string[]>;

/** The caller's headers minus everything that must not reach the upstream. */
export function filterRequestHeaders(headers: IncomingHttpHeaders): BrokerHeaders {
  const out: BrokerHeaders = {};
  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (DROP_REQUEST_EXACT.has(name) || DROP_REQUEST_PREFIX.some((p) => name.startsWith(p))) continue;
    out[name] = value;
  }
  return out;
}

/** The upstream's headers minus Set-Cookie, hop-by-hop and framing headers (the body is re-framed). */
export function filterResponseHeaders(headers: IncomingHttpHeaders): BrokerHeaders {
  const out: BrokerHeaders = {};
  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (DROP_RESPONSE_EXACT.has(name) || DROP_RESPONSE_PREFIX.some((p) => name.startsWith(p))) continue;
    out[name] = value;
  }
  return out;
}

/**
 * The injected header value: `<prefix> <key>`, or just the key without a prefix. For `Basic` the
 * key is `user:password` and the value is `Basic base64(user:password)`.
 */
export function injectedHeaderValue(injection: Extract<BrokerInjection, { kind: 'header' }>, key: string): string {
  const prefix = injection.prefix ?? '';
  if (prefix === '') return key;
  if (prefix === 'Basic') return `Basic ${Buffer.from(key, 'utf8').toString('base64')}`;
  return `${prefix} ${key}`;
}

/**
 * Sets the key on the request: a header (replacing any header of that name, case-insensitively, and
 * set after the caller's headers so a caller cannot choose it) or a query parameter (replacing any
 * caller parameter of that name). Returns the headers, the query (without `?`) and the exact value
 * that was injected, for the echo scan.
 */
export function applyInjection(
  injection: BrokerInjection,
  key: string,
  headers: BrokerHeaders,
  query: string,
): { headers: BrokerHeaders; query: string; injected: string } {
  if (injection.kind === 'header') {
    if (isForbiddenInjectionHeader(injection.name)) throw new Error('forbidden injection header');
    const out: BrokerHeaders = { ...headers };
    const lower = injection.name.toLowerCase();
    for (const name of Object.keys(out)) if (name.toLowerCase() === lower) delete out[name];
    const injected = injectedHeaderValue(injection, key);
    out[lower] = injected;
    return { headers: out, query, injected };
  }
  const kept = query
    .split('&')
    .filter((pair) => pair !== '')
    .filter((pair) => {
      const rawKey = pair.split('=')[0] ?? '';
      let decoded = rawKey;
      try {
        decoded = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        /* keep the raw text */
      }
      return decoded !== injection.name && rawKey !== injection.name;
    });
  const pair = `${encodeURIComponent(injection.name)}=${encodeURIComponent(key)}`;
  return { headers, query: [...kept, pair].join('&'), injected: pair };
}

/**
 * The byte strings whose presence in a response means the key came back: the key, its base64 (both
 * alphabets, with and without padding), its percent-encoded form (both hex cases), the injected
 * header value or query pair, and the base64 of that. Best effort for other transformations (ADR-0006).
 */
export function echoNeedles(key: string, injected: string): Buffer[] {
  const forms = new Set<string>();
  const add = (text: string): void => {
    if (text.length > 0) forms.add(text);
  };
  const b64 = (text: string): string[] => {
    const std = Buffer.from(text, 'utf8').toString('base64');
    const url = Buffer.from(text, 'utf8').toString('base64url');
    return [std, std.replace(/=+$/, ''), url];
  };
  add(key);
  for (const form of b64(key)) add(form);
  const pct = encodeURIComponent(key);
  add(pct);
  add(pct.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()));
  add(injected);
  for (const form of b64(injected)) add(form);
  return [...forms].map((f) => Buffer.from(f, 'utf8'));
}

/** Whether any needle appears in the body or in any header name or value. */
export function containsKey(needles: readonly Buffer[], headers: IncomingHttpHeaders, body: Buffer): boolean {
  const headerText = Buffer.from(
    Object.entries(headers)
      .flatMap(([name, value]) => (Array.isArray(value) ? value : [value ?? '']).map((v) => `${name}: ${v}`))
      .join('\n'),
    'utf8',
  );
  return needles.some((needle) => body.includes(needle) || headerText.includes(needle));
}
