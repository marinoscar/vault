import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

export class UpdateFolderDto extends createZodDto(updateFolderSchema) {}
