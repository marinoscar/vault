---
"@marinoscar/vault-api": minor
"@marinoscar/vault-web": patch
---

vault-api: the `agent` OAuth protected resource (`/api/agent/v1`) with the scopes `vault:items_read`, `vault:items_fill` and `vault:items_write` (`registerVaultAgentOAuth`, `./agent` export), the `secrets:fill` permission and `GET /api/agent/v1/whoami`. vault-web: `/oauth/consent` and `/oauth/error` are unowned routes.
