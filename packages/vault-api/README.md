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
| `@marinoscar/vault-api/core` | `VAULT_PERMISSIONS`, `ROLES`/`PERMISSIONS` constants, `runInDefaultOrg` / `defaultOrgClient`, the metric label lists, the notification event keys and payloads, `detectImageType` |
| `@marinoscar/vault-api/secrets` | Secrets and card-summary services, the secrets controller, the export zip service |
| `@marinoscar/vault-api/secret-types` | The secret-types service and controller |
| `@marinoscar/vault-api/media` | The media folders service and controller |
| `@marinoscar/vault-api/backups` | Archive, queue, runner, schedule tick, notifier, controllers and the two job handlers |
| `@marinoscar/vault-api/ai` | Card extraction service and controller, the AI status controller |
| `@marinoscar/vault-api/card-expiry` | The card-expiry scan job handler and its schedule task |
| `@marinoscar/vault-api/testing` | In-memory fakes of the ports and `createFakeBindings()` |

## Install and peer dependencies

```bash
npm install @marinoscar/vault-api@next
```

| Package | Range | Needed by |
|---|---|---|
| `@marinoscar/platform-api`, `@marinoscar/platform-contract` | `0.1.0-next.21` | decorators, guards and types (`@Auth`, `AiEnabledGuard`, `JobHandler`), `runInOrg` |
| `@marinoscar/vault-contract` | `0.1.0-next.0` | wire schemas, error codes, system secret types |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`, `@nestjs/schedule`, `@nestjs/swagger` | `^11` | the Nest providers and controllers |
| `@prisma/client`, `@prisma/client-runtime-utils` | `^7.8.0` | the host's generated client (the package types against it) |
| `nestjs-zod`, `zod`, `fastify`, `reflect-metadata`, `rxjs` | see `package.json` | DTOs and request types |

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
| `bindings` | yes | A `VaultApiBindings` object: one binding per port (`prisma`, `crypto`, `objectStore`, `objects`, `jobs`, `notify`, `ai`, `aiConfig`, `aiKeyPresence`, `audit`, `settings`; `metrics` is optional) |
| `imports` | no | Modules the bindings and the controllers' guards need (storage providers, the AI module that exports `AiEnabledGuard`, the credentials module) |

Each binding is one of `{ useClass }`, `{ useExisting }`, `{ useValue }` or `{ useFactory, inject }`. Eleven ports are required: a slice that finds its port missing fails at bootstrap naming the token, not on first use. `metrics` is the only optional port; a host without telemetry binds nothing and the slices emit nothing. The package reads no environment variable; the cipher key (`VAULT_ENCRYPTION_KEY`) belongs to the host's `VAULT_CRYPTO` binding.

## Extension-point catalog

The twelve ports are the extension points. A token's description string (`@marinoscar/vault/<NAME>`) is permanent.

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

`@marinoscar/vault-api/testing` ships fakes for them: `TestCrypto` (`VAULT_CRYPTO`), `InMemoryObjectStore` (`VAULT_OBJECT_STORE`), `RecordingJobs`, `RecordingNotify`, `InMemoryAudit` (and `auditOverPrisma(prisma)`), `FakeSettings`, `CountingMetrics`, and `createUnusablePrisma()`, which throws on any query. `createFakeBindings(overrides)` returns `{ bindings, ports }` for `forRoot`; its AI ports answer "not configured" and `objects` returns a signed-URL stub, so a test that needs a scripted model overrides `ai`.

To add a port: a token and interface in `src/ports/`, a field in `VaultApiBindings`, a line in `TOKENS` of `vault-api.module.ts`, a fake in `src/testing/fake-ports.ts`, a check in `conformance.spec.ts`, and the binding in `apps/api/src/platform/vault-api/vault-api.config.ts`. To add a slice: a folder with an `index.ts`, an `exports` entry in `package.json`, its providers in `VaultApiModule`.

## Security notes

- Secret values exist only as AES-256-GCM ciphertext, produced and read through the `VAULT_CRYPTO` port under the host's key; the package never holds the key or logs a plaintext value.
- The card CVV is never sent to AI and never persisted by extraction; AI calls run server-side through `VAULT_AI`, and keys never leave the server.
- Backup archive passwords are never logged and never stored in plaintext (only as ciphertext in the job payload).
- Export endpoints return a raw zip (not the `{ data }` envelope) with the `X-Vault-Export-*` headers.
- There is no `*:read_any` bypass by accident: a read of a foreign resource answers 404, not 403.
- AI and backup jobs are server-only: no `nodeResultSchema`, no `persistNodeResult`, so no credential is ever brokered to a worker node.
- Exactly one current version per secret; attachments are version-scoped and a referenced object is never deleted (refcount); `notify()` runs after the write commits; domain reads of `storage_objects` run in the default organization's scope.

## Testing

`npm run test:run -w @marinoscar/vault-api` runs the domain specs (Jest, ts-jest) and `test/conformance.spec.ts`, which boots `VaultApiModule` over `createFakeBindings()`, pins the 45-route table, the three job types and their server-only shape, and checks that a missing required port fails the boot naming its token. The bound host is proven by `apps/api`'s integration, RBAC and real-database tiers.

## Links

- [Package documentation standard](../../docs/PACKAGES.md#vault-api-the-ports)
- [ADR-0001: packages first](../../docs/decisions/0001-packages-first.md)
- [Local exceptions](../../docs/platform-adoption/local-exceptions.md)
- Sibling packages: [`@marinoscar/vault-contract`](../vault-contract/README.md), [`@marinoscar/vault-db`](../vault-db/README.md)
