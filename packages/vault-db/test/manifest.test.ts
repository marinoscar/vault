import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  VAULT_EXTENSIONS,
  VAULT_HOST_TABLES,
  VAULT_RAW_SQL_INDEXES,
  checkPackage,
  listPackageFragments,
  parseManifest,
  readInventories,
  readManifest,
  serializeManifest,
} from '../src/index.js';
import { PACKAGE_DIR } from './helpers.js';

const migrationsDir = join(PACKAGE_DIR, 'migrations');
const manifest = readManifest(migrationsDir);

describe('migrations/manifest.json', () => {
  it('records the sha256 of every migration.sql, comments included', () => {
    for (const entry of manifest.migrations) {
      const bytes = readFileSync(join(migrationsDir, entry.id, 'migration.sql'));
      expect(createHash('sha256').update(bytes).digest('hex'), entry.id).toBe(entry.sha256);
    }
  });

  it('has an entry for every migration directory and a directory for every entry', () => {
    const dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(manifest.migrations.map((entry) => entry.id)).toEqual(dirs);
  });

  it('lists the ids in ascending order, each with a known slice and host-table list', () => {
    const ids = manifest.migrations.map((entry) => entry.id);
    expect([...ids].sort()).toEqual(ids);
    const fragments = new Set(listPackageFragments(join(PACKAGE_DIR, 'schema')).map((name) => name.split('.')[1]));
    for (const entry of manifest.migrations) {
      expect(fragments.has(entry.slice), `${entry.id} slice ${entry.slice}`).toBe(true);
      for (const table of entry.requiresHostTables) expect(VAULT_HOST_TABLES).toContain(table);
    }
    expect(ids).toHaveLength(8);
    expect(new Set(manifest.migrations.map((entry) => entry.slice))).toEqual(new Set(['secrets', 'media', 'backups']));
  });

  it('derives requiresHostTables from the foreign keys in the SQL', () => {
    for (const entry of manifest.migrations) {
      const sql = readFileSync(join(migrationsDir, entry.id, 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
      const referenced = VAULT_HOST_TABLES.filter((table) => new RegExp(`REFERENCES\\s+"?${table}"?\\s*\\(`, 'i').test(sql));
      expect([...entry.requiresHostTables].sort(), entry.id).toEqual([...referenced].sort());
    }
  });

  it('is written in the canonical serialisation', () => {
    expect(serializeManifest(manifest)).toBe(readFileSync(join(migrationsDir, 'manifest.json'), 'utf8'));
  });

  it('refuses a malformed manifest', () => {
    expect(() => parseManifest('{"manifestVersion":2,"migrations":[]}')).toThrow(/manifestVersion/);
    expect(() => parseManifest('{"manifestVersion":1,"migrations":[{"id":"x","slice":"a","sha256":"0","requiresHostTables":[]}]}')).toThrow(/id/);
    const entry = { id: '20260101000000_a', slice: 'secrets', sha256: 'a'.repeat(64), requiresHostTables: ['orders'] };
    expect(() => parseManifest(JSON.stringify({ manifestVersion: 1, migrations: [entry] }))).toThrow(/requiresHostTables/);
  });
});

describe('inventories', () => {
  const inventories = readInventories(PACKAGE_DIR);

  it('exports the inventory files as constants', () => {
    expect(VAULT_RAW_SQL_INDEXES).toEqual(inventories.rawSqlIndexes);
    // Vault needs no PostgreSQL extension beyond what the platform already requires.
    expect(VAULT_EXTENSIONS).toEqual([]);
  });

  it('lists the one special index of the domain by name', () => {
    expect(VAULT_RAW_SQL_INDEXES.map((index) => index.name)).toEqual(['secret_versions_current_unique']);
    expect(VAULT_RAW_SQL_INDEXES[0]?.table).toBe('secret_versions');
  });

  it('declares no trigger, function, check constraint or generated column', () => {
    expect(inventories.schemaObjects).toEqual({ checkConstraints: [], functions: [], generatedColumns: [], triggers: [] });
  });

  it('is consistent with the migrations and the fragments (the package check)', () => {
    expect(checkPackage(PACKAGE_DIR)).toEqual([]);
  });
});
