/**
 * What the packaged Database Backup page takes from Vault (issue #89, E9.1, epic #64).
 *
 * `@marinoscar/platform-web/db-backup/ui` renders Console -> Operations -> Database Backup
 * (the policy, the run history and the restore dialog). The page is the platform's; what is
 * Vault's is handed in here, once, as a module constant:
 *
 *   - `DataTable`: the platform's responsive `DataTable` (the table the identity pages use),
 *     behind `React.lazy` so the grid stays out of the bundle every other route loads. The
 *     package declares its table props assignable to the table's own; the cast is the one the
 *     identity binding makes (`identity/LazyIdentityDataTable.tsx`) and `tsc` is the proof.
 *   - `api`: the db-backup calls over Vault's one platform HTTP client (`vaultPlatformApi`),
 *     built ONCE at module scope because the packaged hooks key on its identity.
 *
 * Mounted by `DbBackupSettingsPage` around the page only (the provider is cheap and no other
 * route reads it), inside the platform host.
 */

import { Suspense, lazy } from 'react';
import type { ReactElement } from 'react';
import { createDbBackupApi } from '@marinoscar/platform-web/db-backup/headless';
import type {
  DbBackupDataTableComponent,
  DbBackupDataTableProps,
  DbBackupWebAdapters,
} from '@marinoscar/platform-web/db-backup/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { vaultPlatformApi } from './platformHost';

const PlatformDataTable = lazy(() =>
  import('@marinoscar/platform-web/datatable/ui').then((m) => ({
    default: m.DataTable as unknown as DbBackupDataTableComponent,
  })),
);

function LazyDbBackupTable<Row>(props: DbBackupDataTableProps<Row>): ReactElement {
  const Table = PlatformDataTable as unknown as DbBackupDataTableComponent;
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Table {...(props as DbBackupDataTableProps<unknown>)} />
    </Suspense>
  );
}

export const LazyDbBackupDataTable = LazyDbBackupTable as DbBackupDataTableComponent;

export const appDbBackupAdapters: DbBackupWebAdapters = {
  DataTable: LazyDbBackupDataTable,
  api: createDbBackupApi(vaultPlatformApi),
};
