---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

Add per-secret agent access: `PATCH /api/secrets/:id/agent-access` (`secrets:write`, refused for an OAuth credential, only a `Credential` may be `fill`, audited `secrets.agent_access.update`), the `agentAccess` list filter, `agentAccess` and `agentAccessChangedAt` on secret responses, the `AGENT_ACCESS_UNSUPPORTED_TYPE` (422) error code, and `SecretsService.findAgentAccessibleSecret` / `assertAgentAccessible` for the agent API.
