import { Injectable, Logger } from '@nestjs/common';

import { SystemSettingsService } from '../settings/system-settings/system-settings.service';
import { aiKeyUnreadable, aiNotConfigured } from './ai.errors';

/**
 * Everything an extraction needs, with the credential already decrypted.
 * Never logged, never returned over HTTP, never persisted.
 */
export interface ResolvedAiConfig {
  model: string;
  maxCallsPerUserPerDay: number;
  apiKey: string;
}

/**
 * Resolves the admin-configured AI settings into something callable.
 *
 * The plaintext key is obtained through `SystemSettingsService`'s existing
 * `getOpenAiApiKeyPlaintext()`, which is the sanctioned path: the settings row
 * is not read directly here, because `getSettings()` deliberately returns a
 * masked projection (`apiKeyConfigured`, `apiKeyLast4`) and reading the raw row
 * from outside that service is exactly the mistake its comments warn about.
 */
@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(private readonly systemSettings: SystemSettingsService) {}

  /**
   * Resolve config for an actual extraction.
   *
   * @throws AiException 503 AI_NOT_CONFIGURED - disabled, or no key stored
   * @throws AiException 503 AI_KEY_UNREADABLE - key stored but undecryptable
   */
  async resolveForExtraction(): Promise<ResolvedAiConfig> {
    const settings = await this.systemSettings.getSettings();
    const ai = settings.ai;

    if (!ai || !ai.enabled || !ai.apiKeyConfigured) {
      throw aiNotConfigured();
    }

    let apiKey: string | null;
    try {
      apiKey = await this.systemSettings.getOpenAiApiKeyPlaintext();
    } catch (error) {
      // SystemSettingsService raises its own 503 (AI_API_KEY_UNREADABLE) when
      // the vault key is missing or has been rotated. Restated here under this
      // feature's own code so the client has a single taxonomy to switch on.
      this.logger.error(
        `AI API key could not be decrypted: ${(error as Error)?.message}`,
      );
      throw aiKeyUnreadable();
    }

    // `apiKeyConfigured` was true a moment ago, so a null here means the key was
    // cleared between the two reads. Same user-visible remedy as never having
    // configured one.
    if (!apiKey) {
      throw aiNotConfigured();
    }

    return {
      model: ai.model,
      maxCallsPerUserPerDay: ai.maxCallsPerUserPerDay,
      apiKey,
    };
  }

  /**
   * Whether the feature is usable right now.
   *
   * Deliberately boolean-only and swallowing: this backs `GET /api/ai/status`,
   * which any authenticated user may call. Leaking the model name, the key mask
   * or the reason for being unavailable to a Viewer would work around the
   * admin-gating on system settings.
   */
  async isReady(): Promise<boolean> {
    try {
      const settings = await this.systemSettings.getSettings();
      const ai = settings.ai;
      if (!ai || !ai.enabled || !ai.apiKeyConfigured) return false;

      // Prove the credential is actually usable. "Configured but undecryptable"
      // must read as unavailable, otherwise the UI offers a button that can
      // only ever 503.
      const apiKey = await this.systemSettings.getOpenAiApiKeyPlaintext();
      return Boolean(apiKey);
    } catch (error) {
      this.logger.warn(
        `AI status resolved to unavailable: ${(error as Error)?.message}`,
      );
      return false;
    }
  }
}
