// =============================================================================
// Credential purposes (issue #80, epic #54)
// =============================================================================
//
// The platform's `CredentialsService` refuses to write a purpose nobody
// registered, and a credential's PURPOSE IS ALSO ITS AES-GCM SUB-KEY DOMAIN:
// renaming a string orphans every secret stored under it.
//
//   ai   the platform AI slice's deployment provider key (purpose `'ai'`, name =
//        provider id). Vault stores its one OpenAI key at `('ai', 'openai')`, which
//        is the address the AI slice reads. Since E8.1 (issue #87) the definition is
//        the platform's own `AI_CREDENTIAL_PURPOSE_DEF`; the local SHIM(E8) copy is
//        gone. The slice does not register it itself: the app's manifest does, here.
//   storage   the platform storage slice's object-store secret access key (purpose `'storage'`,
//        name `default`; E6.1). Registered from the slice's own `STORAGE_CREDENTIAL_PURPOSE_DEF`.
//
//   smtp, email_ses, push_vapid   (E7.1) the email slice's and the notifications slice's secrets.
//
// Not here: Vault's secret values. They are `secret_versions` rows under
// `VAULT_ENCRYPTION_KEY` (`CryptoService`), a different key and a different
// store, on purpose (docs/SECRETS.md).
// =============================================================================

import { AI_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/ai';
import { registerCredentialPurpose } from '@marinoscar/platform-api/credentials';
import { STORAGE_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/storage';
import { SES_CREDENTIAL_PURPOSE_DEF, SMTP_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/email';
import { PUSH_VAPID_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/notifications';

/** Purpose of the deployment's AI provider keys (also the cipher sub-key domain). */
export const AI_CREDENTIAL_PURPOSE = AI_CREDENTIAL_PURPOSE_DEF.purpose;

registerCredentialPurpose(AI_CREDENTIAL_PURPOSE_DEF);

// E6.1: the object store's secret access key (`storage` / `default`).
registerCredentialPurpose(STORAGE_CREDENTIAL_PURPOSE_DEF);
// E7.1 (#85): the email transports' secrets and the Web Push private key. The
// platform declares the definitions; the app only registers the ones it stores.
// SMTP / SES / VAPID are runtime-configured in the admin UI: no environment variable.
registerCredentialPurpose(SMTP_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(SES_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(PUSH_VAPID_CREDENTIAL_PURPOSE_DEF);
