// =============================================================================
// Identity's composition (issue #77, E3.2, epic #54)
// =============================================================================
//
// `IdentityModule.forRoot` serves `/api/auth/*`, `/api/users`, `/api/roles`,
// `/api/allowlist`, `/api/pat`, `/api/auth/device/*` and, outside production,
// `/api/auth/test/login`, in single-organization mode (`TENANCY_MODE` unset).
// It replaced Vault's own `auth/`, `users/`, `allowlist/`, `pat/`,
// `device-auth/` and `test-auth/` modules.
//
// GOOGLE IS BUILT IN. Do not call `registerAuthProvider` for it:
// `GET /api/auth/providers` lists `google` when `GOOGLE_CLIENT_ID` and
// `GOOGLE_CLIENT_SECRET` are set. Microsoft is optional and is not wired here;
// it would be a `registerAuthProvider` call before `forRoot`.
//
// The configuration keys the slice reads (`jwt`, `google`, `deviceAuth`,
// `initialAdminEmail`, `tenancy`) are built by `identityConfiguration()` in
// `config/configuration.ts`; the environment variable names are unchanged.
// =============================================================================

import { IdentityModule } from '@marinoscar/platform-api/identity';

import { IdentityHostModule } from './identity-host.module';

/**
 * The identity slice for Vault. `enableTestAuth` mounts the test-only login
 * (`POST /api/auth/test/login`); the slice itself refuses it, as a boot error,
 * when `NODE_ENV` is `production`.
 */
export const identityModule = IdentityModule.forRoot({
  imports: [IdentityHostModule],
  enableTestAuth: process.env.NODE_ENV !== 'production',
});
