import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Role of an attachment within its secret version.
 * Omitted means a generic attachment (stored as NULL), of which a version may
 * have many. A role-bearing attachment is unique per version.
 */
export const attachmentRoleSchema = z.enum(['card_front', 'card_back']);

export type AttachmentRole = z.infer<typeof attachmentRoleSchema>;

export const linkAttachmentSchema = z.object({
  storageObjectId: z.string().uuid(),
  role: attachmentRoleSchema.optional(),
  label: z.string().max(255).optional(),
});

export class LinkAttachmentDto extends createZodDto(linkAttachmentSchema) {}
