// =============================================================================
// The protocol layer of the MCP server (issue #180, E14.8, epic #172)
// =============================================================================
//
// PLATFORM-ADOPTION-SHIM(mcp): see `mcp-rpc.ts`. The revisions the server speaks, how the revision of
// one request is determined, the 2026-07-28 header rules, the Origin rule and the per-request
// context. Pure functions, no Nest and no I/O, so every rule is a unit test.
// Specification: https://modelcontextprotocol.io/specification (revisions 2024-11-05 to 2026-07-28).
// =============================================================================

import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';

import { RPC } from './mcp-rpc';

/** What one revision gets from this server. */
export interface McpVersionFlags {
  /** `initialize` / `notifications/initialized` (every revision before 2026-07-28). */
  handshake: boolean;
  /** JSON-RPC batches (2025-03-26 only). The server refuses every batch regardless. */
  batching: boolean;
  /** `structuredContent` and `outputSchema` on tools (2025-06-18 and later). */
  structuredContent: boolean;
  /** `title` on tools (2025-06-18 and later). */
  toolTitle: boolean;
  /** Version, client info and capabilities in every request's `_meta`; `Mcp-Method`/`Mcp-Name` headers (2026-07-28). */
  perRequestMeta: boolean;
  /** `ttlMs` and `cacheScope` on list results, `resultType` on every result (2026-07-28). */
  listCacheHints: boolean;
}

/** Every revision this server speaks, newest first. */
export const SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export type McpVersion = (typeof SUPPORTED_VERSIONS)[number];

export const MCP_VERSIONS: Readonly<Record<McpVersion, McpVersionFlags>> = {
  '2026-07-28': { handshake: false, batching: false, structuredContent: true, toolTitle: true, perRequestMeta: true, listCacheHints: true },
  '2025-11-25': { handshake: true, batching: false, structuredContent: true, toolTitle: true, perRequestMeta: false, listCacheHints: false },
  '2025-06-18': { handshake: true, batching: false, structuredContent: true, toolTitle: true, perRequestMeta: false, listCacheHints: false },
  '2025-03-26': { handshake: true, batching: true, structuredContent: false, toolTitle: false, perRequestMeta: false, listCacheHints: false },
  '2024-11-05': { handshake: true, batching: false, structuredContent: false, toolTitle: false, perRequestMeta: false, listCacheHints: false },
};

/** The answer to an `initialize` asking for a revision this server does not speak. */
export const LATEST_HANDSHAKE_VERSION: McpVersion = '2025-11-25';
/** A request with no header and no `_meta` version (the transport's rule for clients before 2025-06-18). */
export const DEFAULT_VERSION: McpVersion = '2025-03-26';

/** The `_meta` keys of 2026-07-28. */
export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
} as const;

/** `tools/list` freshness on 2026-07-28: five minutes. */
export const LIST_TTL_MS = 300_000;
/** The list depends on the caller: shared caches must never reuse it across authorizations. */
export const LIST_CACHE_SCOPE = 'private' as const;

/** Methods that carry `Mcp-Name` on 2026-07-28, and the param it mirrors. */
const NAMED_METHODS: Readonly<Record<string, 'name' | 'uri'>> = { 'tools/call': 'name', 'resources/read': 'uri', 'prompts/get': 'name' };

/** Whether `v` is a revision this server speaks. */
export function isSupportedVersion(v: unknown): v is McpVersion {
  return typeof v === 'string' && (SUPPORTED_VERSIONS as readonly string[]).includes(v);
}

/** A JSON-RPC message as it arrives (not yet validated). */
export interface RpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** Client software as it names itself (`clientInfo`). */
export interface McpClientInfo {
  name: string;
  version?: string;
  title?: string;
}

/** Everything the dispatcher knows about one request. */
export interface McpRequestContext {
  version: McpVersion;
  flags: McpVersionFlags;
  clientInfo?: McpClientInfo;
  clientCapabilities?: Record<string, unknown>;
  /** Which credential admitted the request. */
  credential: AuthCredentialInfo | null;
}

