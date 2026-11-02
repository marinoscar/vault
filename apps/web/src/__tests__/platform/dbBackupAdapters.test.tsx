/**
 * Vault's binding of the packaged Database Backup page (issue #89, E9.1).
 *
 * The page's own behaviour (policy form, run history, restore dialog) is proved by
 * `@marinoscar/platform-web`'s suite, and that it mounts behind `db_backup:read` and calls
 * `/api/admin/db-backup/config` through Vault's client with the bearer token is proved in
 * `SettingsRoutes.test.tsx`. This covers Vault's adapters only: the lazy platform table, and
 * one client built once (the packaged hooks key on its identity).
 */

import { describe, it, expect } from 'vitest';

import { appDbBackupAdapters, LazyDbBackupDataTable } from '../../platform/dbBackupAdapters';

describe('the Database Backup adapters', () => {
  it('hand the package the lazy platform table', () => {
    expect(appDbBackupAdapters.DataTable).toBe(LazyDbBackupDataTable);
  });

  it('hand the package one client of their own, stable across reads', () => {
    expect(appDbBackupAdapters.api).toBeDefined();
    expect(appDbBackupAdapters.api).toBe(appDbBackupAdapters.api);
  });
});
