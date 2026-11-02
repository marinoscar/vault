import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { VAULT_LOCK_FILE, readVaultLock, sha256Hex } from '../lock/index.js';
import {
  VAULT_HOST_TABLES,
  vaultDbPackageRoot,
  listPackageFragments,
  readInventories,
  readManifest,
  serializeManifest,
  type VaultManifest,
} from '../manifest/index.js';
import { scanCreatedIndexes, scanTouchedTables, splitSqlStatements } from '../sql/index.js';
import { VaultSyncError, applyVaultSync, planVaultSync } from '../sync/index.js';

/**
 * Options of {@link promoteVaultMigration}.
 *
 * @stability experimental
 */
export interface VaultPromoteOptions {
  /** The host app folder: the one that holds `prisma/`. */
  root: string;
  /** The directory under `prisma/migrations` that `prisma migrate dev --create-only` made. */
  localDir: string;
  /** The slug of the package id: the id is the draft's timestamp plus `_<id>`. */
  id: string;
  /** The domain slice that owns the migration; a `schema/vault.<slice>.prisma` fragment must exist. */
  slice: string;
  /** The package folder to write into; defaults to the installed package (the monorepo copy). */
  packageDir?: string;
}

/**
 * What {@link promoteVaultMigration} did.
 *
 * @stability experimental
 */
export interface VaultPromoteResult {
  /** The new package migration id. */
  id: string;
  /** The directory it is installed as in the host (always the id). */
  installedDir: string;
  /** The host tables its foreign keys reference. */
  requiresHostTables: string[];
  /** Things to do by hand, such as listing a new raw-SQL index. */
  warnings: string[];
}

/** Table names the package's fragments declare (`@@map`, else the model name). */
function fragmentTables(schemaDir: string): Set<string> {
  const tables = new Set<string>();
  for (const name of listPackageFragments(schemaDir)) {
    const text = readFileSync(join(schemaDir, name), 'utf8');
    for (const block of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      tables.add(/@@map\(\s*"([^"]+)"\s*\)/.exec(block[2]!)?.[1] ?? block[1]!);
    }
  }
  return tables;
}

/**
 * Moves a migration authored in the app (with `prisma migrate dev --create-only`)
 * into the package: refuses one that touches a table the domain
 * does not own, copies it under `migrations/<id>/`, appends it to
 * `manifest.json`, then installs it into the app under its original name and
 * records it in `vault.lock`.
 *
 * The only thing a domain migration may do to a host table is declare a foreign
 * key to `users`, `storage_objects` or `jobs` (`REFERENCES`); any other
 * statement on a table that is neither in a domain fragment nor created by a
 * domain migration is refused.
 *
 * @param opts - See {@link VaultPromoteOptions}.
 * @returns The new id, its host-table requirements and what remains to do by hand.
 * @throws VaultSyncError when a rule is broken; the package and the app are left as they were.
 * @stability experimental
 */
