import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const createSecretSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  typeId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
});

export class CreateSecretDto extends createZodDto(createSecretSchema) {}
