---
"@marinoscar/vault-db": minor
---

vault-db: `secrets.origins text[] NOT NULL DEFAULT '{}'` (website origins: scheme, host and port only, plaintext metadata) with the GIN index `secrets_origins_gin_idx` for `@>` and `&&` lookups (migration `add_secret_origins`).
