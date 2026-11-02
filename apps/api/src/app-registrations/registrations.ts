// =============================================================================
// Vault's platform registrations (issue #77, E3.2, epic #54)
// =============================================================================
//
// IMPORT THIS BEFORE ANYTHING THAT READS THE ROLE, PERMISSION OR OWNERSHIP
// REGISTRIES: `main.ts`, `app.module.ts`, the catalog script and the test setup
// import it first. It fills core's static registries with the platform's roles
// and permissions plus Vault's, the user-owned model inventory and the model
// ownership classification. The registries freeze when the application
// bootstraps, so a late registration fails loudly.
//
// Registration is once per process: a second import is a no-op (the ES module
// cache), and registering the same id twice is `DUPLICATE_ID`.
// =============================================================================

import {
  registerPlatformModelOwnership,
  registerPlatformPermissions,
  registerPlatformUserOwnedModels,
} from '@marinoscar/platform-api/manifest';

import { PERMISSION_OPTIONS } from '../platform/permissions';
import { VAULT_MODEL_OWNERSHIP } from './model-ownership';
import { VAULT_USER_OWNED_MODELS } from './user-owned-models';

registerPlatformPermissions(PERMISSION_OPTIONS);
registerPlatformUserOwnedModels(VAULT_USER_OWNED_MODELS);
registerPlatformModelOwnership(VAULT_MODEL_OWNERSHIP);
