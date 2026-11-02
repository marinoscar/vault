/**
 * The platform's `DataTable` (`@marinoscar/platform-web/datatable/ui`, built on
 * MUI X DataGrid) behind `React.lazy`, as the identity pages' table adapter.
 * The grid is only drawn by the Users & Allowlist and Access Tokens pages;
 * loading it on demand keeps it out of the bundle every other route loads.
 * The props pass through untouched (the package declares its
 * `IdentityDataTableProps` assignable to the table's own).
 */

import { Suspense, lazy } from 'react';
import type { ReactElement } from 'react';
import type {
  IdentityDataTableComponent,
  IdentityDataTableProps,
} from '@marinoscar/platform-web/identity/headless';

import { LoadingSpinner } from '@marinoscar/vault-web/core/ui';

const PlatformDataTable = lazy(() =>
  import('@marinoscar/platform-web/datatable/ui').then((m) => ({
    default: m.DataTable as unknown as IdentityDataTableComponent,
  })),
);

function LazyTable<Row>(props: IdentityDataTableProps<Row>): ReactElement {
  const Table = PlatformDataTable as unknown as IdentityDataTableComponent;
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Table {...(props as IdentityDataTableProps<unknown>)} />
    </Suspense>
  );
}

export const LazyIdentityDataTable = LazyTable as IdentityDataTableComponent;
