import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { secretTypeFieldsSchema } from './create-secret-type.dto';

export const updateSecretTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  fields: secretTypeFieldsSchema.optional(),
  allowAttachments: z.boolean().optional(),
});

export class UpdateSecretTypeDto extends createZodDto(updateSecretTypeSchema) {}
