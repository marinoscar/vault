// =============================================================================
// The platform credentials store (issue #80, epic #54)
// =============================================================================
//
// `CredentialsModule` is the encrypted `(purpose, name)` store for secrets an
// administrator configures at run time, encrypted under SECRETS_ENCRYPTION_KEY.
// It is NOT global: a module that reads a plaintext secret imports it
// explicitly (`SettingsModule`, `AiModule`), so the readers stay visible.
//
// The store reaches the database through core's `PLATFORM_PRISMA` port, bound in
// `platform-host.module.ts`. Purposes are registered at import time, before the
// registries freeze at bootstrap.
//
// The fixed address of Vault's OpenAI key lives here so the settings service,
// the AI config service and the migration command cannot drift apart.
// =============================================================================

import { AI_CREDENTIAL_PURPOSE } from './credential-purposes.manifest';
import { CredentialsModule } from '@marinoscar/platform-api/credentials';

export { CredentialsModule };

/** Purpose of the deployment's AI provider keys (also the cipher sub-key domain). */
export const VAULT_AI_CREDENTIAL_PURPOSE = AI_CREDENTIAL_PURPOSE;
/** Vault has one provider, OpenAI: the credential name is the provider id. */
export const VAULT_AI_CREDENTIAL_NAME = 'openai';
/** Non-secret label stored beside the key (same text the AI slice uses). */
export const VAULT_AI_CREDENTIAL_LABEL = 'AI provider key (OpenAI)';
