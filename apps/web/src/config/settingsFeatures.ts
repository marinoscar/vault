/**
 * The settings-card feature keys Vault's registries can name, and the
 * resolvers that answer them.
 *
 * `ai` (E8.2, #88): the platform's key. Its resolver reads the shared answer of
 * `GET /api/ai/config` that `VaultAiConfigProvider` (`platform/aiConfig.tsx`)
 * mounts once around the signed-in tree, so the `AI models` and `AI usage`
 * cards show only while an administrator has switched AI on. The `AI` card
 * (where it is switched on) carries no `feature`, so it never hides.
 *
 * `orgs`: the packaged identity cards are typed with it
 * (`IdentitySettingsCard['feature']` is `'orgs' | undefined`), so spreading
 * `identityAdminSections.access` into `ADMIN_SECTIONS` needs the key declared.
 * No resolver is registered: Vault runs single-organization, so the key reads
 * "off" (a missing key fails closed) and the `organizations` cards, which
 * carry it, are not spread at all.
 */

import { registerSettingsFeature } from '@marinoscar/platform-web/settings/headless';
import { useAiFeatures } from '@marinoscar/platform-web/ai/headless';

declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry {
    /** The deployment runs with `TENANCY_MODE=multi` (never, in Vault today). */
    orgs: true;
  }
}

registerSettingsFeature('ai', () => useAiFeatures().ai);
