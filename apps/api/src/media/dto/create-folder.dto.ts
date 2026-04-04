import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

export class CreateFolderDto extends createZodDto(createFolderSchema) {}
