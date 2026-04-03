import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const updateSecretSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateSecretDto extends createZodDto(updateSecretSchema) {}
