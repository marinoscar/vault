---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

Add TOTP on Credential secrets: an optional sensitive `totp` field (Authenticator key) normalized on save to a canonical `otpauth://totp` URI (`parseTotpSecret`, `toCanonicalOtpauthUri`, `normalizeTotpSecret` in `@marinoscar/vault-contract/secrets`; an invalid value is a 400 field error), `generateTotp` (RFC 6238) and `POST /api/secrets/:id/totp` (`secrets:read`, `Cache-Control: no-store`, audited `secret.totp.read`, the seed is never returned), plus `SecretsService.generateTotpForSecret` and `hasTotp` for the agent API.
