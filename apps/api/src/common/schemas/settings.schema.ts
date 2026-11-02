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
// (Zod 4 dropped `.deepPartial()`; the partials are spelled out, mirroring the
// Zod 3 behaviour: every nested object becomes partial, record values do not.)
export const userSettingsPatchSchema = z.object({
  theme: userSettingsSchema.shape.theme.optional(),
  profile: userSettingsSchema.shape.profile.partial().optional(),
});

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

// LOOSE on purpose: the `global` row is shared with the platform's namespaces
// (`maintenance` today; `jobs`, `nodes`, ... as slices land), which this schema
// does not describe. A strict `z.object` would STRIP them on every admin save.
export const systemSettingsSchema = z.looseObject({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  features: z.record(z.string(), z.boolean()),
  // Optional so pre-existing rows (written before AI settings existed) parse.
  ai: aiSettingsSchema.optional(),
});

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

// Partial schema for PATCH operations
// (Zod 4 dropped `.deepPartial()`; see `userSettingsPatchSchema`.)
export const systemSettingsPatchSchema = z.object({
  ui: systemSettingsSchema.shape.ui.partial().optional(),
  features: systemSettingsSchema.shape.features.optional(),
  ai: z
    .object({
      enabled: aiSettingsSchema.shape.enabled.optional(),
      provider: aiSettingsSchema.shape.provider.optional(),
      model: aiSettingsSchema.shape.model.optional(),
      maxCallsPerUserPerDay: aiSettingsSchema.shape.maxCallsPerUserPerDay.optional(),
      apiKey: encryptedSecretValueSchema.partial().nullable().optional(),
    })
    .optional(),
});
