import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const renameFileSchema = z.object({
  name: z.string().min(1).max(255),
});

export class RenameFileDto extends createZodDto(renameFileSchema) {}
