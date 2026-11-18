---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

Add the owner's agent trail and agent notifications (E14.7). `GET /api/agent-activity` (`secrets:read`, session or PAT; an OAuth token is refused with the new `403 AGENT_ACTIVITY_FORBIDDEN`) lists the caller's own agent events (`lookup`, `fill`, `totp`, `create`, `rotate` and the `agent_access` toggle), filterable by action, secret, app and date, paginated, never carrying a value. New `agentActivity*` schemas and `AGENT_ACTIVITY_PATH` in `@marinoscar/vault-contract/agent`. New notification events `vault.agent_credential_changed` (email + bell), `vault.agent_new_app` (email + bell) and `vault.agent_credential_used` (bell only, counted), raised by `AgentNotifier` after the audit row is written; `VaultNotifyPort` now includes `notifyCounted` and `RecordingNotify` records it.
