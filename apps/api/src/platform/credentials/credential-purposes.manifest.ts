// =============================================================================
// Credential purposes (issue #80, epic #54)
// =============================================================================
//
// The platform's `CredentialsService` refuses to write a purpose nobody
// registered, and a credential's PURPOSE IS ALSO ITS AES-GCM SUB-KEY DOMAIN:
// renaming a string orphans every secret stored under it.
//
//   ai   the platform AI slice's deployment provider key (purpose `'ai'`, name =
//        provider id). Vault stores its one OpenAI key at `('ai', 'openai')`, the
//        address the AI slice reads in E8, so the key never has to be moved twice.
//   storage   the platform storage slice's object-store secret access key (purpose `'storage'`,
//        name `default`; E6.1). Registered from the slice's own `STORAGE_CREDENTIAL_PURPOSE_DEF`.
//
// SHIM(E8): this is a local copy of the platform's `AI_CREDENTIAL_PURPOSE_DEF`
// (`@marinoscar/platform-api/ai`, `ai/config/ai-credential.constants.ts`). It is
// NOT imported: pulling the `ai` subpath into the app's type graph makes ts-jest
// stop resolving `@marinoscar/platform-api/testing` (the conformance and Doctor
// specs fail with TS2307), and the AI slice is not mounted until E8.
// `test/credentials/credential-purposes.spec.ts` proves the copy equals the
// platform's. When `AiModule.forRoot` registers the purpose (E8), delete this
// registration in the same change: a duplicate registration fails at boot.
//
//   smtp, email_ses, push_vapid   (E7.1) the email slice's and the notifications slice's secrets.
//
// Not here: Vault's secret values. They are `secret_versions` rows under
// `VAULT_ENCRYPTION_KEY` (`CryptoService`), a different key and a different
// store, on purpose (docs/SECRETS.md).
// =============================================================================

import { STORAGE_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/storage';
import {
  registerCredentialPurpose,
  type CredentialPurposeDef,
} from '@marinoscar/platform-api/credentials';
import { SES_CREDENTIAL_PURPOSE_DEF, SMTP_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/email';
import { PUSH_VAPID_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/notifications';

/** Purpose of the deployment's AI provider keys (also the cipher sub-key domain). */
export const AI_CREDENTIAL_PURPOSE = 'ai';

/** SHIM(E8): equal to the platform's `AI_CREDENTIAL_PURPOSE_DEF`. */
export const AI_CREDENTIAL_PURPOSE_DEF: CredentialPurposeDef = Object.freeze({
  purpose: AI_CREDENTIAL_PURPOSE,
  owner: 'ai',
  label: 'AI provider keys',
  tiers: Object.freeze(['system', 'org'] as const),
});

registerCredentialPurpose(AI_CREDENTIAL_PURPOSE_DEF);

// E6.1: the object store's secret access key (`storage` / `default`).
registerCredentialPurpose(STORAGE_CREDENTIAL_PURPOSE_DEF);
// E7.1 (#85): the email transports' secrets and the Web Push private key. The
// platform declares the definitions; the app only registers the ones it stores.
// SMTP / SES / VAPID are runtime-configured in the admin UI: no environment variable.
registerCredentialPurpose(SMTP_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(SES_CREDENTIAL_PURPOSE_DEF);
registerCredentialPurpose(PUSH_VAPID_CREDENTIAL_PURPOSE_DEF);
