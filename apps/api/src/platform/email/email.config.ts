// =============================================================================
// The email slice's composition (issue #85, E7.1, epic #54)
// =============================================================================
//
// `EmailModule.forRoot` serves `GET|PUT /api/email-settings` and
// `POST /api/email-settings/test` (`system_settings:read|write`), the SES and
// SMTP transports, the template registry and layout and the Doctor check. SMTP
// and SES are runtime-configured (credential purposes `smtp` and `email_ses`,
// registered by `platform/credentials/credential-purposes.manifest.ts`): there is
// no environment variable.
//
// NOT GLOBAL: `SmtpEmailProvider` reaches the plaintext secret reader, so every
// consumer writes `imports: [emailModule]`. Export the ONE `forRoot()` result
// and import THAT object everywhere. It needs `SettingsModule.forRoot()`,
// `PlatformHostModule` and the credentials store, all mounted by `app.module.ts`.
// =============================================================================

import { EmailModule } from '@marinoscar/platform-api/email';

import { EMAIL_MODULE_OPTIONS } from './email.options';

export { EMAIL_MODULE_OPTIONS };

export const emailModule = EmailModule.forRoot(EMAIL_MODULE_OPTIONS);
