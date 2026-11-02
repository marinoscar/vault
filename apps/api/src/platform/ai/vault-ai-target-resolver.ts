import { Injectable } from '@nestjs/common';

import {
  DefaultAiTargetResolver,
  type AiTarget,
  type AiTargetContext,
  type AiTargetResolver,
} from '@marinoscar/platform-api/ai';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { VAULT_AI_POLICY } from '../../app-registrations/settings';
import { AI_PROVIDER_ID, CARD_EXTRACT_FEATURE } from '@marinoscar/vault-api/ai';

/**
 * Routes the `card_extract` feature to the OpenAI model an administrator chose
 * (`ai.cardExtractModel`, the successor of `ai.model`). Every other caller (a
 * platform page such as the Playground, a call that names no feature) gets the
 * platform's own order. A caller that pins `requested.model` keeps it, subject
 * to the same enablement gates.
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
    if (ctx.feature !== CARD_EXTRACT_FEATURE) return this.fallback.resolve(ctx);
    const policy = await this.settings.getNamespace(VAULT_AI_POLICY);
    return {
      provider: AI_PROVIDER_ID,
      model: ctx.requested.model?.trim() || policy.cardExtractModel,
    };
  }
}
