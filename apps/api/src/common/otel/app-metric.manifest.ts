// =============================================================================
// App-metric manifest (issue #90, E9.2)
// =============================================================================
//
// Registers Vault's `app.vault.*` metrics at import time, after the platform's
// (`PlatformHostCoreModule.forRoot()` registers its own, idempotently, so the
// order does not matter for them). Imported by `platform/host-core.config.ts`
// BEFORE the host core is built; the registry freezes when the application
// bootstraps.
// =============================================================================

import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';

import { VAULT_APP_METRICS } from './vault-metrics';

// The platform's own metrics first, then Vault's, so a key or name clash names Vault.
registerPlatformHostAppMetrics(VAULT_APP_METRICS);
