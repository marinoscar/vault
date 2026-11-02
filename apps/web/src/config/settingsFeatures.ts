/**
 * The settings-card feature keys Vault's registries can name, beyond the
 * platform's `ai` and `telemetry`.
 *
 * `orgs`: the packaged identity cards are typed with it
 * (`IdentitySettingsCard['feature']` is `'orgs' | undefined`), so spreading
 * `identityAdminSections.access` into `ADMIN_SECTIONS` needs the key declared.
 * No resolver is registered: Vault runs single-organization, so the key reads
 * "off" (a missing key fails closed) and the `organizations` cards, which
 * carry it, are not spread at all.
 */

declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry {
    /** The deployment runs with `TENANCY_MODE=multi` (never, in Vault today). */
    orgs: true;
  }
}

export {};
