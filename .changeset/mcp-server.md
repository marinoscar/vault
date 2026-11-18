---
"@marinoscar/vault-api": minor
---

vault-api: the MCP server (`@marinoscar/vault-api/mcp`, `POST /api/mcp`) for chat assistants. The `mcp` OAuth protected resource with the scopes `vault:mcp_read` and `vault:mcp_write` (`registerVaultMcpOAuth`), the tools `search_secrets`, `get_secret`, `list_secret_types`, `create_secret` and `update_secret` (none returns a secret value), a local protocol layer (`mcp/protocol/`, a stop-gap for the platform MCP slice, marinoscar/EnterpriseAppBase#1201), the optional `VaultApiBindings.mcp` binding (`VAULT_MCP_OPTIONS`) and the `mcp.tool.call` audit action.
