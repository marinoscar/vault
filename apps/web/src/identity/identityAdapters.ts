/**
 * What the packaged identity pages take from Vault (E3.3, issue #78), handed
 * in once through `IdentityWebAdaptersProvider` (`IdentityProviders.tsx`):
 *
 *   - `appName`: the product name the sign-in error copy names.
 *   - `Spinner`: Vault's `LoadingSpinner`, for the whole-page waits.
 *   - `DataTable`: the platform's responsive `DataTable`
 *     (`@marinoscar/platform-web/datatable/ui`): a grid on desktop and tablet
 *     and a card list on a phone, so the users, allowlist and token lists fit
 *     390px without a horizontal scroll (the package's fallback is a plain
 *     MUI table that does not adapt). Loaded lazily (`LazyIdentityDataTable`):
 *     the grid is the heaviest dependency the app has, and only the Console
 *     users page and the Access Tokens page draw it, so it stays out of the
 *     first bundle the login page and the home page load.
 *   - `api`: the package's identity client over Vault's transport
 *     (`vaultPlatformApi`). Bound here rather than read from the platform host
 *     because two identity pages render outside it: the login page (signed
 *     out) and `/activate` (full screen, outside the shell).
 *
 * A module constant: the provider and the pages key on its identity.
 */

import { createIdentityApi } from '@marinoscar/platform-web/identity/headless';
import type { IdentityWebAdapters } from '@marinoscar/platform-web/identity/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { LazyIdentityDataTable } from './LazyIdentityDataTable';
import { vaultPlatformApi } from '../platform/platformHost';
import { PRODUCT_NAME } from '../theme/tokens';

export const vaultIdentityAdapters: IdentityWebAdapters = Object.freeze<IdentityWebAdapters>({
  appName: PRODUCT_NAME,
  Spinner: LoadingSpinner,
  DataTable: LazyIdentityDataTable,
  api: createIdentityApi(vaultPlatformApi),
});
