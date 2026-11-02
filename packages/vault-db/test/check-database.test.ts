import { describe, expect, it } from 'vitest';

import { checkDatabaseCatalog, checkVaultInstall, readInventories, type DatabaseCatalog, type Inventories } from '../src/index.js';
import { PACKAGE_DIR, cleanup, freshHost } from './helpers.js';
import { afterEach } from 'vitest';

afterEach(cleanup);

const real = readInventories(PACKAGE_DIR);

/**
 * Vault's own inventories are nearly empty (one raw index, no extension), so the checks for the other
 * kinds of object run against a synthetic inventory. The logic is the package's, not the domain's.
 */
const inventories: Inventories = {
  rawSqlIndexes: [
    ...real.rawSqlIndexes,
    { name: 'probe_partial_uniq_idx', table: 'probe_rows', definition: 'CREATE UNIQUE INDEX probe_partial_uniq_idx ON public.probe_rows USING btree (owner_id) WHERE (active)' },
  ],
  extensions: [{ name: 'vector', minVersion: '0.5.0', requiredBy: ['probe'] }],
  schemaObjects: {
    checkConstraints: [{ name: 'probe_rows_positive_chk', table: 'probe_rows' }],
    functions: [{ name: 'probe_assert' }],
    generatedColumns: [{ table: 'probe_rows', column: 'search_vector' }],
    triggers: [{ name: 'probe_rows_trg', table: 'probe_rows', function: 'probe_assert' }],
  },
};

/** A catalog that has every object the inventories ask for. */
function completeCatalog(inv: Inventories = inventories): DatabaseCatalog {
  return {
    extensions: inv.extensions.map((extension) => ({ name: extension.name, version: '0.6.0' })),
    indexes: inv.rawSqlIndexes.map((index) => ({ name: index.name, table: index.table })),
    triggers: inv.schemaObjects.triggers.map((t) => ({ name: t.name, table: t.table })),
    functions: inv.schemaObjects.functions.map((f) => f.name),
    constraints: inv.schemaObjects.checkConstraints,
    generatedColumns: inv.schemaObjects.generatedColumns,
  };
}

describe('checkDatabaseCatalog', () => {
  it('accepts a complete catalog', () => {
    expect(checkDatabaseCatalog(completeCatalog(), inventories)).toEqual([]);
  });

  it('reports a missing extension with the statement a superuser must run', () => {
    const catalog = { ...completeCatalog(), extensions: [] };
    const problems = checkDatabaseCatalog(catalog, inventories);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('EXTENSION_MISSING');
    expect(problems[0]?.message).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
  });

  it('reports an extension older than minVersion', () => {
    const catalog = { ...completeCatalog(), extensions: [{ name: 'vector', version: '0.4.4' }] };
    expect(checkDatabaseCatalog(catalog, inventories).map((p) => p.code)).toEqual(['EXTENSION_TOO_OLD']);
    const exact = { ...completeCatalog(), extensions: [{ name: 'vector', version: '0.5.0' }] };
    expect(checkDatabaseCatalog(exact, inventories)).toEqual([]);
  });

  it('reports a dropped raw index, trigger, function, check and generated column', () => {
    const catalog = completeCatalog();
    catalog.indexes = catalog.indexes.filter((i) => i.name !== 'secret_versions_current_unique');
    catalog.triggers = [];
    catalog.functions = [];
    catalog.constraints = [];
    catalog.generatedColumns = [];
    expect(checkDatabaseCatalog(catalog, inventories).map((p) => p.code)).toEqual([
      'INDEX_MISSING',
      'GENERATED_COLUMN_MISSING',
      'CONSTRAINT_MISSING',
      'FUNCTION_MISSING',
      'TRIGGER_MISSING',
    ]);
  });

  it('names the real domain index when it is dropped', () => {
    const catalog = completeCatalog(real);
    expect(checkDatabaseCatalog(catalog, real)).toEqual([]);
    catalog.indexes = [];
    const problems = checkDatabaseCatalog(catalog, real);
    expect(problems.map((p) => p.code)).toEqual(['INDEX_MISSING']);
    expect(problems[0]?.message).toContain('secret_versions_current_unique');
  });

  it('is wired into checkVaultInstall with an injected catalog', async () => {
    const root = freshHost();
    const { applyVaultSync, planVaultSync } = await import('../src/index.js');
    applyVaultSync(planVaultSync({ root, platformSchemaDir: null }));
    const ok = await checkVaultInstall({ root, database: true, catalog: completeCatalog(real) });
    expect(ok.ok).toBe(true);
    const broken = completeCatalog(real);
    broken.indexes = [];
    expect((await checkVaultInstall({ root, database: true, catalog: broken })).problems.map((p) => p.code)).toEqual(['INDEX_MISSING']);
  });
});
