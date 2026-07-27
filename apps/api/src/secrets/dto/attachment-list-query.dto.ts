import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { attachmentRoleSchema } from './link-attachment.dto';

/**
 * Query filters for `GET /secrets/:id/attachments`.
 *
 * Both filters are optional. With no `versionId` the endpoint scopes to the
 * secret's current version — attachments are carried forward on every new
 * version, so the unscoped set would otherwise grow by a full copy per edit.
 */
export const attachmentListQuerySchema = z.object({
  versionId: z.string().uuid().optional(),
  role: attachmentRoleSchema.optional(),
});

export class AttachmentListQueryDto extends createZodDto(
  attachmentListQuerySchema,
) {}
