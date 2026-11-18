// =============================================================================
// The MCP endpoint's host binding (issue #180, E14.8, epic #172)
// =============================================================================
//
// `POST /api/mcp` (the Model Context Protocol server for chat assistants) is `@marinoscar/vault-api`'s
// (`src/mcp/`: the controller, the dispatcher, the five tools); the protocol layer inside it
// (`src/mcp/protocol/`) is the STOP-GAP for the platform MCP slice requested in
// marinoscar/EnterpriseAppBase#1201 (docs/platform-adoption/local-exceptions.md, "E14.8"). This file
// binds the one thing the package cannot know: the application's own URL, for the Origin rule (a
// request whose `Origin` is not `APP_URL` is refused with 403).
//
// The OAuth scopes `vault:mcp_read` / `vault:mcp_write` and the `mcp` protected resource are
// registered in `app-registrations/registrations.ts` (`registerVaultMcpOAuth`); the kill switch is the
// agent one (`agentAccess.enabled`); the rate limit is the package's `AgentRateLimiter` (bucket `mcp`).
// When the platform slice ships, this folder becomes `McpModule.forRoot` and the package keeps only
// the tools (`registerMcpTool`).
// =============================================================================

import { ConfigService } from '@nestjs/config';
import type { VaultMcpOptions } from '@marinoscar/vault-api/mcp';

/** The factory binding of `VAULT_MCP_OPTIONS`. */
export const vaultMcpOptionsBinding = {
  useFactory: (config: ConfigService): VaultMcpOptions => ({ appUrl: config.get<string>('appUrl') }),
  inject: [ConfigService],
};
