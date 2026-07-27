import { z } from 'zod';

// =============================================================================
// User Settings Schema
// =============================================================================

export const userSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: z.object({
    displayName: z.string().max(100).optional(),
    useProviderImage: z.boolean(),
    customImageUrl: z.string().url().nullable().optional(),
  }),
});

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

// Partial schema for PATCH operations
export const userSettingsPatchSchema = userSettingsSchema.deepPartial();

// =============================================================================
// System Settings Schema
// =============================================================================

/**
 * Encrypted credential as it is PERSISTED (never as it is accepted from a
 * client - the API only ever accepts plaintext on PATCH, see
 * `patchSystemSettingsSchema`).
 */
export const encryptedSecretValueSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  last4: z.string().max(4),
  updatedAt: z.string(),
});

/**
 * System-wide AI provider configuration, as persisted.
 */
export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('openai'),
  model: z.string().min(1).max(100),
  maxCallsPerUserPerDay: z.number().int().min(0).max(10000),
  apiKey: encryptedSecretValueSchema.nullable(),
});

export const systemSettingsSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  features: z.record(z.string(), z.boolean()),
  // Optional so pre-existing rows (written before AI settings existed) parse.
  ai: aiSettingsSchema.optional(),
});

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

// Partial schema for PATCH operations
export const systemSettingsPatchSchema = systemSettingsSchema.deepPartial();
