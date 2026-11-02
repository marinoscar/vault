// =============================================================================
// Slice metrics Vault mounts (issue #91, E9.3, epic #64)
// =============================================================================
//
// The exports slice (`app.exports`, `app.export.duration`, `app.export.size`) and the user-data
// slice (`app.user_data.purges`, `app.factory_reset.runs`, `app.org.offboardings`) declare their
// metrics; they must be in the host's metric registry before the instruments are created, or the
// slices' `metrics.add(...)` calls are dropped. Imported by `host-core.config.ts` BEFORE
// `PlatformHostCoreModule.forRoot()` (which registers the platform's own again, idempotently).
// APPEND a group when another slice that declares metrics is mounted.
// =============================================================================

import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';
import { EXPORTS_APP_METRICS } from '@marinoscar/platform-api/exports';
import { USER_DATA_APP_METRICS } from '@marinoscar/platform-api/user-data';

registerPlatformHostAppMetrics(EXPORTS_APP_METRICS, USER_DATA_APP_METRICS);