export function promoteVaultMigration(opts: VaultPromoteOptions): VaultPromoteResult {
  const root = resolve(opts.root);
  const packageDir = resolve(opts.packageDir ?? vaultDbPackageRoot());
  const migrationsDir = join(packageDir, 'migrations');
  const schemaDir = join(packageDir, 'schema');
  const hostMigrations = join(root, 'prisma', 'migrations');

  if (!/^[a-z0-9][a-z0-9_]*$/.test(opts.id)) throw new VaultSyncError(`--id "${opts.id}" must be a lowercase snake_case slug`);
  if (!listPackageFragments(schemaDir).includes(`vault.${opts.slice}.prisma`)) {
    throw new VaultSyncError(`--slice "${opts.slice}" has no fragment schema/vault.${opts.slice}.prisma in the package`);
  }
  const stamp = /^(\d{14})_/.exec(opts.localDir)?.[1];
  const draft = join(hostMigrations, opts.localDir, 'migration.sql');
  if (stamp === undefined) throw new VaultSyncError(`${opts.localDir} is not a Prisma migration directory name (<14-digit timestamp>_<name>)`);
  if (!existsSync(draft)) throw new VaultSyncError(`${draft} does not exist`);

  const id = `${stamp}_${opts.id}`;
  const manifest = readManifest(migrationsDir);
  if (manifest.migrations.some((entry) => entry.id === id)) throw new VaultSyncError(`${id} is already in the package manifest`);
  const last = manifest.migrations[manifest.migrations.length - 1];
  if (last !== undefined && id <= last.id) {
    throw new VaultSyncError(`${id} sorts before the newest package migration ${last.id}; promoting it would reorder history. Re-create the draft with a newer timestamp`);
  }
  const lock = readVaultLock(join(root, 'prisma', VAULT_LOCK_FILE));
  if (lock?.migrations.some((entry) => entry.originId === `vault:${id}`)) throw new VaultSyncError(`vault:${id} is already installed`);

  const bytes = readFileSync(draft);
  const statements = splitSqlStatements(bytes.toString('utf8'));
  const owned = fragmentTables(schemaDir);
  for (const entry of manifest.migrations) {
    for (const table of scanTouchedTables(splitSqlStatements(readFileSync(join(migrationsDir, entry.id, 'migration.sql'), 'utf8'))).created) owned.add(table);
  }
  const touched = scanTouchedTables(statements);
  for (const table of touched.created) owned.add(table);
  const foreign = [...touched.targets].filter((table) => !owned.has(table));
  if (foreign.length > 0) {
    throw new VaultSyncError(
      `${opts.localDir} changes ${foreign.map((t) => `"${t}"`).join(', ')}, which the domain does not own; a domain migration may only reference ` +
        `${VAULT_HOST_TABLES.join(', ')} from a foreign key (ADD CONSTRAINT ... REFERENCES). Change a host table in the host, not here`,
    );
  }
  const badReferences = [...touched.references].filter((table) => !owned.has(table) && !(VAULT_HOST_TABLES as readonly string[]).includes(table));
  if (badReferences.length > 0) {
    throw new VaultSyncError(`${opts.localDir} has a foreign key to ${badReferences.map((t) => `"${t}"`).join(', ')}; only ${VAULT_HOST_TABLES.join(', ')} may be referenced`);
  }
  const requiresHostTables = VAULT_HOST_TABLES.filter((table) => touched.references.has(table));

  const warnings: string[] = [];
  const inventory = new Set(readInventories(packageDir).rawSqlIndexes.map((index) => index.name));
  for (const index of scanCreatedIndexes(statements)) {
    if ((index.partial || index.columns === null || index.method !== 'btree') && !inventory.has(index.name)) {
      warnings.push(
        `add ${index.name} (on ${index.table}) to raw-sql-indexes.json with its pg_indexes definition, then run vault-db sync again; vault-db check fails until it is listed`,
      );
    }
  }

  const packageFile = join(migrationsDir, id, 'migration.sql');
  const manifestFile = join(migrationsDir, 'manifest.json');
  const manifestBefore = readFileSync(manifestFile, 'utf8');
  const next: VaultManifest = {
    manifestVersion: 1,
    migrations: [...manifest.migrations, { id, slice: opts.slice, sha256: sha256Hex(bytes), requiresHostTables: [...requiresHostTables] }],
  };
  mkdirSync(dirname(packageFile), { recursive: true });
  writeFileSync(packageFile, bytes);
  writeFileSync(manifestFile, serializeManifest(next));
  try {
    const plan = planVaultSync({ root, packageDir, names: 'original' });
    applyVaultSync(plan);
    if (opts.localDir !== id) {
      // The draft was never applied (created with --create-only); the package id is the installed name.
      rmSync(join(hostMigrations, opts.localDir), { recursive: true, force: true });
    }
  } catch (error) {
    rmSync(dirname(packageFile), { recursive: true, force: true });
    writeFileSync(manifestFile, manifestBefore);
    throw error;
  }
  return { id, installedDir: id, requiresHostTables: [...requiresHostTables], warnings };
}
