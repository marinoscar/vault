// =============================================================================
// The telemetry slice's composition (issue #90, E9.2, epic #54)
// =============================================================================
//
// `TelemetryModule.forRoot` serves the API side of observability: the `telemetry`
// settings and the runtime export gate (`/api/admin/telemetry/config`,
// `GET /api/telemetry/config`), the runtime GreptimeDB connection, the explorer
// (SQL, schema, export), the dashboard with its metric groups and health verdict,
// the stack-agent surface, the assistant, two server-only job types
// (`telemetry.retention.apply`, `telemetry.stack.deploy`) and the Doctor checks.
// It replaces the Uptrace exporter (the SDK itself is `instrumentation.ts`, over
// `@marinoscar/platform-api/otel-core/sdk`).
//
// Permissions: `telemetry:read|write|query` (admin only, registered by the
// platform permission manifest). The assistant also needs `ai:use`.
//
// The `telemetry` namespace (`telemetry.system-settings.ts`) is registered by
// `app-registrations/settings.ts` and the `telemetry_greptime` credential purpose
// by `platform/credentials/credential-purposes.manifest.ts`, both before the
// registries freeze. It needs `jobsModule` and `settingsModule` (global).
//
// Vault's own dashboard metric groups are `app-registrations/telemetry.ts`.
// =============================================================================

import { TelemetryModule } from '@marinoscar/platform-api/telemetry';

import { VAULT_METRIC_GROUPS } from '../../app-registrations/telemetry';
import { platformHost } from '../platform-host';
import { TelemetryHostModule } from './telemetry-host.module';

export const telemetryModule = TelemetryModule.forRoot({
  host: platformHost,
  imports: [TelemetryHostModule],
  metricGroups: VAULT_METRIC_GROUPS,
});
