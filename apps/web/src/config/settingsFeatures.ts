/**
 * The settings-card feature keys Vault's registries can name, beyond the
 * platform's `ai` and `telemetry` (`telemetry` is resolved below).
 *
 * `orgs`: the packaged identity cards are typed with it
 * (`IdentitySettingsCard['feature']` is `'orgs' | undefined`), so spreading
 * `identityAdminSections.access` into `ADMIN_SECTIONS` needs the key declared.
 * No resolver is registered: Vault runs single-organization, so the key reads
 * "off" (a missing key fails closed) and the `organizations` cards, which
 * carry it, are not spread at all.
 */

import { registerSettingsFeature } from '@marinoscar/platform-web/settings/headless';
import { useTelemetryFeatures } from '@marinoscar/platform-web/telemetry/headless';

declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry {
    /** The deployment runs with `TENANCY_MODE=multi` (never, in Vault today). */
    orgs: true;
  }
}

// `telemetry` (E9.2, #90): a store is deployed AND collection is on, read from the one copy of
// `GET /api/telemetry/config` that `AppTelemetryConfigProvider` holds (platform/TelemetryConfigBinding.tsx).
// The Explorer and Dashboard cards declare it; the Telemetry card does not (it switches collection on).
registerSettingsFeature('telemetry', () => useTelemetryFeatures().telemetry);

export {};
