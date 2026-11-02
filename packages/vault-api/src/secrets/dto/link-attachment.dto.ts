import { createZodDto } from 'nestjs-zod';
import {
  attachmentRoleSchema,
  linkAttachmentSchema,
  type AttachmentRole,
} from '@marinoscar/vault-contract/secrets';

export { attachmentRoleSchema, linkAttachmentSchema };
export type { AttachmentRole };

export class LinkAttachmentDto extends createZodDto(linkAttachmentSchema) {}
