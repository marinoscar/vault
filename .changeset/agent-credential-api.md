---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

Add the agent credential API on the `agent` OAuth resource (`/api/agent/v1`, accepts `oat_` and `pat_` credentials): `GET /credentials?origin=`, `POST /credentials/:id/fill` (one field per call, exact origin only), `POST /credentials/:id/totp`, `POST /credentials` (with a CSPRNG-generated password returned once) and `POST /credentials/:id/password` (rotation as a new version). Kill switch `agentAccess.enabled` (default off) and per-minute limits in the `agentAccess` system settings namespace, an in-memory `AgentRateLimiter`, audit rows `agent.credential.lookup|fill|totp|create|rotate`, and `Cache-Control: no-store` on every response. New `@marinoscar/vault-contract/agent` subpath (experimental provider contract: request and response schemas, `AGENT_ERROR_CODES`, `AGENT_AUDIT_ACTIONS`, settings schema) and error codes `ORIGIN_MISMATCH`, `AGENT_ACCESS_DISABLED`, `AGENT_CREDENTIAL_REQUIRED` (403) and `RATE_LIMITED` (429).