/** A refusal at the transport level: an HTTP status plus a JSON-RPC error. */
export class McpProtocolError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** The `400 UnsupportedProtocolVersion` naming the supported revisions. */
export function unsupportedVersion(requested: string): McpProtocolError {
  return new McpProtocolError(400, RPC.UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version: ${requested.slice(0, 64)}. Supported: ${SUPPORTED_VERSIONS.join(', ')}`, {
    supported: [...SUPPORTED_VERSIONS],
    requested: requested.slice(0, 64),
  });
}

function headerMismatch(message: string): McpProtocolError {
  return new McpProtocolError(400, RPC.HEADER_MISMATCH, `Header mismatch: ${message}`);
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** The `_meta` object of a message's params, if any. */
export function requestMeta(msg: RpcMessage): Record<string, unknown> | undefined {
  return record(record(msg.params)?._meta);
}

/** Decode a header value that may use the 2026-07-28 Base64 sentinel (`=?base64?...?=`). */
export function decodeHeaderValue(v: string): string {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  return m ? Buffer.from(m[1]!, 'base64').toString('utf8') : v;
}

/** The request headers this layer reads (lower-case names). */
export interface McpHeaders {
  protocolVersion?: string;
  method?: string;
  name?: string;
}

/** The revision an `initialize` answers with: the one asked for when it is a handshake revision, else the latest. */
export function negotiateInitialize(asked: unknown): McpVersion {
  return isSupportedVersion(asked) && MCP_VERSIONS[asked].handshake ? asked : LATEST_HANDSHAKE_VERSION;
}

/**
 * The revision of one request, in order: the `MCP-Protocol-Version` header, the `_meta` version, the
 * `initialize` params' `protocolVersion`, else `2025-03-26`. An unsupported header or `_meta` version
 * is a `400` naming the supported versions; an `initialize` asking for an unknown revision is answered
 * with the latest handshake revision (lifecycle rule), never refused.
 */
export function resolveVersion(headers: McpHeaders, msg: RpcMessage): McpVersion {
  const header = headers.protocolVersion?.trim();
  if (header) {
    if (!isSupportedVersion(header)) throw unsupportedVersion(header);
    return header;
  }
  const meta = requestMeta(msg)?.[META.protocolVersion];
  if (typeof meta === 'string') {
    if (!isSupportedVersion(meta)) throw unsupportedVersion(meta);
    return meta;
  }
  if (msg.method === 'initialize') return negotiateInitialize(record(msg.params)?.protocolVersion);
  return DEFAULT_VERSION;
}

/**
 * The 2026-07-28 Streamable HTTP rules: the version header is required and equals the `_meta` version;
 * a request carries `Mcp-Method` equal to its `method`; `tools/call` carries `Mcp-Name` equal to
 * `params.name`. Any miss is `400 HeaderMismatch`. On every revision a header that IS present must
 * agree with the body.
 */
export function validateHeaders(version: McpVersion, headers: McpHeaders, msg: RpcMessage): void {
  const strict = MCP_VERSIONS[version].perRequestMeta;
  const isRequest = msg.id !== undefined;
  const method = typeof msg.method === 'string' ? msg.method : '';
  const metaVersion = requestMeta(msg)?.[META.protocolVersion];
  const headerVersion = headers.protocolVersion?.trim();

  if (strict) {
    if (!headerVersion) throw headerMismatch('the MCP-Protocol-Version header is required');
    if (metaVersion !== headerVersion) {
      throw headerMismatch(`MCP-Protocol-Version header value '${headerVersion.slice(0, 32)}' does not match _meta["${META.protocolVersion}"]`);
    }
  } else if (headerVersion && typeof metaVersion === 'string' && metaVersion !== headerVersion) {
    throw headerMismatch(`MCP-Protocol-Version header value '${headerVersion.slice(0, 32)}' does not match _meta["${META.protocolVersion}"]`);
  }

  const methodHeader = headers.method;
  if (methodHeader !== undefined) {
    if (methodHeader !== method) throw headerMismatch(`Mcp-Method header value '${methodHeader.slice(0, 64)}' does not match body value '${method.slice(0, 64)}'`);
  } else if (strict && isRequest) {
    throw headerMismatch('the Mcp-Method header is required');
  }

  const field = NAMED_METHODS[method];
  if (!field) return;
  const bodyName = record(msg.params)?.[field];
  const nameHeader = headers.name !== undefined ? decodeHeaderValue(headers.name) : undefined;
  if (nameHeader !== undefined) {
    if (nameHeader !== bodyName) throw headerMismatch('Mcp-Name header does not match the body');
  } else if (strict && isRequest) {
    throw headerMismatch(`the Mcp-Name header is required for ${method}`);
  }
}

function clientInfoOf(v: unknown): McpClientInfo | undefined {
  const r = record(v);
  if (!r || typeof r.name !== 'string') return undefined;
  return {
    name: r.name.slice(0, 64),
    ...(typeof r.version === 'string' ? { version: r.version.slice(0, 64) } : {}),
    ...(typeof r.title === 'string' ? { title: r.title.slice(0, 128) } : {}),
  };
}

/**
 * Validate the headers and build the context of one message: its revision, that revision's flags, and
 * the client info and capabilities it carries (from `_meta` on 2026-07-28, from `initialize` before).
 */
export function requestContext(headers: McpHeaders, msg: RpcMessage, credential: AuthCredentialInfo | null): McpRequestContext {
  const version = resolveVersion(headers, msg);
  validateHeaders(version, headers, msg);
  const meta = requestMeta(msg);
  const params = record(msg.params);
  const fromInit = msg.method === 'initialize';
  const clientInfo = clientInfoOf(meta?.[META.clientInfo] ?? (fromInit ? params?.clientInfo : undefined));
  const clientCapabilities = record(meta?.[META.clientCapabilities] ?? (fromInit ? params?.capabilities : undefined));
  return {
    version,
    flags: MCP_VERSIONS[version],
    ...(clientInfo ? { clientInfo } : {}),
    ...(clientCapabilities ? { clientCapabilities } : {}),
    credential,
  };
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The Origin rule (DNS rebinding): an `Origin` header that is present must be the application's own
 * origin (`APP_URL`) or one of `extra` (empty by default; no loopback exception).
 * A request without an `Origin` (a hosted client's server, a CLI, an SDK) is not a browser and passes:
 * the caller checks `origin !== undefined` first.
 */
export function isAllowedOrigin(origin: string, appUrl: string | undefined, extra: readonly string[] = []): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.origin !== origin.replace(/\/+$/, '')) return false; // a path, credentials or junk: not an origin
  const own = originOf(appUrl);
  if (own && own === o.origin) return true;
  return extra.some((e) => originOf(e) === o.origin);
}

/** The `Accept` rule: absent, `application/json`, `application/*` or `*\/*` passes. */
export function acceptsJson(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  return accept
    .split(',')
    .map((p) => p.split(';')[0]!.trim().toLowerCase())
    .some((t) => t === 'application/json' || t === 'application/*' || t === '*/*');
}
