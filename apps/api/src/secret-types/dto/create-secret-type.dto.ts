import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const fieldDefinitionBaseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Field name must be snake_case'),
  label: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'date', 'select']),
  required: z.boolean(),
  sensitive: z.boolean().default(false),
  /**
   * Allowed values for `select` fields. Required (and only permitted) when
   * `type === 'select'`.
   */
  options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
});

export const fieldDefinitionSchema = fieldDefinitionBaseSchema.superRefine(
  (field, ctx) => {
    if (field.type === 'select') {
      if (!field.options || field.options.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'options is required for select fields',
        });
        return;
      }

      if (new Set(field.options).size !== field.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'options must not contain duplicate values',
        });
      }
      return;
    }

    if (field.options !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'options is only allowed for select fields',
      });
    }
  },
);

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

/**
 * Shared `fields` array schema used by both create and update DTOs so the two
 * can never drift.
 */
export const secretTypeFieldsSchema = z
  .array(fieldDefinitionSchema)
  .min(1, 'At least one field is required')
  .refine(
    (fields) => {
      const names = fields.map((f) => f.name);
      return new Set(names).size === names.length;
    },
    { message: 'Field names must be unique' },
  );

export const createSecretTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  fields: secretTypeFieldsSchema,
  allowAttachments: z.boolean().default(false),
});

export class CreateSecretTypeDto extends createZodDto(createSecretTypeSchema) {}
