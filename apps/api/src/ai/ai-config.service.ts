import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import {
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../platform/credentials/credentials.config';
import { VAULT_AI_SYSTEM_SETTINGS } from '../app-registrations/settings';
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
 * The non-secret settings (enabled, model, budget) come from
 * the platform `SystemSettingsService` (`ai` namespace, no key material). The plaintext key
 * comes from the platform credential store (purpose `ai`, name `openai`,
 * encrypted under SECRETS_ENCRYPTION_KEY) and exists in memory only between
 * this call and the provider call. There is no fallback to the legacy
 * `system_settings.ai.apiKey` block: until `npm run vault:migrate-ai-key` has
 * moved the key, AI reports "not configured" rather than reading two stores.
 */
@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(
    private readonly systemSettings: SystemSettingsService,
    private readonly credentials: CredentialsService,
  ) {}

  /**
   * Resolve config for an actual extraction.
   *
   * @throws AiException 503 AI_NOT_CONFIGURED - disabled, or no key stored
   * @throws AiException 503 AI_KEY_UNREADABLE - key stored but undecryptable
   */
  async resolveForExtraction(): Promise<ResolvedAiConfig> {
    const ai = await this.systemSettings.getNamespace(VAULT_AI_SYSTEM_SETTINGS);

    if (!ai.enabled || !(await this.isKeyConfigured())) {
      throw aiNotConfigured();
    }

    return this.withPlaintextKey(ai);
  }

  /**
   * Resolve config for an administrator's connectivity check.
   *
   * Deliberately does NOT require `ai.enabled`. The natural order of operations
   * is "paste the key, pick a model, check it works, then turn the feature on
   * for users" - requiring the flag first would force an admin to expose a
   * possibly-broken feature to everyone in order to find out whether it is
   * broken.
   *
   * A stored key is still required: there is nothing to verify without one.
   *
   * @throws AiException 503 AI_NOT_CONFIGURED - no key stored
   * @throws AiException 503 AI_KEY_UNREADABLE - key stored but undecryptable
   */
  async resolveForVerification(): Promise<ResolvedAiConfig> {
    const ai = await this.systemSettings.getNamespace(VAULT_AI_SYSTEM_SETTINGS);

    if (!(await this.isKeyConfigured())) {
      throw aiNotConfigured();
    }

    return this.withPlaintextKey(ai);
  }

  /**
   * Decrypt the stored credential and pair it with the resolved settings.
   *
   * Shared by both resolve paths so the credential handling - and its failure
   * modes - cannot diverge between "verify the key" and "use the key".
   */
  private async withPlaintextKey(ai: {
    model: string;
    maxCallsPerUserPerDay: number;
  }): Promise<ResolvedAiConfig> {
    let apiKey: string | null;
    try {
      apiKey = await this.readApiKey();
    } catch (error) {
      // The store throws when SECRETS_ENCRYPTION_KEY is missing, or has been
      // changed since the key was saved. Restated under this feature's own code
      // so the client has a single taxonomy to switch on.
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

  /** Whether the credential store holds a key (the mask only, nothing decrypted). */
  async isKeyConfigured(): Promise<boolean> {
    const info = await this.credentials.describe(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME);
    return info !== null;
  }

  /** The decrypted key from the credential store, or null when none is stored. */
  private readApiKey(): Promise<string | null> {
    return this.credentials.getSecret(
      VAULT_AI_CREDENTIAL_PURPOSE,
      VAULT_AI_CREDENTIAL_NAME,
    );
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
      const ai = await this.systemSettings.getNamespace(VAULT_AI_SYSTEM_SETTINGS);
      if (!ai.enabled || !(await this.isKeyConfigured())) return false;

      // Prove the credential is actually usable. "Configured but undecryptable"
      // must read as unavailable, otherwise the UI offers a button that can
      // only ever 503.
      const apiKey = await this.readApiKey();
      return Boolean(apiKey);
    } catch (error) {
      this.logger.warn(
        `AI status resolved to unavailable: ${(error as Error)?.message}`,
      );
      return false;
    }
  }
}
