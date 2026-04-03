import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { fieldDefinitionSchema } from './create-secret-type.dto';

export const updateSecretTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  fields: z
    .array(fieldDefinitionSchema)
    .min(1, 'At least one field is required')
    .refine(
      (fields) => {
        const names = fields.map((f) => f.name);
        return new Set(names).size === names.length;
      },
      { message: 'Field names must be unique' },
    )
    .optional(),
  allowAttachments: z.boolean().optional(),
});

export class UpdateSecretTypeDto extends createZodDto(updateSecretTypeSchema) {}
