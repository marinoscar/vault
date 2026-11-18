// =============================================================================
// JSON-RPC 2.0 and MCP result shapes (issue #180, E14.8, epic #172)
// =============================================================================
//
// PLATFORM-ADOPTION-SHIM(mcp): the protocol layer in `mcp/protocol/` is the stop-gap for the platform
// MCP slice requested in marinoscar/EnterpriseAppBase#1201. It is lifted from, and trimmed against,
// the reference implementation in `console/apps/api/src/mcp/` of marinoscar/hexactra, and is
// deleted when the platform slice ships (docs/platform-adoption/local-exceptions.md). It knows
// nothing of Vault: the Vault tools are `mcp/vault-mcp-tools.ts`.
//
// Pure: no Nest, no I/O.
// =============================================================================

/** JSON-RPC error codes the server answers with. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  /** 2026-07-28: HTTP headers do not match the body, or a required header is missing. */
  HEADER_MISMATCH: -32020,
  /** 2026-07-28: the request's protocol version is not supported. */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  /** Implementation-defined: too many requests; `data.retryAfterS` is the wait. */
  RATE_LIMITED: -32029,
  /** Implementation-defined: the administrator switched this kind of caller off. */
  DISABLED: -32030,
} as const;

/** A JSON-RPC id. */
export type RpcId = string | number | null;

/** A JSON-RPC response. */
export interface RpcResponse {
  jsonrpc: '2.0';
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A successful JSON-RPC response. */
export function rpcResult(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** A JSON-RPC error response. */
export function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** One content block of a tool result: text only (Vault never returns an image). */
export interface McpContent {
  type: 'text';
  text: string;
}

/** What a tool call answers with (`tools/call` result). */
export interface McpToolResult {
  content: McpContent[];
  /** Typed result for clients on 2025-06-18 and later (dropped for older revisions). */
  structuredContent?: Record<string, unknown>;
  /** `true` for an error the model should read and act on. */
  isError?: boolean;
}

/** A successful result: the object as JSON text and as `structuredContent`. */
export function structuredResult(value: Record<string, unknown>, summary?: string): McpToolResult {
  const json = JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text: summary ? `${summary}\n${json}` : json }],
    structuredContent: value,
  };
}

/** A tool error the model sees (`isError: true`), never a JSON-RPC error. */
export function errorResult(message: string, code = 'INVALID_ARGUMENTS'): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: { code, message },
  };
}
