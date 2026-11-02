/**
 * `@marinoscar/vault-db`: the domain Prisma fragments, migrations and the
 * `vault-db` command.
 *
 * @remarks
 * The package ships `schema/` (the domain fragments), `migrations/` (the domain
 * migrations with `manifest.json`), `raw-sql-indexes.json`, `extensions.json` and
 * `schema-objects.json`. The programmatic API below is what the `vault-db`
 * command runs: `planVaultSync` and `applyVaultSync` install them into a host,
 * `checkVaultInstall` proves the installed copies unchanged.
 *
 * @packageDocumentation
 */
export * from './bin/index.js';
export * from './check/index.js';
export * from './lock/index.js';
export * from './manifest/index.js';
export * from './promote/index.js';
export * from './sql/index.js';
export * from './sync/index.js';
