# ADR-0001: Packages first: domain code is written once in `@marinoscar/vault-*` and hosts only bind it

- Status: Accepted
- Date: 2026-11-02
- Related issues: epic #67 (E12), #102 (E12.1), #103 (E12.2), #104 (E12.3), #105 (E12.4); program epic #54

## Context

Vault is adopting the published `@marinoscar/platform-*` packages (epic #54). By the end of E11 the platform slices (identity, settings, storage, jobs, AI, notifications, db-backup, user-data, ...) come from packages and `apps/api` and `apps/web` hold bindings. What remains in `apps/` is the Vault domain: secrets, secret types, versions and attachments, the export zip, scheduled and personal backups, media folders, and card extraction.

Left in `apps/`, that domain can be used by exactly one host. A second host (a desktop edition, a worker, a CLI that validates the same shapes) would copy it, and two copies drift: every bug is fixed twice. KVox met the same question and answered it with a packages-first rule; this record adopts the same shape for Vault.

## Decision

All Vault domain behaviour lives once, in the `@marinoscar/vault-*` packages. A host contains only:

- port bindings (crypto, object store, jobs, notify, AI, audit, settings, metrics, the database: the twelve ports of `vault-api`, E12.2);
- the shell (navigation, settings hub, theme, routes, providers);
- packaging and deployment;
- host glue that has no meaning outside this deployment.

The packages and the order they are extracted in:

| Step | Issue | Package | Holds |
|---|---|---|---|
| E12.1 | #102 | `@marinoscar/vault-contract` | Zod wire schemas (requests, queries, response shapes), error codes, the system secret-type definitions, the backup content and schedule vocabulary |
| E12.1 | #102 | `@marinoscar/vault-db` | The domain Prisma fragments, the domain migrations, the raw-SQL index list and the `vault-db sync / check / promote` command |
| E12.2 | #103 | `@marinoscar/vault-api` | Secrets, secret types, attachments, the export zip, backups, media and card extraction, behind ports |
| E12.3 | #104 | `@marinoscar/vault-web` | Domain pages and components, destinations, the brand theme and mark |
| E12.4 | #105 | (release) | Changesets, CI and publishing under the `next` dist-tag |

Each step depends on the previous one: `vault-api` and `vault-web` import `vault-contract`; `vault-api` expects the tables of `vault-db`.

Rules:

1. A feature that belongs to the Vault domain is written in a package first, then mounted by the host.
2. A host never copies or forks slice code, schemas, error codes or migrations. If it needs different behaviour, that is an option or a port of the package.
3. `@marinoscar/vault-contract` has no framework, platform or Node dependency beyond `zod` (a peer). It holds shapes and pure rules, never behaviour that touches a database or a request.
4. `@marinoscar/vault-db` owns the domain's fragments and migrations. The app holds installed copies written by `vault-db sync` and proven by `prisma/vault.lock`. An installed migration is never edited or renamed. A package migration is never edited after it is published.
5. A platform gap is a seam request on EnterpriseAppBase, never a change to platform code and never a copy of it into a Vault package.
6. The API side moved in E12.2 and the web side in E12.3 (#104): `apps/web` holds no domain pages or components, they are `@marinoscar/vault-web`. The rule is in force for all four packages.

## Consequences

- A change to the domain is a package change first. The package is built and tested on its own, and the apps consume the built output (CI builds the packages before the app jobs).
- The wire contract has one definition. The API validates with the same schema the web types its requests with, and `apps/api` DTO classes are thin `createZodDto` wrappers that keep their old import paths.
- Domain migrations have two copies (the package and the app) and a lock. That is more ceremony than a single `prisma migrate dev`, in return for a host that can install the domain without the app.
- A new host needs the platform migrations first, then `vault-db sync --names stable`, because some package migrations were written before the platform baseline and touch platform tables (see the [runbook](../runbooks/vault-domain-migration.md#install-the-domain-into-a-new-host)).
- Package releases gate host features once the packages are published (E12.4). Until then they are workspace-linked and versioned together.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the domain in `apps/` and add a second host later | The copy happens under deadline pressure and drifts. Extracting is cheapest while there is one consumer. |
| One package for everything | Web would pull API code and the reverse. The contract and the database definition have different consumers and different release risk. |
| Keep migrations only in the app | A second host could not install the domain; the app would remain the only place the schema is defined. |
| Move the original (pre-baseline) migrations out of the app's history | Production databases recorded them by name and checksum in `_prisma_migrations`. They stay where they are, byte for byte; the package carries identical copies under the same names. |

## Enforcement

- `npm run db:check` runs `platform db check` and `vault-db check`: every installed fragment and migration is byte-identical to the package and to `prisma/vault.lock`; raw-SQL indexes are listed and merged into `platform.lock`.
- `npm run db:compose:check` fails when `prisma/schema/` differs from a fresh compose of the package fragments.
- The package tests (`npm run test:packages`) cover the manifest hashes, the raw-SQL index tripwire, `sync`, `check` and `promote` of `vault-db`, and the schemas, error codes and system types of `vault-contract`; CI builds and tests both packages.
- `apps/api/test/architecture/no-domain-logic.spec.ts` (E12.2, #103) fails when a moved domain folder, a controller, a `@Cron`, a deep import of `@marinoscar/vault-api` or an unlisted Prisma access to a domain table appears in `apps/api`. The package's `test/conformance.spec.ts` boots `VaultApiModule` over fake ports, pins the route table, the job types and their server-only shape. - `apps/web/src/__tests__/config/packagesFirst.test.ts` (E12.3, #104) fails when a domain page or component is redefined in `apps/web`, a domain folder (`hooks/`, `utils/`, `types/`, a domain component folder) comes back, a non-glue page appears under `pages/`, or the host reaches into the package's files instead of its public subpaths. `packages/vault-web/test/guards/packageBoundary.test.ts` guards the package side.
- Review item for any pull request: "no domain logic or wire schema is added to `apps/`".

## Related issues

Epic #67; #102 to #105; program epic #54.
