import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const linkAttachmentSchema = z.object({
  storageObjectId: z.string().uuid(),
  label: z.string().max(255).optional(),
});

export class LinkAttachmentDto extends createZodDto(linkAttachmentSchema) {}
