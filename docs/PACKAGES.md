# The `@marinoscar/vault-*` packages

Vault's domain code is written once, in packages, and the apps are hosts ([ADR-0001](decisions/0001-packages-first.md)). This page is the map: which packages exist, how they are laid out, built, tested and versioned. Each package README owns its own details.

## Contents

- [The packages](#the-packages)
- [Layout](#layout)
- [Build and test](#build-and-test)
- [How the apps consume them](#how-the-apps-consume-them)
- [Database: fragments, migrations and the lock](#database-fragments-migrations-and-the-lock)
- [Adding to a package](#adding-to-a-package)
- [CI](#ci)
- [Versioning plan](#versioning-plan)

## The packages

| Package | Folder | Status | Holds |
|---|---|---|---|
| `@marinoscar/vault-contract` | `packages/vault-contract` | in force (E12.1, #102) | Zod schemas, response shapes, error codes, system secret types. Dual CJS + ESM. [README](../packages/vault-contract/README.md) |
| `@marinoscar/vault-db` | `packages/vault-db` | in force (E12.1, #102) | Domain Prisma fragments, migrations, raw-SQL index list, the `vault-db` command. CommonJS. [README](../packages/vault-db/README.md) |
| `@marinoscar/vault-api` | `packages/vault-api` | in force (E12.2, #103) | Secrets, secret types, attachments, the export zip, backups, media, card extraction and card-expiry reminders behind twelve ports; `apps/api` binds the ports only. CommonJS. [README](../packages/vault-api/README.md) |
| `@marinoscar/vault-web` | `packages/vault-web` | in force (E12.3, #104) | Domain pages, components and hooks, the navigation destinations and the brand, one subpath per slice (`<slice>/headless`, `<slice>/ui`, `brand`, `navigation`). ESM. `apps/web` is the host; `apps/web/src/__tests__/config/packagesFirst.test.ts` guards it. [README](../packages/vault-web/README.md) |

The platform packages (`@marinoscar/platform-*`) are a separate set, owned by EnterpriseAppBase. A Vault package may depend on them as peers; it never copies them. `packages/shared` (`@app/shared`) is the product identity and is not a domain package.

## Layout

```
packages/vault-contract/
  src/index.ts            exports only VAULT_CONTRACT_PACKAGE
  src/<slice>/index.ts    secrets, secret-types, backups, media, errors, common
  test/*.test.ts          Vitest
  tsconfig.json           typecheck (src and test)
  tsconfig.build.json     shared build settings; tsconfig.cjs.json and tsconfig.esm.json extend it
packages/vault-db/
  schema/vault.<slice>.prisma     secrets, media, backups
  migrations/<id>/migration.sql   byte copies, with migrations/manifest.json
  raw-sql-indexes.json, extensions.json, schema-objects.json
  src/                    the command (bin, sync, check, promote, lock, manifest, sql)
  bin/vault-db.js         thin wrapper over dist/bin
  test/                   Vitest; apply.db.test.ts runs only with DATABASE_URL
packages/vault-api/
  src/ports/              the twelve port tokens and interfaces
  src/core/               permissions, role constants, default-org scope, metric labels, notification payloads, image signatures
  src/<slice>/            secrets, secret-types, media, backups, ai (card extraction), card-expiry: controllers, services, handlers, DTOs, specs
  src/vault-api.module.ts VaultApiModule.forRoot({ bindings, imports })
  src/testing/            in-memory fakes of the ports (published as ./testing)
  test/conformance.spec.ts, test/mocks/   the conformance run over fake ports; jest mocks for the specs
scripts/vault-packages/   copy-license.mjs (prepack), write-dist-stubs.mjs (contract build)
```

Rules that hold for every package:

- A relative import inside `vault-contract` keeps its `.js` extension (the ESM build needs it).
- `vault-contract` is built twice (`dist/cjs`, `dist/esm`), each with its own `package.json` stub so a `.d.ts` takes the right module format. `moduleResolution` is `node10` for the CJS tree because TypeScript 5 does not allow `bundler` with `module: commonjs`.
- `vault-db` is CommonJS and builds with `tsc -p tsconfig.build.json` to `dist/`.
- `vault-api` is CommonJS and builds with `tsc -p tsconfig.build.json` to `dist/`. Relative imports stay extensionless (NodeNext in a `"type": "commonjs"` package, like `apps/api`). It types against the Prisma client the host generates, so `@prisma/client` must be generated before it builds; Jest (v29, ts-jest) runs its specs.
- `dist/` is git-ignored. The root `package.json` workspaces glob `packages/*` picks a package up.

## Build and test

From the repository root:

```bash
npm run build:packages       # vault-contract (cjs + esm), vault-db, then prisma generate, then vault-api and vault-web
npm run typecheck:packages
npm run test:packages        # Vitest in each package
```

Per package: `npm run build|typecheck|test:run -w @marinoscar/vault-contract` (or `vault-db`, `vault-api`). `vault-api` needs the generated Prisma client (`npm run prisma:generate --workspace=api`) before `build` or `typecheck`; the root `build:packages` does it. The real-Postgres test of `vault-db` (`test/apply.db.test.ts`, which applies the platform history and then the domain history to a fresh database) runs when `DATABASE_URL` names a PostgreSQL 16 server whose role may create databases:

```bash
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/postgres npm run test:run -w @marinoscar/vault-db
```

## How the apps consume them

`apps/api` and `apps/web` list the packages as dependencies at the exact workspace version, so npm links them. They import the **built** output, so a fresh clone needs `npm ci` then `npm run build:packages` before the app's typecheck, tests or `prisma:seed` (the seed imports the system secret types from the contract). CI does this in every job that needs it.

What moved in E12.1, with the old import path kept as a thin re-export so the diff in callers is nil:

| Was | Now in | Old file |
|---|---|---|
| `dto/*.dto.ts` Zod schemas of secrets, secret types, media and backups | `vault-contract/{secrets,secret-types,media,backups}` | the DTO file keeps `createZodDto(schema)` and re-exports the schema |
| `secrets/export/backup-contents.ts` | `vault-contract/backups` | re-export |
| `BACKUP_FREQUENCIES`, `BACKUP_INTERVAL_HOURS`, `isValidTimeOfDay`, `isValidTimeZone` of `backups/backup-schedule.ts` | `vault-contract/backups` | `backup-schedule.ts` re-exports them and keeps the schedule math |
| `backups/dto/backup-responses.ts` wire interfaces | `vault-contract/backups` | `backup-responses.ts` re-exports them and keeps the row mapper |
| `AI_ERROR_CODES` and the error-code definitions | `vault-contract/errors` | `ai.constants.ts` re-exports; `app-registrations/error-codes.ts` registers the data |
| `prisma/system-secret-types.ts`, `CARD_NETWORKS`, `CARD_KINDS` | `vault-contract/secret-types` | re-export |
| `typeErrors` | `vault-contract/common` | `common/schemas/zod-messages.ts` re-exports |
| `AI_ERROR_CODES`, `AttachmentRole`, `BackupFrequency`, `BackupRunStatus`, `BackupRunTrigger` in `apps/web/src/types` | `vault-contract` | re-export |
| `prisma/fragments/vault.prisma`, `media-folder-files.prisma` | `vault-db/schema/vault.{secrets,media,backups}.prisma` | removed; `prisma/fragments/vault.*.prisma` are generated copies |
| the eight app-owned migrations | `vault-db/migrations/<same name>` | untouched in `prisma/migrations`, now also recorded in `prisma/vault.lock` |

What moved in E12.2 (no re-exports are left behind in `apps/api`; the callers import the package):

| Was in `apps/api/src` | Now in `packages/vault-api/src` |
|---|---|
| `secrets/` (service, controller, card summary, `export/`), `secret-types/`, `media/` | the same folder names, with `VaultApiModule` replacing the three Nest modules |
| `backups/` (archive, queue, runner, handlers, schedule task, notifier, controllers) | `backups/` |
| `ai/` card extraction (`card-extract.*`, normalizer, schema) | `ai/`; `ai-key-migration` and `ai-platform-migration` (one-off commands) stay |
| `card-expiry/` | `card-expiry/` |
| `prisma/default-org.ts`, `common/utils/image-signature.util.ts`, `common/constants/roles.constants.ts`, `app-registrations/permissions.ts` | `core/` |
| `notifications-registry/vault-notification-data.ts` (payloads and keys) | `core/notification-data.ts`; the registrations and templates stay |
| label lists and `secretTypeKind` of `common/otel/vault-metrics.ts` | `core/metric-labels.ts`; the instrument declarations stay |
| `common/constants/card.constants.ts` | deleted; callers import `@marinoscar/vault-contract/secret-types` |
| `test/mocks/card-extraction.mock.ts` | `packages/vault-api/test/mocks/` |

## `vault-api`: the ports

`apps/api` mounts the domain once, in `apps/api/src/platform/vault-api/vault-api.config.ts`: `VaultApiModule.forRoot({ bindings, imports })`. A token is `Symbol.for('@marinoscar/vault/<NAME>')`; the description string is permanent.

| Token | Port | Bound in apps/api to | Used by |
|---|---|---|---|
| `VAULT_PRISMA` | `VaultPrismaClient` (the host's generated `PrismaClient`) | `PrismaService` | every slice |
| `VAULT_CRYPTO` | `VaultCryptoPort` (`encrypt`, `decrypt`) | `CryptoService` (AES-256-GCM, `VAULT_ENCRYPTION_KEY`) | secrets, export, backups, card expiry |
| `VAULT_OBJECT_STORE` | `VaultObjectStorePort` (the raw provider) | `STORAGE_PROVIDER` | secrets, export, backups |
| `VAULT_OBJECTS` | `VaultObjectsPort` (`delete`, `getDownloadUrl`) | the platform `ObjectsService` | media |
| `VAULT_JOBS` | `VaultJobsPort` (`enqueue`, `enqueueWithin`, `registerHandler`) | `VaultJobsAdapter` over `JobsService` + `JobHandlerRegistry` | backups, card expiry |
| `VAULT_NOTIFY` | `VaultNotifyPort` (`notify`, `notifyNow`, `notifyPermissionHolders`) | the platform `NotificationsService` | backups, card expiry |
| `VAULT_AI` | `VaultAiPort` (`forUser`) | the platform `AiService` | card extraction |
| `VAULT_AI_CONFIG` | `VaultAiConfigPort` (`describePublic`) | the platform `AiConfigService` | the onboarding step "Scan a card" (`isCardScanAvailable`) |
| `VAULT_AI_KEY_PRESENCE` | `VaultAiKeyPresencePort` (`isConfigured`) | `AiKeyPresence` | backup archive `system/settings.json` |
| `VAULT_AUDIT` | `VaultAuditPort` (`record`) | `VaultAuditAdapter` over `audit_events` | secrets, secret types, export, backups, card expiry |
| `VAULT_SETTINGS` | `VaultSettingsPort` (`getNamespace`, `getSettings`) | `VaultSettingsAdapter` over `SystemSettingsService` | secrets, backups, card extraction |
| `VAULT_METRICS` (optional) | `VaultMetricsPort` | `VaultMetricsService` | secrets, backups, card extraction |

The package still imports the platform's decorators and pure helpers (`@Auth`, `CurrentUser`, `JobHandler` and `Job` types, `isActiveDedupConflict`, `enqueueHousekeepingJob`, `AiError`, `AiEnabledGuard`, `runInOrg`): those are types and request-path decorators, not services, so they are peers (`@marinoscar/platform-api`, `@marinoscar/platform-contract`) rather than ports. Every service the slices call goes through a port, which is what lets `src/testing` run the whole module over fakes.

Rules: a service takes a port, never a platform class or an app class; the host binds, it does not subclass. A port method is added with its fake in `src/testing/fake-ports.ts` and a line in `test/conformance.spec.ts`. `apps/api/src/platform/vault-api/vault-api.config.ts` carries a compile-time check that each platform class still satisfies the port it is bound to, so a platform release that changes a method fails the build of the host, not a request.

What stays in `apps/api` on purpose (host glue, listed in `apps/api/test/architecture/no-domain-logic.spec.ts` and [local-exceptions](platform-adoption/local-exceptions.md)): the Doctor checks, the `vault-secrets` export source, the onboarding facts, the user-data purge and factory-reset steps (each is a platform extension point that reads or purges domain rows), the notification registrations and email templates, the one-off AI migration commands, `CryptoService`, `PrismaService`, the metric declarations and the registrations.

## Database: fragments, migrations and the lock

`npm run db:compose` (in `apps/api`) runs `vault-db sync` and then `platform db compose`. `npm run db:check` runs `platform db check` and `vault-db check`.

`prisma/vault.lock` is the proof for the domain, the way `prisma/platform.lock` is for the platform:

```json
{
  "lockVersion": 1,
  "migrations": [
    { "installedDir": "20260403120000_add_secrets_and_versions",
      "originId": "vault:20260403120000_add_secrets_and_versions",
      "sha256": "..." }
  ],
  "vaultDbVersion": "0.1.0-next.0"
}
```

`vault-db check` verifies that every installed `migration.sql` hashes to its lock entry (comments count), that every generated fragment `prisma/fragments/vault.<slice>.prisma` equals the package file, that the package's own copies equal `migrations/manifest.json`, and that the raw-SQL index list in the package, in the migrations and in `platform.lock` `rawSqlIndexes` agree. Because every domain migration was already applied in production under its original name, the lock records original names; nothing was renamed and nothing was re-applied. The two platform-owned originals stay in `platform.lock`.

Procedure to change the domain schema: [runbooks/vault-domain-migration.md](runbooks/vault-domain-migration.md).

## Adding to a package

1. Put the code in the slice that owns it, with a test in the package.
2. A new subpath of `vault-contract` needs an `exports` entry in its `package.json` (both `import` and `require`).
3. If `apps/` already had the old definition, replace its body with a re-export so callers do not change, then delete the re-export when the last caller moves (E12.2 deleted the API ones; E12.3 does the web ones).
4. Run `npm run build:packages && npm run typecheck:packages && npm run test:packages`, then the app's typecheck and unit tests.

## CI

`.github/workflows/vault-packages.yml` (on every package, script or changeset change) builds the packages, runs `check:package-pack` (what npm would publish against each manifest), smoke-imports the entry points, runs `check:package-docs` (the README standard: required sections, `Status:` line, every entry point named, links resolve) and fails a package change without a changeset. `.github/workflows/ci.yml` builds the packages after `npm ci` in every job that imports them (order: contract, db, `prisma generate`, api; `npm run build:packages` does all four), and has a `Packages` job that generates the Prisma client, typechecks and tests the three packages, and runs the real-Postgres `vault-db` test against a service container. `db-check` and `baseline-rehearsal` run `db:check` (both locks) and `db:drift` as before.

## Versioning plan

All Vault packages are versioned together at `0.1.0-next.<n>`, starting at `0.1.0-next.0`. The apps pin the exact version, which npm resolves to the workspace while the version matches. Nothing is published yet.

Releases are Changesets in pre mode (`.changeset/`, the `fixed` glob `@marinoscar/vault-*`): `vault-release.yml` opens the `vault-release/version` pull request from pending changesets, and merging it runs a gate, then either publishes to npm under the `next` dist-tag (OIDC trusted publishing, provenance, no token; only when `NPM_PUBLISH_ENABLED` is `true`) or does a dry run that uploads the tarballs. The scripts under `scripts/vault-packages/` iterate over the packages present, so `vault-api` and `vault-web` join when their folders exist. Add a changeset (`npx changeset`) with every package change. Procedure, owner setup and rollback: [runbooks/release-vault-packages.md](runbooks/release-vault-packages.md).
