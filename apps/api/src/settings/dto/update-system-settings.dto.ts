import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Full replacement (PUT)
//
// Deliberately has NO `ai` member. A PUT must never be able to write (or carry
// through) an encrypted credential, and because Zod strips unknown keys any
// `ai` a client sends here is dropped before it reaches the service. The
// service is responsible for preserving the stored `ai` block across a PUT -
// see SystemSettingsService.replaceSettings.
export const updateSystemSettingsSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  features: z.record(z.string(), z.boolean()),
});

export class UpdateSystemSettingsDto extends createZodDto(
  updateSystemSettingsSchema,
) {}

// Partial update (PATCH)
export const patchSystemSettingsSchema = z.object({
  ui: z
    .object({
      allowUserThemeOverride: z.boolean().optional(),
    })
    .optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  ai: z
    .object({
      enabled: z.boolean().optional(),
      model: z.string().min(1).max(100).optional(),
      maxCallsPerUserPerDay: z.number().int().min(0).max(10000).optional(),
      // Write-only plaintext credential.
      //   absent  -> keep the stored key
      //   null    -> clear the stored key
      //   string  -> encrypt and replace the stored key
      // The service distinguishes "absent" from "explicit null" with
      // `'apiKey' in dto.ai`, which Zod preserves: a key missing from the
      // input is also missing from the parsed output.
      apiKey: z.string().min(20).max(300).nullable().optional(),
    })
    .optional(),
});

export class PatchSystemSettingsDto extends createZodDto(
  patchSystemSettingsSchema,
) {}
