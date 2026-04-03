import { z } from 'zod';

export const secretTypeQuerySchema = z.object({
  search: z.string().optional(),
  includeSystem: z.coerce.boolean().default(true),
});

export type SecretTypeQueryDto = z.infer<typeof secretTypeQuerySchema>;
