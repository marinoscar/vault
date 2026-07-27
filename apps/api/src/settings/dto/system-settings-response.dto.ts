import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Masked AI settings. This is the ONLY AI shape the API returns - the stored
 * `ciphertext`, `iv` and `authTag` are never exposed.
 * `null` when the settings row predates the AI block.
 */
export const aiSettingsResponseSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.literal('openai'),
    model: z.string(),
    maxCallsPerUserPerDay: z.number(),
    apiKeyConfigured: z.boolean(),
    apiKeyLast4: z.string().nullable(),
    apiKeyUpdatedAt: z.string().nullable(),
  })
  .nullable();

export const systemSettingsResponseSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  features: z.record(z.string(), z.boolean()),
  ai: aiSettingsResponseSchema,
  updatedAt: z.date(),
  updatedBy: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
    })
    .nullable(),
  version: z.number(),
});

export class SystemSettingsResponseDto extends createZodDto(
  systemSettingsResponseSchema,
) {}
