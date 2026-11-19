// Host Beta's static registrations. Imported FIRST by the app module and the seed: the platform's
// registries freeze when the application bootstraps.
import {
  registerPlatformModelOwnership,
  registerPlatformPermissions,
  registerPlatformUserOwnedModels,
} from '@marinoscar/platform-api/manifest';
import { VAULT_MODEL_OWNERSHIP, VAULT_USER_OWNED_MODELS } from '@marinoscar/vault-api/core';
import { registerVaultAgentOAuth } from '@marinoscar/vault-api/agent';

import { PERMISSION_OPTIONS } from './permissions';

registerPlatformPermissions(PERMISSION_OPTIONS);
// The Vault models' classification for the platform's user-data machinery (the package's, as is),
// then the host's own model.
registerPlatformUserOwnedModels(VAULT_USER_OWNED_MODELS);
registerPlatformModelOwnership([
  ...VAULT_MODEL_OWNERSHIP,
  { model: 'BetaNote', kind: 'system', rationale: 'Host Beta notes are shared by the whole deployment (a fixture page).' },
]);
// The agent API's OAuth scopes and `agent` protected resource. This host mounts no OAuth server
// (its agents use personal access tokens), but registering them keeps `/api/agent/v1` confined
// exactly as in Vault the day the host switches the server on.
registerVaultAgentOAuth();
