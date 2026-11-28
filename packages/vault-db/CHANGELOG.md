# @marinoscar/vault-db

## 0.1.0-next.8

### Minor Changes

- dccdf9f: Add `secrets.assistant_reveal` (boolean, default false) and `secrets.assistant_reveal_changed_at`: the owner's per-secret opt-in that lets an MCP client holding `vault:mcp_reveal` read the secret's field values (issue #244). Migration `20261128032220_add_secret_assistant_reveal`.
- 7e0f39e: Add the credential broker data (issue #246, ADR-0006): `secrets.broker_access`, `broker_origins`, `broker_injection`, `broker_field` and `broker_access_changed_at` (the owner's per-secret opt-in to use the key through the broker, never to read it) and the `broker_tokens` table (hashed `vbk_` tokens with an optional secret restriction, expiry, last use and revocation). Migration `20261128140804_add_credential_broker`.

## 0.1.0-next.7

## 0.1.0-next.6

## 0.1.0-next.5

## 0.1.0-next.4

### Minor Changes

- ffd128f: Agent release of payment cards and identity fields, with per-merchant rules (ADR-0003, #195).

  - `@marinoscar/vault-contract`: card and identity agent schemas (`agentCardFillRequestSchema`, `agentCardSummarySchema`, `agentCardGrantRequestCreateSchema`, `agentIdentityFillRequestSchema`, `agentIdentitySummarySchema`), the owner's merchant grant and grant request shapes (`createCardGrantSchema`, `cardGrantSchema`, `cardGrantRequestSchema`), amount and currency schemas and helpers, scopes `vault:cards_read|fill` and `vault:identity_read|fill`, new error codes, the `cards` and `identity` blocks of the `agentAccess` settings (both off by default) with `resolveAgentAccessSettings`, the `Identity` system secret type and the Card's optional `billing_postal_code`.
  - `@marinoscar/vault-db`: migration `add_agent_card_grants` (tables `agent_card_grants`, `agent_card_grant_requests`, `agent_card_releases`; column `secrets.agent_origins`).
  - `@marinoscar/vault-api`: `AgentReleasePort` / `AGENT_RELEASE_PORT` / `AgentReleaseService`, the in-process port an embedding host calls, shared with the HTTP controllers; `AgentCallPipeline`; card routes (`GET /api/agent/v1/cards`, `POST /cards/:id/fill`, `POST /cards/:id/grant-requests`) and identity routes (`GET /identity`, `POST /identity/:id/fill`) with merchant grants (registrable-domain match, payment frames, amount and currency, period limit, per-card daily cap, security code flag), their own rate-limit buckets and kill switches; the owner's grant routes under `/api/secrets/:id/card-grants` and `/card-grant-requests` (browser session only); a Card or Identity can be opened to agents (browser session only) and an Identity takes allowed origins; card notifications and activity; permissions `agent_cards:*` and `agent_identity:*`.
  - `@marinoscar/vault-web`: the card's Agent access panel (open or closed, merchant grants with limits and use, pending requests with Approve and Decline, the allow-a-shop form), the identity panel (open or closed, allowed websites), card and identity switches and limits on the Agent access settings page, and the new activity actions with amounts.

- 218483b: Make the packages embeddable in a host that is not Vault (issue #194; guide: `docs/EMBEDDING.md`). `@marinoscar/vault-api`: a new optional `VAULT_HOST` binding (`host: { appUrl }`) replaces the backup and card-expiry notifications' reads of `APP_URL`; `vaultPermissionDeclarations(roleMapping)` gives Vault's default grants to a host's own roles; `VAULT_RESERVED_NAMES` and `findVaultNameCollisions` list and check every route prefix, permission resource, settings namespace, job, notification, template, OAuth scope, audit prefix and OpenAPI tag the packages own; `VAULT_USER_OWNED_MODELS`, `VAULT_MODEL_OWNERSHIP`, `VAULT_CARDS_SETTINGS_DEFAULTS` and `VAULT_BACKUPS_SETTINGS_DEFAULTS` move into `core`; `seedVaultSystemSecretTypes` (`/secret-types`) seeds the built-in types; `runVaultHostConformance` (`/testing`) is the host conformance kit. `@marinoscar/vault-db`: `checkVaultInstall` no longer defaults `databaseUrl` to `process.env.DATABASE_URL` and `runVaultDb` requires its context (the `vault-db` command passes both, unchanged). `@marinoscar/vault-web`: `configureVaultWeb` takes `productName` (default `Vault`), shown by the pages' copy.

### Patch Changes

- e4ad39d: A stated and tested range of platform versions instead of one exact pre-release. `@marinoscar/vault-api` and `@marinoscar/vault-web` peer on `@marinoscar/platform-api`, `@marinoscar/platform-contract` and `@marinoscar/platform-web` `>=0.1.0-next.36 <=0.1.0-next.39`, the lowest and highest platform pre-release CI builds, typechecks and tests the packages against. `VaultApiModule.forRoot` now checks the installed `@marinoscar/platform-api` at boot and throws one error naming the installed and the supported versions when it is outside the range; `SUPPORTED_PLATFORM_RANGE`, `assertSupportedPlatform`, `readInstalledPlatformVersion`, `satisfiesRange` and `compareVersions` are exported from `@marinoscar/vault-api/core`. `@marinoscar/vault-db` adds `@marinoscar/platform-db` as a development dependency of its real-database test (no runtime change). Policy and compatibility table: docs/PACKAGES.md, "Platform compatibility".

## 0.1.0-next.3

### Patch Changes

- d16fe7b: The package READMEs say how to install from npm (the `next` dist-tag, the peers, provenance) for the first published release (#192). No code change.

## 0.1.0-next.2

### Minor Changes

- 60b975f: Add `secrets.agent_access` (enum `secret_agent_access`: `none` | `fill`, default `none`) and `secrets.agent_access_changed_at`.
- 9a5a86d: vault-db: `secrets.origins text[] NOT NULL DEFAULT '{}'` (website origins: scheme, host and port only, plaintext metadata) with the GIN index `secrets_origins_gin_idx` for `@>` and `&&` lookups (migration `add_secret_origins`).

## 0.1.0-next.1

## 0.1.0-next.0

- Initial version (E12.1, issue 102). Moved out of `apps/api` and `apps/web` without changing behaviour or a field; see the README.
