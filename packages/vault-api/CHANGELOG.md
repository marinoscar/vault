# @marinoscar/vault-api

## 0.1.0-next.3

### Patch Changes

- d16fe7b: The package READMEs say how to install from npm (the `next` dist-tag, the peers, provenance) for the first published release (#192). No code change.

## 0.1.0-next.2

### Minor Changes

- 14f844c: Add the owner's agent trail and agent notifications (E14.7). `GET /api/agent-activity` (`secrets:read`, session or PAT; an OAuth token is refused with the new `403 AGENT_ACTIVITY_FORBIDDEN`) lists the caller's own agent events (`lookup`, `fill`, `totp`, `create`, `rotate` and the `agent_access` toggle), filterable by action, secret, app and date, paginated, never carrying a value. New `agentActivity*` schemas and `AGENT_ACTIVITY_PATH` in `@marinoscar/vault-contract/agent`. New notification events `vault.agent_credential_changed` (email + bell), `vault.agent_new_app` (email + bell) and `vault.agent_credential_used` (bell only, counted), raised by `AgentNotifier` after the audit row is written; `VaultNotifyPort` now includes `notifyCounted` and `RecordingNotify` records it.
- a9726a7: Add the agent credential API on the `agent` OAuth resource (`/api/agent/v1`, accepts `oat_` and `pat_` credentials): `GET /credentials?origin=`, `POST /credentials/:id/fill` (one field per call, exact origin only), `POST /credentials/:id/totp`, `POST /credentials` (with a CSPRNG-generated password returned once) and `POST /credentials/:id/password` (rotation as a new version). Kill switch `agentAccess.enabled` (default off) and per-minute limits in the `agentAccess` system settings namespace, an in-memory `AgentRateLimiter`, audit rows `agent.credential.lookup|fill|totp|create|rotate`, and `Cache-Control: no-store` on every response. New `@marinoscar/vault-contract/agent` subpath (experimental provider contract: request and response schemas, `AGENT_ERROR_CODES`, `AGENT_AUDIT_ACTIONS`, settings schema) and error codes `ORIGIN_MISMATCH`, `AGENT_ACCESS_DISABLED`, `AGENT_CREDENTIAL_REQUIRED` (403) and `RATE_LIMITED` (429).
- 92dae83: vault-api: the `agent` OAuth protected resource (`/api/agent/v1`) with the scopes `vault:items_read`, `vault:items_fill` and `vault:items_write` (`registerVaultAgentOAuth`, `./agent` export), the `secrets:fill` permission and `GET /api/agent/v1/whoami`. vault-web: `/oauth/consent` and `/oauth/error` are unowned routes.
- 2e05dce: vault-api: the MCP server (`@marinoscar/vault-api/mcp`, `POST /api/mcp`) for chat assistants. The `mcp` OAuth protected resource with the scopes `vault:mcp_read` and `vault:mcp_write` (`registerVaultMcpOAuth`), the tools `search_secrets`, `get_secret`, `list_secret_types`, `create_secret` and `update_secret` (none returns a secret value), a local protocol layer (`mcp/protocol/`, a stop-gap for the platform MCP slice, marinoscar/EnterpriseAppBase#1201), the optional `VaultApiBindings.mcp` binding (`VAULT_MCP_OPTIONS`) and the `mcp.tool.call` audit action.
- 2318f0a: Remove the `GET /api/ai/status` compatibility route (`AiStatusController`); clients read the platform's `GET /api/ai/config`.
- 60b975f: Add per-secret agent access: `PATCH /api/secrets/:id/agent-access` (`secrets:write`, refused for an OAuth credential, only a `Credential` may be `fill`, audited `secrets.agent_access.update`), the `agentAccess` list filter, `agentAccess` and `agentAccessChangedAt` on secret responses, the `AGENT_ACCESS_UNSUPPORTED_TYPE` (422) error code, and `SecretsService.findAgentAccessibleSecret` / `assertAgentAccessible` for the agent API.
- 9a5a86d: vault-contract: `Credential` gains the optional `additional_urls` field, and `normalizeOrigin`, `originsFromCredential`, `matchOrigin` and `registrableDomainOfOrigin` (exact or same-site matching via the Public Suffix List). vault-api: `secrets.origins` is recomputed on every new Credential version, `SecretsService.findCredentialsByOrigin(userId, origin)` and the server-only `vault.secrets.origins.backfill` job.
- d85c2f9: Add TOTP on Credential secrets: an optional sensitive `totp` field (Authenticator key) normalized on save to a canonical `otpauth://totp` URI (`parseTotpSecret`, `toCanonicalOtpauthUri`, `normalizeTotpSecret` in `@marinoscar/vault-contract/secrets`; an invalid value is a 400 field error), `generateTotp` (RFC 6238) and `POST /api/secrets/:id/totp` (`secrets:read`, `Cache-Control: no-store`, audited `secret.totp.read`, the seed is never returned), plus `SecretsService.generateTotpForSecret` and `hasTotp` for the agent API.

### Patch Changes

- 1934687: Require `@marinoscar/platform-api`, `@marinoscar/platform-contract` and `@marinoscar/platform-web` `0.1.0-next.37` (peer and dev dependencies). No API change in the Vault packages.

## 0.1.0-next.1

### Minor Changes

- 8edda96: New package: the Vault API domain (secrets, secret types, attachments, the export zip, backups, media, card extraction and the card-expiry reminders) as NestJS slices behind twelve ports, mounted with `VaultApiModule.forRoot({ bindings, imports })`; fakes for every port under `@marinoscar/vault-api/testing`.

## 0.1.0-next.0

- Initial version (E12.2, issue 103). The API side of the Vault domain moved out of `apps/api/src` without changing a route, a permission, a job type, a notification key, an audit action or a metric name; see the README.
