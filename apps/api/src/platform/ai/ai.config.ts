// =============================================================================
// The AI slice's composition (issue #87, E8.1, epic #63)
// =============================================================================
//
// `AiModule.forRoot` mounts the platform AI slice: `GET /api/ai/config`,
// `/api/ai/keys`, the responses / embeddings / images / audio / realtime / runs
// routes, `/api/ai/features`, `/api/ai/usage`, `/api/admin/ai/*` (the deployment
// policy, the model catalogue, deployment and organization keys, usage), the
// `ai.*` job types and the kill switch. The deployment key lives at
// `('ai', 'openai')`, where Vault's key has been stored since E4.2; the credential
// purpose `ai` is registered by `platform/credentials/credential-purposes.manifest.ts`
// from the platform's own `AI_CREDENTIAL_PURPOSE_DEF` (the slice does not register it).
//
// `providers: ['openai', 'openai-compatible']`: OpenAI, and any server speaking its
// wire protocol at an administrator-chosen base URL (Ollama, vLLM, LM Studio: an
// on-prem vision model, #213, docs/runbooks/onprem-vision-model.md). The platform
// ships both adapters; Vault imports no provider SDK. The other provider modules
// stay out of the graph (their settings slots stay, inert).
// `perUserDefaultModel: false`: the model is chosen per FEATURE by
// `VaultAiTargetResolver`, so the per-user default-model picker is hidden.
//
// ORDER: `app-registrations/ai.ts` registers the AI features and the settings
// registry (which lists the `ai` namespace with Vault's extension) comes first; the
// feature registry freezes when the application bootstraps, so both are imported
// HERE, at module load, never from a service.
//
// THE CONSTANT BELOW IS A SINGLETON: a module that needs the AI services imports
// `aiModule` (the same dynamic-module object), never a second `AiModule.forRoot()`.
// =============================================================================

import { AiModule } from '@marinoscar/platform-api/ai';

import '../../settings/registry';
import '../../app-registrations/ai';
import { AiHostModule } from './ai-host.module';

export const aiModule = AiModule.forRoot({
  imports: [AiHostModule],
  providers: ['openai', 'openai-compatible'],
  perUserDefaultModel: false,
});
