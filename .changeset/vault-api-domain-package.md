---
"@marinoscar/vault-api": minor
---

New package: the Vault API domain (secrets, secret types, attachments, the export zip, backups, media, card extraction and the card-expiry reminders) as NestJS slices behind twelve ports, mounted with `VaultApiModule.forRoot({ bindings, imports })`; fakes for every port under `@marinoscar/vault-api/testing`.
