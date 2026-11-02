// =============================================================================
// The email slice's options (issue #85, E7.1, epic #54)
// =============================================================================
//
// ONE object, three readers: `EmailModule.forRoot(EMAIL_MODULE_OPTIONS)`
// (`email.config.ts`), `configureEmailRendering(EMAIL_MODULE_OPTIONS)` in
// `platform/notifications/notification.manifest.ts` (which renders templates
// before the Nest graph is composed) and the specs.
//
// THE LAYOUT. Only the brand colour is themed: `THEME_COLOR` of
// `packages/shared/identity.json` (Vault's deep teal), so a rebrand reaches the
// mail with the web manifest. The brand mark is the committed PNG under
// `apps/api/assets/email` (`email-templates/brand-logo.ts`).
//
// NO NEW ENVIRONMENT VARIABLE. SMTP and SES (transport, relay, sender, secrets)
// are configured at runtime on `/admin/settings/email`. `appUrl` reads the
// deployment's existing `APP_URL`; there is no SES region fallback, because
// Vault has no other AWS region setting to inherit.
// =============================================================================

import { APP_NAME, THEME_COLOR } from '@app/shared';
import type { EmailModuleOptions } from '@marinoscar/platform-api/email';
import { classifyRateLimit } from '@marinoscar/platform-api/jobs';

import { emailBrandMark } from '../../email-templates/brand-logo';

/** The deployment's base URL when `APP_URL` is unset (the dev default). */
const DEFAULT_APP_URL = 'http://localhost:3535';

export const EMAIL_MODULE_OPTIONS: EmailModuleOptions = {
  appName: APP_NAME,
  appUrl: () => process.env.APP_URL || DEFAULT_APP_URL,
  layout: {
    theme: { colors: { brand: THEME_COLOR } },
    brandMark: emailBrandMark(),
  },
  classifyRateLimit,
};
