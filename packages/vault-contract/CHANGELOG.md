# @marinoscar/vault-contract

## 0.1.0-next.4

### Minor Changes

- ffd128f: Agent release of payment cards and identity fields, with per-merchant rules (ADR-0003, #195).

  - `@marinoscar/vault-contract`: card and identity agent schemas (`agentCardFillRequestSchema`, `agentCardSummarySchema`, `agentCardGrantRequestCreateSchema`, `agentIdentityFillRequestSchema`, `agentIdentitySummarySchema`), the owner's merchant grant and grant request shapes (`createCardGrantSchema`, `cardGrantSchema`, `cardGrantRequestSchema`), amount and currency schemas and helpers, scopes `vault:cards_read|fill` and `vault:identity_read|fill`, new error codes, the `cards` and `identity` blocks of the `agentAccess` settings (both off by default) with `resolveAgentAccessSettings`, the `Identity` system secret type and the Card's optional `billing_postal_code`.
  - `@marinoscar/vault-db`: migration `add_agent_card_grants` (tables `agent_card_grants`, `agent_card_grant_requests`, `agent_card_releases`; column `secrets.agent_origins`).
  - `@marinoscar/vault-api`: `AgentReleasePort` / `AGENT_RELEASE_PORT` / `AgentReleaseService`, the in-process port an embedding host calls, shared with the HTTP controllers; `AgentCallPipeline`; card routes (`GET /api/agent/v1/cards`, `POST /cards/:id/fill`, `POST /cards/:id/grant-requests`) and identity routes (`GET /identity`, `POST /identity/:id/fill`) with merchant grants (registrable-domain match, payment frames, amount and currency, period limit, per-card daily cap, security code flag), their own rate-limit buckets and kill switches; the owner's grant routes under `/api/secrets/:id/card-grants` and `/card-grant-requests` (browser session only); a Card or Identity can be opened to agents (browser session only) and an Identity takes allowed origins; card notifications and activity; permissions `agent_cards:*` and `agent_identity:*`.
  - `@marinoscar/vault-web`: the card's Agent access panel (open or closed, merchant grants with limits and use, pending requests with Approve and Decline, the allow-a-shop form), the identity panel (open or closed, allowed websites), card and identity switches and limits on the Agent access settings page, and the new activity actions with amounts.

- 80fa35b: The agent contract is beta, with a versioning promise and a conformance kit for agent runtimes (#196).

  - `@marinoscar/vault-contract`: `./agent` is `@stability beta`. `AGENT_CONTRACT_VERSION` (`1.2`), `AGENT_CONTRACT_FEATURES`, `agentContractInfoSchema`, `agentContractInfoFor`, and an optional `contract` block on `agentWhoamiResponseSchema`. New subpath `./agent-testing` (Node only, CommonJS and ESM): `createFakeVault` (an in-memory `/api/agent/v1` with exact origin binding, the identical 404, scopes, kill switches, rate limits with `Retry-After`, refresh-token rotation and replay revocation; invented data only; refuses `NODE_ENV=production`), the canary helpers `seedCanaries`, `createCanary`, `findCanaries`, `assertNoCanary`, the scenario list `AGENT_CONFORMANCE_SCENARIOS` with `runAgentConformance` / `assertAgentConformance`, `createConformanceSeed` and `createReferenceSignIn`. A shape snapshot test holds the promise: additive changes pass, breaking ones need `/api/agent/v2` and an `ACCEPT_BREAKING` changelog entry. `v1` stays for two minor releases after `v2` ships.
  - `@marinoscar/vault-api`: `GET /api/agent/v1/whoami` adds `contract: { version, features }` (`logins`, `totp`, and `cards` / `identity` while their switches are on); `AgentCredentialsService.contractInfo()`. Additive.

## 0.1.0-next.3

### Patch Changes

- d16fe7b: The package READMEs say how to install from npm (the `next` dist-tag, the peers, provenance) for the first published release (#192). No code change.

## 0.1.0-next.2

### Minor Changes

- 14f844c: Add the owner's agent trail and agent notifications (E14.7). `GET /api/agent-activity` (`secrets:read`, session or PAT; an OAuth token is refused with the new `403 AGENT_ACTIVITY_FORBIDDEN`) lists the caller's own agent events (`lookup`, `fill`, `totp`, `create`, `rotate` and the `agent_access` toggle), filterable by action, secret, app and date, paginated, never carrying a value. New `agentActivity*` schemas and `AGENT_ACTIVITY_PATH` in `@marinoscar/vault-contract/agent`. New notification events `vault.agent_credential_changed` (email + bell), `vault.agent_new_app` (email + bell) and `vault.agent_credential_used` (bell only, counted), raised by `AgentNotifier` after the audit row is written; `VaultNotifyPort` now includes `notifyCounted` and `RecordingNotify` records it.
- a9726a7: Add the agent credential API on the `agent` OAuth resource (`/api/agent/v1`, accepts `oat_` and `pat_` credentials): `GET /credentials?origin=`, `POST /credentials/:id/fill` (one field per call, exact origin only), `POST /credentials/:id/totp`, `POST /credentials` (with a CSPRNG-generated password returned once) and `POST /credentials/:id/password` (rotation as a new version). Kill switch `agentAccess.enabled` (default off) and per-minute limits in the `agentAccess` system settings namespace, an in-memory `AgentRateLimiter`, audit rows `agent.credential.lookup|fill|totp|create|rotate`, and `Cache-Control: no-store` on every response. New `@marinoscar/vault-contract/agent` subpath (experimental provider contract: request and response schemas, `AGENT_ERROR_CODES`, `AGENT_AUDIT_ACTIONS`, settings schema) and error codes `ORIGIN_MISMATCH`, `AGENT_ACCESS_DISABLED`, `AGENT_CREDENTIAL_REQUIRED` (403) and `RATE_LIMITED` (429).
- 60b975f: Add per-secret agent access: `PATCH /api/secrets/:id/agent-access` (`secrets:write`, refused for an OAuth credential, only a `Credential` may be `fill`, audited `secrets.agent_access.update`), the `agentAccess` list filter, `agentAccess` and `agentAccessChangedAt` on secret responses, the `AGENT_ACCESS_UNSUPPORTED_TYPE` (422) error code, and `SecretsService.findAgentAccessibleSecret` / `assertAgentAccessible` for the agent API.
- 9a5a86d: vault-contract: `Credential` gains the optional `additional_urls` field, and `normalizeOrigin`, `originsFromCredential`, `matchOrigin` and `registrableDomainOfOrigin` (exact or same-site matching via the Public Suffix List). vault-api: `secrets.origins` is recomputed on every new Credential version, `SecretsService.findCredentialsByOrigin(userId, origin)` and the server-only `vault.secrets.origins.backfill` job.
- d85c2f9: Add TOTP on Credential secrets: an optional sensitive `totp` field (Authenticator key) normalized on save to a canonical `otpauth://totp` URI (`parseTotpSecret`, `toCanonicalOtpauthUri`, `normalizeTotpSecret` in `@marinoscar/vault-contract/secrets`; an invalid value is a 400 field error), `generateTotp` (RFC 6238) and `POST /api/secrets/:id/totp` (`secrets:read`, `Cache-Control: no-store`, audited `secret.totp.read`, the seed is never returned), plus `SecretsService.generateTotpForSecret` and `hasTotp` for the agent API.

## 0.1.0-next.1

## 0.1.0-next.0

- Initial version (E12.1, issue 102). Moved out of `apps/api` and `apps/web` without changing behaviour or a field; see the README.
