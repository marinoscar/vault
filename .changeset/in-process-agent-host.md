---
'@marinoscar/vault-api': patch
---

The agent notifications take their link base from the optional `VAULT_HOST` binding instead of `APP_URL`, so the built packages read no environment variable. `runVaultHostConformance` gains an optional `inProcessAgent` check that drives the login through `AGENT_RELEASE_PORT` in process and, given `readAuditEvents`, checks the `credential: 'embedded'` audit row (#194).
