# @marinoscar/vault-web

## 0.1.0-next.4

### Minor Changes

- ffd128f: Agent release of payment cards and identity fields, with per-merchant rules (ADR-0003, #195).

  - `@marinoscar/vault-contract`: card and identity agent schemas (`agentCardFillRequestSchema`, `agentCardSummarySchema`, `agentCardGrantRequestCreateSchema`, `agentIdentityFillRequestSchema`, `agentIdentitySummarySchema`), the owner's merchant grant and grant request shapes (`createCardGrantSchema`, `cardGrantSchema`, `cardGrantRequestSchema`), amount and currency schemas and helpers, scopes `vault:cards_read|fill` and `vault:identity_read|fill`, new error codes, the `cards` and `identity` blocks of the `agentAccess` settings (both off by default) with `resolveAgentAccessSettings`, the `Identity` system secret type and the Card's optional `billing_postal_code`.
  - `@marinoscar/vault-db`: migration `add_agent_card_grants` (tables `agent_card_grants`, `agent_card_grant_requests`, `agent_card_releases`; column `secrets.agent_origins`).
  - `@marinoscar/vault-api`: `AgentReleasePort` / `AGENT_RELEASE_PORT` / `AgentReleaseService`, the in-process port an embedding host calls, shared with the HTTP controllers; `AgentCallPipeline`; card routes (`GET /api/agent/v1/cards`, `POST /cards/:id/fill`, `POST /cards/:id/grant-requests`) and identity routes (`GET /identity`, `POST /identity/:id/fill`) with merchant grants (registrable-domain match, payment frames, amount and currency, period limit, per-card daily cap, security code flag), their own rate-limit buckets and kill switches; the owner's grant routes under `/api/secrets/:id/card-grants` and `/card-grant-requests` (browser session only); a Card or Identity can be opened to agents (browser session only) and an Identity takes allowed origins; card notifications and activity; permissions `agent_cards:*` and `agent_identity:*`.
  - `@marinoscar/vault-web`: the card's Agent access panel (open or closed, merchant grants with limits and use, pending requests with Approve and Decline, the allow-a-shop form), the identity panel (open or closed, allowed websites), card and identity switches and limits on the Agent access settings page, and the new activity actions with amounts.

- e4ad39d: A stated and tested range of platform versions instead of one exact pre-release. `@marinoscar/vault-api` and `@marinoscar/vault-web` peer on `@marinoscar/platform-api`, `@marinoscar/platform-contract` and `@marinoscar/platform-web` `>=0.1.0-next.36 <=0.1.0-next.39`, the lowest and highest platform pre-release CI builds, typechecks and tests the packages against. `VaultApiModule.forRoot` now checks the installed `@marinoscar/platform-api` at boot and throws one error naming the installed and the supported versions when it is outside the range; `SUPPORTED_PLATFORM_RANGE`, `assertSupportedPlatform`, `readInstalledPlatformVersion`, `satisfiesRange` and `compareVersions` are exported from `@marinoscar/vault-api/core`. `@marinoscar/vault-db` adds `@marinoscar/platform-db` as a development dependency of its real-database test (no runtime change). Policy and compatibility table: docs/PACKAGES.md, "Platform compatibility".
- 218483b: Make the packages embeddable in a host that is not Vault (issue #194; guide: `docs/EMBEDDING.md`). `@marinoscar/vault-api`: a new optional `VAULT_HOST` binding (`host: { appUrl }`) replaces the backup and card-expiry notifications' reads of `APP_URL`; `vaultPermissionDeclarations(roleMapping)` gives Vault's default grants to a host's own roles; `VAULT_RESERVED_NAMES` and `findVaultNameCollisions` list and check every route prefix, permission resource, settings namespace, job, notification, template, OAuth scope, audit prefix and OpenAPI tag the packages own; `VAULT_USER_OWNED_MODELS`, `VAULT_MODEL_OWNERSHIP`, `VAULT_CARDS_SETTINGS_DEFAULTS` and `VAULT_BACKUPS_SETTINGS_DEFAULTS` move into `core`; `seedVaultSystemSecretTypes` (`/secret-types`) seeds the built-in types; `runVaultHostConformance` (`/testing`) is the host conformance kit. `@marinoscar/vault-db`: `checkVaultInstall` no longer defaults `databaseUrl` to `process.env.DATABASE_URL` and `runVaultDb` requires its context (the `vault-db` command passes both, unchanged). `@marinoscar/vault-web`: `configureVaultWeb` takes `productName` (default `Vault`), shown by the pages' copy.

## 0.1.0-next.3

### Patch Changes

- d16fe7b: The package READMEs say how to install from npm (the `next` dist-tag, the peers, provenance) for the first published release (#192). No code change.

## 0.1.0-next.2

### Minor Changes

- 14f844c: Add the `agent` slice (`@marinoscar/vault-web/agent/headless` and `/agent/ui`): the per-user `AgentActivityPage` (what apps did with your logins, filterable, with a link to Connected apps) and the admin `AgentAccessSettingsPage` (the agent API's kill switch and per-minute limits). `SystemSettings` carries `agentAccess`.
- 60b975f: Add per-secret agent access to the secrets UI: an "Allow agents to use this login" switch on the Credential detail page, an "Agents" chip in the list and an "Agent access" filter (`?agent=fill|none`). `SecretListItem` carries `agentAccess` and `agentAccessChangedAt`; new `updateSecretAgentAccess` client and `useSecretDetail().setAgentAccess`.
- d85c2f9: Add authenticator codes (TOTP) to Credential secrets: the form validates a pasted `otpauth://` link or base32 key (and shows the API's field error), and the detail page has an "Authenticator code" card that fetches the code on demand (`POST /secrets/:id/totp`), shows it grouped with a countdown ring and a copy button, and refreshes it on expiry. New `getSecretTotp`, `useTotpCode`, `groupTotpCode`, `TotpCodeCard`, `TOTP_FIELD_NAME`, `fieldErrorsFromApiError`.
- 2318f0a: Card scanning availability now comes from the platform's `GET /api/ai/config` instead of the removed `GET /api/ai/status` alias. `useAiStatus` reads it through `useAiConfig` of `@marinoscar/platform-web/ai/headless` (the host's shared copy when one is mounted) and applies the new pure helper `isCardScanAvailable(config)`, the same rule as the API. Its result keeps `cardExtractEnabled`, `canUseAi`, `isLoading`, `error` and `refresh`; `status` is replaced by `config` (the platform's `AiPublicConfig`). Breaking: the exported `getAiStatus` and the `AiStatus` type are removed.

### Patch Changes

- 92dae83: vault-api: the `agent` OAuth protected resource (`/api/agent/v1`) with the scopes `vault:items_read`, `vault:items_fill` and `vault:items_write` (`registerVaultAgentOAuth`, `./agent` export), the `secrets:fill` permission and `GET /api/agent/v1/whoami`. vault-web: `/oauth/consent` and `/oauth/error` are unowned routes.
- 1934687: Require `@marinoscar/platform-api`, `@marinoscar/platform-contract` and `@marinoscar/platform-web` `0.1.0-next.37` (peer and dev dependencies). No API change in the Vault packages.
- 7bb426b: The Secrets list's table layout no longer expects a host `DataTablePreferencesProvider`: without one it takes the platform datatable's default port, the `dataTables` namespace of `/api/user-settings` over the host's client (#153). Docs and the test harness follow; no runtime change for a host that still mounts a provider.

## 0.1.0-next.1

### Minor Changes

- 1486f4f: Add `@marinoscar/vault-web`: the Vault domain pages, components, hooks, navigation destinations and brand, moved out of `apps/web` (E12.3, #104).

## 0.1.0-next.0

- Initial version (E12.3, issue 104). The domain pages, components and hooks, the navigation destinations and the brand moved out of `apps/web` without a visual or behaviour change; see the README.
