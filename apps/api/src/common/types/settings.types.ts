// =============================================================================
// Settings Type Definitions
// =============================================================================

/**
 * User settings schema - stored in user_settings.value JSONB
 */
export interface UserSettingsValue {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
}

/**
 * Encrypted, system-wide credential as persisted inside system_settings.value.
 *
 * `ciphertext` / `iv` / `authTag` are exactly the output of
 * `CryptoService.encrypt()`. `last4` exists only so the admin UI can show a
 * recognisable mask - it is never enough to reconstruct the key.
 *
 * This shape MUST NEVER leave the API. See `AiSettingsProjection` for the only
 * representation that is safe to return over HTTP.
 */
export interface EncryptedSecretValue {
  ciphertext: string;
  iv: string;
  authTag: string;
  /** Last 4 characters of the plaintext, for masked display only. */
  last4: string;
  /** ISO timestamp of when the key was last written. */
  updatedAt: string;
}

/**
 * System-wide AI provider configuration.
 *
 * There are no per-user API keys - a single admin-configured credential is used
 * for every AI-backed feature (card import, etc.).
 */
export interface AiSettings {
  /** Explicit opt-in to sending card images to the provider. Default false. */
  enabled: boolean;
  provider: 'openai';
  model: string;
  maxCallsPerUserPerDay: number;
  apiKey: EncryptedSecretValue | null;
}

/**
 * The ONLY AI settings shape that may be returned from the API.
 * Contains no ciphertext, iv or authTag.
 */
export interface AiSettingsProjection {
  enabled: boolean;
  provider: 'openai';
  model: string;
  maxCallsPerUserPerDay: number;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  apiKeyUpdatedAt: string | null;
}

/**
 * System settings schema - stored in system_settings.value JSONB
 *
 * `ai` is intentionally OPTIONAL: rows written before the AI settings existed
 * must still read cleanly, and a PATCH that does not mention `ai` must not
 * materialise it.
 */
export interface SystemSettingsValue {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: {
    [key: string]: boolean;
  };
  ai?: AiSettings;
}

/**
 * Default user settings
 */
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    useProviderImage: true,
  },
};

/**
 * Default AI settings - disabled with no credential until an admin configures one.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxCallsPerUserPerDay: 50,
  apiKey: null,
};

/**
 * Default system settings
 */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
  ai: { ...DEFAULT_AI_SETTINGS },
};
