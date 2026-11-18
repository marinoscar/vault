/**
 * VAULT_MCP_OPTIONS: the host's settings of the MCP endpoint (optional port; every field has a default).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_MCP_OPTIONS = Symbol.for('@marinoscar/vault/VAULT_MCP_OPTIONS');

/** What a host tells the MCP endpoint. */
export interface VaultMcpOptions {
  /**
   * The application's public URL (`APP_URL`). The Origin rule admits this origin only (plus
   * `allowedOrigins`): a browser request from any other origin is refused with 403.
   */
  appUrl?: string;
  /** Extra browser origins allowed to call the endpoint. Empty by default (hosted clients send no `Origin`). */
  allowedOrigins?: readonly string[];
  /** Tool calls per minute per OAuth grant (or token) and user. Default {@link MCP_RATE_PER_MINUTE}. */
  ratePerMinute?: number;
}

/** The default per-minute limit of `tools/call` (the `mcp` bucket of the agent rate limiter). */
export const MCP_RATE_PER_MINUTE = 60;
