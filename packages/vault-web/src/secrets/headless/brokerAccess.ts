import {
  BROKER_HEADER_PREFIXES,
  DEFAULT_BROKER_INJECTION,
  MAX_BROKER_ORIGINS,
  brokerBaseUrl,
  isForbiddenInjectionHeader,
  type BrokerInjection,
} from '@marinoscar/vault-contract/broker';
import { isAssistantRevealExcludedType } from './secretFields.js';

/**
 * The credential broker's web helpers (#246, ADR-0006). The API is the authority: everything here
 * mirrors its rules only to answer early and kindly.
 */

export { DEFAULT_BROKER_INJECTION, BROKER_HEADER_PREFIXES, MAX_BROKER_ORIGINS };
export type { BrokerInjection };

type TypeLike = { name: string; isSystem?: boolean; fields?: Array<{ name?: string; type?: string; sensitive?: boolean }> };

const BROKER_SYSTEM_TYPES = ['api key', 'token', 'service key'];

/** Names of the sensitive string fields of a type: the candidates for the injected key. */
export function brokerSensitiveFields(type: TypeLike | null | undefined): string[] {
  return (type?.fields ?? [])
    .filter((f) => typeof f?.name === 'string' && f.sensitive === true && (f.type === undefined || f.type === 'string'))
    .map((f) => f.name as string);
}

/**
 * True when a secret of this type can be used through the broker: a system API Key, Token or Service
 * Key, or a custom type with a sensitive string field; never a type an assistant can not reveal.
 */
export function isBrokerSupportedType(type: TypeLike | null | undefined): boolean {
  if (!type || isAssistantRevealExcludedType(type)) return false;
  if (type.isSystem && !BROKER_SYSTEM_TYPES.includes(type.name.toLowerCase())) return false;
  return brokerSensitiveFields(type).length > 0;
}

/** Why `raw` is not an allowed origin, or null when it is `https://host[:port]`. */
export function validateBrokerOrigin(raw: string): string | null {
  const text = raw.trim();
  if (!text) return 'Enter an origin such as https://api.service-x.example';
  if (!/^https:\/\//i.test(text)) return 'An origin must start with https://';
  const authority = text.slice('https://'.length);
  if (/[\\\s?#@]/.test(authority) || authority.replace(/\/$/, '').includes('/')) {
    return 'Use only the host: no path, query, fragment or login';
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'This is not a valid URL';
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.')) return 'Remove the trailing dot';
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
  if (isIp) return 'Use a host name, not an IP address';
  const labels = host.split('.');
  if (labels.length < 2) return 'Use a public host name with a dot';
  const last = labels[labels.length - 1]!;
  if (host === 'localhost' || ['localhost', 'local', 'internal'].includes(last)) return 'Use a public host name';
  return null;
}

/** The origin in the form the API stores (lower case host, no trailing slash, default port dropped). */
export function normalizeBrokerOriginText(raw: string): string {
  const text = raw.trim();
  try {
    const url = new URL(text);
    return `https://${url.hostname.toLowerCase()}${url.port && url.port !== '443' ? `:${url.port}` : ''}`;
  } catch {
    return text;
  }
}

/** Why `name` can not carry the key as a header, or null. */
export function validateInjectionName(kind: 'header' | 'query', name: string): string | null {
  const text = name.trim();
  if (kind === 'header') {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(text)) return 'Use 1 to 64 letters, digits or hyphens';
    if (isForbiddenInjectionHeader(text)) return 'This header name cannot carry a key';
    return null;
  }
  return /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? null : 'Use 1 to 64 letters, digits, dots, hyphens or underscores';
}

/** One line for the secret page: `Header Authorization: Bearer`, `Query parameter api_key`. */
export function describeBrokerInjection(inj: BrokerInjection | null | undefined): string {
  const i = inj ?? DEFAULT_BROKER_INJECTION;
  if (i.kind === 'query') return `Query parameter ${i.name}`;
  return `Header ${i.name}${i.prefix ? `: ${i.prefix} <key>` : ': <key>'}`;
}

/** The base URL an SDK points at, for each allowed origin. */
export function brokerUrls(secretId: string, origins: string[], windowOrigin: string): Array<{ origin: string; url: string }> {
  return origins.map((origin) => ({ origin, url: brokerBaseUrl(`${windowOrigin}/api`, secretId, origin) }));
}

/** A friendly message for a failed broker change. */
export function brokerAccessErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'BROKER_UNSUPPORTED_TYPE':
      return 'This kind of secret cannot be used through the broker.';
    case 'BROKER_ORIGINS_REQUIRED':
      return 'Add at least one allowed origin.';
    case 'BROKER_ORIGIN_INVALID':
      return 'One of the origins is not allowed. Use public https://host addresses with no path.';
    case 'BROKER_FIELD_INVALID':
      return 'Choose which sensitive field holds the key.';
    default:
      break;
  }
  const status = (err as { status?: number } | null)?.status;
  if (status === 403 || status === 404) return 'Only the owner of this secret can change broker access.';
  return err instanceof Error ? err.message : 'Failed to update broker access';
}
