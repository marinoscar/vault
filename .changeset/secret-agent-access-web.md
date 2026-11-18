---
'@marinoscar/vault-web': minor
---

Add per-secret agent access to the secrets UI: an "Allow agents to use this login" switch on the Credential detail page, an "Agents" chip in the list and an "Agent access" filter (`?agent=fill|none`). `SecretListItem` carries `agentAccess` and `agentAccessChangedAt`; new `updateSecretAgentAccess` client and `useSecretDetail().setAgentAccess`.
