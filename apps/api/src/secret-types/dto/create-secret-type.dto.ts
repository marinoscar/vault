import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const fieldDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Field name must be snake_case'),
  label: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'date']),
  required: z.boolean(),
  sensitive: z.boolean().default(false),
});

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

export const createSecretTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  fields: z
    .array(fieldDefinitionSchema)
    .min(1, 'At least one field is required')
    .refine(
      (fields) => {
        const names = fields.map((f) => f.name);
        return new Set(names).size === names.length;
      },
      { message: 'Field names must be unique' },
    ),
  allowAttachments: z.boolean().default(false),
});

export class CreateSecretTypeDto extends createZodDto(createSecretTypeSchema) {}
