---
"@marinoscar/vault-api": minor
"@marinoscar/vault-web": minor
"@marinoscar/vault-db": patch
---

A stated and tested range of platform versions instead of one exact pre-release. `@marinoscar/vault-api` and `@marinoscar/vault-web` peer on `@marinoscar/platform-api`, `@marinoscar/platform-contract` and `@marinoscar/platform-web` `>=0.1.0-next.36 <=0.1.0-next.39`, the lowest and highest platform pre-release CI builds, typechecks and tests the packages against. `VaultApiModule.forRoot` now checks the installed `@marinoscar/platform-api` at boot and throws one error naming the installed and the supported versions when it is outside the range; `SUPPORTED_PLATFORM_RANGE`, `assertSupportedPlatform`, `readInstalledPlatformVersion`, `satisfiesRange` and `compareVersions` are exported from `@marinoscar/vault-api/core`. `@marinoscar/vault-db` adds `@marinoscar/platform-db` as a development dependency of its real-database test (no runtime change). Policy and compatibility table: docs/PACKAGES.md, "Platform compatibility".
