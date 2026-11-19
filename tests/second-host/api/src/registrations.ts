// Host Beta's static registrations. Imported FIRST by the app module and the seed: the platform's
// registries freeze when the application bootstraps.
import { registerPlatformPermissions } from '@marinoscar/platform-api/manifest';
import { registerVaultAgentOAuth } from '@marinoscar/vault-api/agent';

import { PERMISSION_OPTIONS } from './permissions';

registerPlatformPermissions(PERMISSION_OPTIONS);
// The agent API's OAuth scopes and `agent` protected resource. This host mounts no OAuth server
// (its agents use personal access tokens), but registering them keeps `/api/agent/v1` confined
// exactly as in Vault the day the host switches the server on.
registerVaultAgentOAuth();
