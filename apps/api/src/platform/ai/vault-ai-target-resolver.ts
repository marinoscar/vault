import { Injectable } from '@nestjs/common';

import {
  DefaultAiTargetResolver,
  type AiTarget,
  type AiTargetContext,
  type AiTargetResolver,
} from '@marinoscar/platform-api/ai';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { VAULT_AI_POLICY } from '../../app-registrations/settings';
import { CARD_EXTRACT_FEATURE, DOCUMENT_EXTRACT_FEATURE } from '@marinoscar/vault-api/ai';
import { DEFAULT_SCAN_PROVIDER, resolveScanModelRef } from '@marinoscar/vault-contract/secrets';

/**
 * Routes the `card_extract` feature to the model an administrator chose
 * (`ai.cardExtractModel` on `ai.cardExtractProvider`, `openai` when unset; the
 * successor of `ai.model`). Every other caller (a
 * platform page such as the Playground, a call that names no feature) gets the
 * platform's own order. The `document_extract` feature (#210) runs on
 * `ai.documentExtractModel` (on `ai.documentExtractProvider`), falling back to the
 * card choice. The provider can be any mounted one, `openai-compatible` included
 * (an on-prem vision model, #213); the rule is `resolveScanModelRef` of
 * `@marinoscar/vault-contract/secrets`, shared with `ScanTargetsService`. A caller
 * that pins `requested.model` keeps it, subject to the same enablement gates.
 *
 * The model must still be enabled in `ai_models` (a gate, not a default): the
 * migration command enables it (`npm run vault:migrate-ai-platform`).
 */
@Injectable()
export class VaultAiTargetResolver implements AiTargetResolver {
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly fallback: DefaultAiTargetResolver,
  ) {}

  async resolve(ctx: AiTargetContext): Promise<AiTarget | null> {
    if (ctx.feature !== CARD_EXTRACT_FEATURE && ctx.feature !== DOCUMENT_EXTRACT_FEATURE) {
      return this.fallback.resolve(ctx);
    }
    const policy = await this.settings.getNamespace(VAULT_AI_POLICY);
    const ref = resolveScanModelRef(policy, ctx.feature);
    const pinned = ctx.requested.model?.trim();
    return {
      provider: ref?.provider ?? DEFAULT_SCAN_PROVIDER,
      model: pinned || (ref?.model ?? ''),
    };
  }
}
