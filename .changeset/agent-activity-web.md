---
'@marinoscar/vault-web': minor
---

Add the `agent` slice (`@marinoscar/vault-web/agent/headless` and `/agent/ui`): the per-user `AgentActivityPage` (what apps did with your logins, filterable, with a link to Connected apps) and the admin `AgentAccessSettingsPage` (the agent API's kill switch and per-minute limits). `SystemSettings` carries `agentAccess`.
