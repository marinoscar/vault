---
'@marinoscar/vault-db': minor
---

Add `secrets.assistant_reveal` (boolean, default false) and `secrets.assistant_reveal_changed_at`: the owner's per-secret opt-in that lets an MCP client holding `vault:mcp_reveal` read the secret's field values (issue #244). Migration `20261128032220_add_secret_assistant_reveal`.
