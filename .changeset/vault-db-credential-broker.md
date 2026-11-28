---
'@marinoscar/vault-db': minor
---

Add the credential broker data (issue #246, ADR-0006): `secrets.broker_access`, `broker_origins`, `broker_injection`, `broker_field` and `broker_access_changed_at` (the owner's per-secret opt-in to use the key through the broker, never to read it) and the `broker_tokens` table (hashed `vbk_` tokens with an optional secret restriction, expiry, last use and revocation). Migration `20261128140804_add_credential_broker`.
