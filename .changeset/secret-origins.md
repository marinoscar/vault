---
"@marinoscar/vault-contract": minor
"@marinoscar/vault-api": minor
---

vault-contract: `Credential` gains the optional `additional_urls` field, and `normalizeOrigin`, `originsFromCredential`, `matchOrigin` and `registrableDomainOfOrigin` (exact or same-site matching via the Public Suffix List). vault-api: `secrets.origins` is recomputed on every new Credential version, `SecretsService.findCredentialsByOrigin(userId, origin)` and the server-only `vault.secrets.origins.backfill` job.
