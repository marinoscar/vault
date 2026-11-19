# @marinoscar/vault-api

The NestJS side of the Vault domain behind ports: secrets (versions, attachments with refcount deletion, card summary, renew), secret types, the export zip, backups (archive, queue, runner, job handlers, schedule tick, notifier), media folders, card extraction over the platform AI slice, and the card-expiry reminders. CommonJS.

## Purpose and scope

The package is the domain; `apps/api` is a host that binds twelve ports and registers what is deployment-specific. Routes, permissions, wire shapes, job `type` strings, notification keys, audit actions and metric names are exactly what `apps/api` served before the move (ADR-0001, issue 103). It does not hold: the Prisma schema and migrations (`@marinoscar/vault-db`), the wire schemas and error codes (`@marinoscar/vault-contract`), the cipher implementation and key (the host's `CryptoService`), the notification registrations and email templates, the metric declarations, or the platform extension-point glue (Doctor checks, export source, onboarding facts, user-data purge); [docs/PACKAGES.md](../../docs/PACKAGES.md#vault-api-the-ports) lists why each stays.

Status: experimental. Introduced in E12.2.

## Entry points

| Specifier | Exports |
|---|---|
| `@marinoscar/vault-api` | `VaultApiModule.forRoot({ bindings, imports })`, the port tokens and types |
| `@marinoscar/vault-api/ports` | The tokens and interfaces only |
| `@marinoscar/vault-api/core` | `VAULT_PERMISSIONS`, `vaultPermissionDeclarations(roleMapping)` (Vault's default grants on a host's own roles), `ROLES`/`PERMISSIONS` constants, `runInDefaultOrg` / `defaultOrgClient`, the metric label lists, the notification event keys and payloads, `detectImageType`, `VAULT_RESERVED_NAMES` and `findVaultNameCollisions(hostNames)` (every name the packages own in a host), `VAULT_CARDS_SETTINGS_DEFAULTS` / `VAULT_BACKUPS_SETTINGS_DEFAULTS` |
| `@marinoscar/vault-api/secrets` | Secrets and card-summary services, the secrets controller, the export zip service |
| `@marinoscar/vault-api/secret-types` | The secret-types service and controller, `seedVaultSystemSecretTypes(prisma)` (the built-in types, for a host's seed) |
| `@marinoscar/vault-api/media` | The media folders service and controller |
| `@marinoscar/vault-api/backups` | Archive, queue, runner, schedule tick, notifier, controllers and the two job handlers |
| `@marinoscar/vault-api/ai` | Card extraction service and controller, the AI status controller; the scan-profile registry (`ScanProfileRegistry`, `DocumentScanService`, `ScanProfile`, `ScanCropBox`, experimental) |
| `@marinoscar/vault-api/card-expiry` | The card-expiry scan job handler and its schedule task |
| `@marinoscar/vault-api/agent` | `registerVaultAgentOAuth()` (the OAuth scopes `vault:items_read`, `vault:items_fill`, `vault:items_write` and the `agent` protected resource at `/api/agent/v1`; the host calls it once from `app-registrations/`), the scope and resource constants, and the agent credential API (E14.6): `AgentController` (`whoami` with its `contract { version, features }` block since #196, `GET /credentials?origin=`, `POST /credentials/:id/fill`, `.../totp`, `POST /credentials`, `POST /credentials/:id/password`; `oat_` and `pat_` only; mounted by `VaultApiModule`), `AgentCredentialsService` (the pipeline: credential kind, kill switch, rate limit, work, audit), `AgentRateLimiter` and `InMemoryAgentRateLimiter` (a DI token; the in-memory fixed window suits one API instance, override the provider to share counters), `AgentNoStoreInterceptor` and `generatePassword`. The host registers the `agentAccess` system settings namespace (switch default off, per-minute limits) from `AGENT_ACCESS_SETTINGS_DEFAULTS` of the contract; the wire contract is `@marinoscar/vault-contract/agent`. **Cards and identity (ADR-0003):** `AgentReleasePort` (the in-process port: `lookup`, `fill`, `totp`, `cardsLookup`, `cardFill`, `cardGrantRequest`, `identityLookup`, `identityFill`, each taking `{ userId, clientLabel, ... }`), its token `AGENT_RELEASE_PORT` and its one implementation `AgentReleaseService` (exported by `VaultApiModule`; the HTTP controllers call it too), `AgentCallPipeline` (the shared pipeline: caller kind, `agentAccess.enabled` and the `cards` / `identity` switches, the `card_fill` and `identity_fill` buckets, audit), `AgentCardsService`, `AgentIdentityService`, `AgentCardsController` (`GET /cards`, `POST /cards/:id/fill`, `POST /cards/:id/grant-requests`, `GET /identity`, `POST /identity/:id/fill`), the owner's `CardGrantsService` and `CardGrantsController` (`/api/secrets/:id/card-grants`, `/card-grant-requests`; browser session only, `requireOwnerSession`), and `CardGrantStore` (a DI token; `PrismaCardGrantStore` by default, `InMemoryCardGrantStore` in `@marinoscar/vault-api/testing`) |
| `@marinoscar/vault-api/mcp` | The MCP server (E14.8): `McpController` (`POST /api/mcp`; `GET` and `DELETE` are 405; raw JSON-RPC, not `{ data }`), `McpDispatcher` (methods, the `tools/call` pipeline: scope step-up, kill switch, rate limit, validation, fail-closed redaction, audit `mcp.tool.call`), `McpSecretsService` and the five tools (`search_secrets`, `get_secret`, `list_secret_types`, `create_secret`, `update_secret`; none returns a secret value), `registerVaultMcpOAuth()` (the scopes `vault:mcp_read` and `vault:mcp_write` and the `mcp` protected resource at `/api/mcp`; the host calls it once from `app-registrations/`), `VAULT_MCP_OPTIONS`, and the local protocol layer `mcp/protocol/` (`McpToolRegistry`, version negotiation, the Origin rule, `assertNoSensitiveValues`), a stop-gap for the platform MCP slice (marinoscar/EnterpriseAppBase#1201; [local exceptions](../../docs/platform-adoption/local-exceptions.md)) |
| `@marinoscar/vault-api/testing` | In-memory fakes of the ports and `createFakeBindings()`; `runVaultHostConformance(options)`, the host conformance kit ([docs/EMBEDDING.md](../../docs/EMBEDDING.md#the-host-conformance-kit)) |

## Install and peer dependencies

```bash
npm install @marinoscar/vault-api@next @marinoscar/vault-contract@next
```

Published to npm under the `next` dist-tag until 1.0, with a provenance attestation; the install, the dist-tag policy and the current publication status are in [docs/PACKAGES.md](../../docs/PACKAGES.md#installing-from-npm). npm 7 or later installs the peers below by itself; list them in the host's `package.json` to choose their versions (the host normally has them already). The package is CommonJS; an ESM host imports it as usual.

| Package | Range | Needed by |
|---|---|---|
| `@marinoscar/platform-api`, `@marinoscar/platform-contract` | `>=0.1.0-next.36 <=0.1.0-next.39`, the tested range in `peerDependencies` ([PACKAGES.md](../../docs/PACKAGES.md#platform-compatibility)) | decorators, guards and types (`@Auth`, `AiEnabledGuard`, `JobHandler`), `runInOrg` |
| `@marinoscar/vault-contract` | `>=0.0.0-0 \|\| >=0.1.0-0` (install the same version as `vault-api`) | wire schemas, error codes, system secret types |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`, `@nestjs/schedule`, `@nestjs/swagger` | `^11` | the Nest providers and controllers |
| `@prisma/client`, `@prisma/client-runtime-utils` | `^7.8.0` | the host's generated client (the package types against it) |
| `nestjs-zod`, `zod`, `fastify`, `reflect-metadata`, `rxjs` | see `package.json` | DTOs and request types |

The platform range is the one CI tested at both ends ([PACKAGES.md, Platform compatibility](../../docs/PACKAGES.md#platform-compatibility)). `VaultApiModule.forRoot` checks the installed `@marinoscar/platform-api` against it at boot and throws one error naming the installed and the supported versions when it is outside; `SUPPORTED_PLATFORM_RANGE` and `assertSupportedPlatform` are exported from `@marinoscar/vault-api/core`.

`@zip.js/zip.js` is a dependency (the export zip). The host generates the Prisma client from the platform fragments plus `@marinoscar/vault-db`; build order is contract, db, `prisma generate`, api.

## Quick start

```ts
// apps/api/src/platform/vault-api/vault-api.config.ts
import { VaultApiModule } from '@marinoscar/vault-api';

export const vaultApiModule = VaultApiModule.forRoot({
  imports: [/* modules that provide what the bindings read */],
  bindings: {
    prisma: { useExisting: PrismaService },
    crypto: { useExisting: CryptoService },
    objectStore: { useExisting: STORAGE_PROVIDER },
    objects: { useExisting: ObjectsService },
    jobs: { useExisting: VaultJobsAdapter },
    notify: { useExisting: NotificationsService },
    ai: { useExisting: AiService },
    aiConfig: { useExisting: AiConfigService },
    aiKeyPresence: { useExisting: AiKeyPresence },
    audit: { useExisting: VaultAuditAdapter },
    settings: { useExisting: VaultSettingsAdapter },
    metrics: { useExisting: VaultMetricsService }, // optional
  },
});
```

## Configuration

`VaultApiModule.forRoot(options)` takes two options.

| Option | Required | Meaning |
|---|---|---|
| `bindings` | yes | A `VaultApiBindings` object: one binding per port (`prisma`, `crypto`, `objectStore`, `objects`, `jobs`, `notify`, `ai`, `aiConfig`, `aiKeyPresence`, `audit`, `settings`; `metrics`, `mcp` and `host` are optional) |
| `imports` | no | Modules the bindings and the controllers' guards need (storage providers, the AI module that exports `AiEnabledGuard`, the credentials module) |

Each binding is one of `{ useClass }`, `{ useExisting }`, `{ useValue }` or `{ useFactory, inject }`. Eleven ports are required: a slice that finds its port missing fails at bootstrap naming the token, not on first use. `metrics`, `mcp` and `host` are the optional ports; `host` is `{ appUrl }` (`VaultHostConfig`: the base URL of the notification links; without it a payload carries no `appUrl`); `mcp` is `{ appUrl, allowedOrigins?, ratePerMinute? }` (`VaultMcpOptions`: `appUrl` is `APP_URL`, the one origin the MCP Origin rule admits; without it every request that carries an `Origin` is refused). A host without telemetry binds no `metrics` and the slices emit nothing. The package reads no environment variable; the cipher key (`VAULT_ENCRYPTION_KEY`) belongs to the host's `VAULT_CRYPTO` binding.

## Extension-point catalog

The twelve ports, one optional options token and the MCP tool registry are the extension points. A token's description string (`@marinoscar/vault/<NAME>`) is permanent.

| Token | Interface | Binding key | Notes |
|---|---|---|---|
| `VAULT_PRISMA` | `VaultPrismaClient` | `prisma` | The host's `PrismaClient`; connects as the ordinary role, so org tables are read through `runInDefaultOrg` |
| `VAULT_CRYPTO` | `VaultCryptoPort` | `crypto` | AES-256-GCM under `VAULT_ENCRYPTION_KEY`; secret values exist only as ciphertext |
| `VAULT_OBJECT_STORE` | `VaultObjectStorePort` | `objectStore` | The raw provider (no uploader-ownership check) |
| `VAULT_OBJECTS` | `VaultObjectsPort` | `objects` | `delete`, `getDownloadUrl` with the ownership check (media) |
| `VAULT_JOBS` | `VaultJobsPort` | `jobs` | `enqueue`, `enqueueWithin`, `registerHandler`; job types are permanent |
| `VAULT_NOTIFY` | `VaultNotifyPort` | `notify` | Called after the triggering write commits |
| `VAULT_AI` | `VaultAiPort` | `ai` | Server-side only; the CVV is never sent |
| `VAULT_AI_CONFIG` | `VaultAiConfigPort` | `aiConfig` | The public AI configuration |
| `VAULT_AI_KEY_PRESENCE` | `VaultAiKeyPresencePort` | `aiKeyPresence` | A describe, never the key |
| `VAULT_AUDIT` | `VaultAuditPort` | `audit` | One `audit_events` row per call |
| `VAULT_SETTINGS` | `VaultSettingsPort` | `settings` | `vaultCards`, `vaultBackups`, `ai` namespaces |
| `VAULT_METRICS` | `VaultMetricsPort` | `metrics` | Optional; enum labels only |
| `VAULT_HOST` | `VaultHostConfig` | `host` | Optional; the host's public base URL for notification links (the package reads no `APP_URL`) |
| `VAULT_MCP_OPTIONS` | `VaultMcpOptions` | `mcp` | Optional; the app URL for the MCP Origin rule, extra allowed origins, the per-minute `tools/call` limit (default 60) |
| `McpToolRegistry` | `McpToolDefinition` | none (a provider) | `register(tool)` refuses a tool without a title, a `vault:<name>` scope, a permission and an effect (`read` or `write`); the five Vault tools register at start-up. The platform slice's `registerMcpTool` replaces it |

`@marinoscar/vault-api/testing` ships fakes for them: `TestCrypto` (`VAULT_CRYPTO`), `InMemoryObjectStore` (`VAULT_OBJECT_STORE`), `RecordingJobs`, `RecordingNotify`, `InMemoryAudit` (and `auditOverPrisma(prisma)`), `FakeSettings`, `CountingMetrics`, and `createUnusablePrisma()`, which throws on any query. `createFakeBindings(overrides)` returns `{ bindings, ports }` for `forRoot`; its AI ports answer "not configured" and `objects` returns a signed-URL stub, so a test that needs a scripted model overrides `ai`.

To add a port: a token and interface in `src/ports/`, a field in `VaultApiBindings`, a line in `TOKENS` of `vault-api.module.ts`, a fake in `src/testing/fake-ports.ts`, a check in `conformance.spec.ts`, and the binding in `apps/api/src/platform/vault-api/vault-api.config.ts`. To add a slice: a folder with an `index.ts`, an `exports` entry in `package.json`, its providers in `VaultApiModule`.

## Security notes

- Secret values exist only as AES-256-GCM ciphertext, produced and read through the `VAULT_CRYPTO` port under the host's key; the package never holds the key or logs a plaintext value.
- The card CVV is never sent to AI and never persisted by extraction; AI calls run server-side through `VAULT_AI`, and keys never leave the server.
- Backup archive passwords are never logged and never stored in plaintext (only as ciphertext in the job payload).
- Export endpoints return a raw zip (not the `{ data }` envelope) with the `X-Vault-Export-*` headers.
- There is no `*:read_any` bypass by accident: a foreign secret's content is never returned (the session routes answer 403, the agent API and MCP 404).
- AI and backup jobs are server-only: no `nodeResultSchema`, no `persistNodeResult`, so no credential is ever brokered to a worker node.
- The MCP tools never return a secret value: results are built from an allow-list of non-sensitive fields (sensitive fields read `"[hidden]"`), every sensitive value a tool sees is checked against the result and a leak withholds it (`REDACTION_BLOCKED`), a generated password is stored and not returned, card types are not handled, `url` and `additional_urls` cannot be changed, and only secrets opened to agents (`agentAccess = fill`) are visible. A scope or permission refusal is an HTTP 403, never a 200 result.
- Exactly one current version per secret; attachments are version-scoped and a referenced object is never deleted (refcount); `notify()` runs after the write commits; domain reads of `storage_objects` run in the default organization's scope.

## Testing

`npm run test:run -w @marinoscar/vault-api` runs the domain specs (Jest, ts-jest) and `test/conformance.spec.ts`, which boots `VaultApiModule` over `createFakeBindings()`, pins the 56-route table, the three job types and their server-only shape, and checks that a missing required port fails the boot naming its token. `test/host-embedding.spec.ts` derives every route, permission, settings namespace, job type, notification key, template, OAuth scope, audit action and OpenAPI tag from the code and checks it against `VAULT_RESERVED_NAMES`, and covers the role mapping and the `VAULT_HOST` binding; `test/no-env.spec.ts` greps the built output of the four packages for `process.env`. The bound host is proven by `apps/api`'s integration, RBAC and real-database tiers, and a host that is not Vault by `tests/second-host/`, which runs `runVaultHostConformance` against a real PostgreSQL in CI.

## Links

- [Package documentation standard](../../docs/PACKAGES.md#vault-api-the-ports)
- [ADR-0001: packages first](../../docs/decisions/0001-packages-first.md)
- [Embedding the Vault packages in another host](../../docs/EMBEDDING.md)
- [Local exceptions](../../docs/platform-adoption/local-exceptions.md)
- Sibling packages: [`@marinoscar/vault-contract`](../vault-contract/README.md), [`@marinoscar/vault-db`](../vault-db/README.md)
