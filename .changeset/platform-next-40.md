---
'@marinoscar/vault-api': patch
'@marinoscar/vault-web': patch
---

The supported `@marinoscar/platform-*` range now reaches `0.1.0-next.40`: `>=0.1.0-next.36 <=0.1.0-next.40`, in the peers of `vault-api` and `vault-web` and in `SUPPORTED_PLATFORM_RANGE` (#239). `next.40` adds one platform feature, the availability predicate on registered OAuth scopes, with no migration. Vault's own apps run on `next.40`, and the `Platform range` CI matrix tests both ends.
