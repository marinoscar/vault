import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const linkFileSchema = z.object({
  storageObjectId: z.string().uuid(),
});

export class LinkFileDto extends createZodDto(linkFileSchema) {}
