# @marinoscar/vault-api

The NestJS side of the Vault domain behind ports: secrets (versions, attachments with refcount deletion, card summary, renew), secret types, the export zip, backups (archive, queue, runner, job handlers, schedule tick, notifier), media folders, card extraction over the platform AI slice, and the card-expiry reminders. CommonJS.

## Purpose and scope

The package is the domain; `apps/api` is a host that binds twelve ports and registers what is deployment-specific. Routes, permissions, wire shapes, job `type` strings, notification keys, audit actions and metric names are exactly what `apps/api` served before the move (ADR-0001, issue 103). It does not hold: the Prisma schema and migrations (`@marinoscar/vault-db`), the wire schemas and error codes (`@marinoscar/vault-contract`), the cipher implementation and key (the host's `CryptoService`), the notification registrations and email templates, the metric declarations, or the platform extension-point glue (Doctor checks, export source, onboarding facts, user-data purge); [docs/PACKAGES.md](../../docs/PACKAGES.md#vault-api-the-ports) lists why each stays.

Status: experimental. Introduced in E12.2.

Entry points:

- `@marinoscar/vault-api`: `VaultApiModule.forRoot({ bindings, imports })`, the port tokens and types.
- `@marinoscar/vault-api/ports`: the tokens and interfaces only.
- `@marinoscar/vault-api/core`: `VAULT_PERMISSIONS`, `ROLES`/`PERMISSIONS` constants, `runInDefaultOrg` / `defaultOrgClient`, the metric label lists, the notification event keys and payloads, `detectImageType`.
- `@marinoscar/vault-api/{secrets,secret-types,media,backups,ai,card-expiry}`: each slice's services, controllers, handlers and constants.
- `@marinoscar/vault-api/testing`: in-memory fakes of the ports and `createFakeBindings()`.

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

## The ports

| Token | Interface | Notes |
|---|---|---|
| `VAULT_PRISMA` | `VaultPrismaClient` | The host's `PrismaClient`; connects as the ordinary role, so org tables are read through `runInDefaultOrg` |
| `VAULT_CRYPTO` | `VaultCryptoPort` | AES-256-GCM under `VAULT_ENCRYPTION_KEY`; secret values exist only as ciphertext |
| `VAULT_OBJECT_STORE` | `VaultObjectStorePort` | The raw provider (no uploader-ownership check) |
| `VAULT_OBJECTS` | `VaultObjectsPort` | `delete`, `getDownloadUrl` with the ownership check (media) |
| `VAULT_JOBS` | `VaultJobsPort` | `enqueue`, `enqueueWithin`, `registerHandler`; job types are permanent |
| `VAULT_NOTIFY` | `VaultNotifyPort` | Called after the triggering write commits |
| `VAULT_AI`, `VAULT_AI_CONFIG` | `VaultAiPort`, `VaultAiConfigPort` | Server-side only; the CVV is never sent |
| `VAULT_AI_KEY_PRESENCE` | `VaultAiKeyPresencePort` | A describe, never the key |
| `VAULT_AUDIT` | `VaultAuditPort` | One `audit_events` row per call |
| `VAULT_SETTINGS` | `VaultSettingsPort` | `vaultCards`, `vaultBackups`, `ai` namespaces |
| `VAULT_METRICS` | `VaultMetricsPort` | Optional; enum labels only |

A token's description string (`@marinoscar/vault/<NAME>`) is permanent.

## Invariants the package keeps

Ciphertext only under the host key; exactly one current version per secret; attachments are version-scoped and a referenced object is never deleted (refcount); export endpoints return a raw zip with the `X-Vault-Export-*` headers; backup jobs are server-only (no `nodeResultSchema`, no `persistNodeResult`, the archive password only as ciphertext in the payload); `notify()` runs after the write commits; the card CVV is never sent to AI or persisted by extraction; domain reads of `storage_objects` run in the default organization's scope.

## Testing

`npm run test:run -w @marinoscar/vault-api` runs the domain specs (Jest, ts-jest) and `test/conformance.spec.ts`, which boots `VaultApiModule` over `createFakeBindings()`, pins the 45-route table, the three job types and their server-only shape, and checks that a missing required port fails the boot naming its token. The bound host is proven by `apps/api`'s integration, RBAC and real-database tiers.

## Extending

Add a port: a token and interface in `src/ports/`, a field in `VaultApiBindings`, a line in `TOKENS` of `vault-api.module.ts`, a fake in `src/testing/fake-ports.ts`, a check in `conformance.spec.ts`, and the binding in `apps/api/src/platform/vault-api/vault-api.config.ts`. Add a slice: a folder with an `index.ts`, an `exports` entry in `package.json`, its providers in `VaultApiModule`.
